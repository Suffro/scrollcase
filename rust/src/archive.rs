//! Defensive archive reading.
//!
//! Nothing inside an archive is trusted before it is validated. Entry names are checked against path
//! traversal, encrypted and special entries are refused outright, colliding names are refused, and
//! every link is judged by the same rule the builder applied — against the archive **as received**
//! rather than as intended. A box assembled by hand gets no benefit of the doubt here.
//!
//! The whole archive is validated before a single byte is written. That ordering is the point: a
//! reader that validated entry by entry while extracting would already have written the files
//! preceding the one that turned out to be hostile.

use std::collections::{HashMap, HashSet};
use std::io::Read as _;
use std::path::Path;

use crate::contract::links::{find_entry_through_link, find_unresolvable_link, EntryKind, PayloadEntry};
use crate::error::{fail, Error, Result};
use crate::filesystem::validate_extracted_tree;
use crate::path::{join_relative, safe_relative_path};

const ZIP_FILE_TYPE_MASK: u32 = 0o170_000;
const ZIP_REGULAR_FILE: u32 = 0o100_000;
const ZIP_DIRECTORY: u32 = 0o040_000;
const ZIP_SYMBOLIC_LINK: u32 = 0o120_000;

/// The longest link target a payload may carry.
///
/// A real one is a file name; anything approaching a path limit is either corrupt or an attempt to
/// make reading the archive expensive.
const MAX_LINK_TARGET_BYTES: u64 = 1024;

/// The largest metadata entry this crate will read into memory.
const MAX_METADATA_BYTES: u64 = 1024 * 1024;

/// One validated archive entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveEntry {
    /// Payload-relative path, forward slashes.
    pub path: String,
    /// What the entry is.
    pub kind: EntryKind,
    /// Uncompressed size the archive declares.
    pub size: u64,
    /// Permission bits, without the type bits.
    pub mode: u32,
    /// The link body, present only on a link and only after the entry list has been read.
    pub link_target: Option<String>,
}

impl ArchiveEntry {
    fn as_payload_entry(&self) -> PayloadEntry {
        PayloadEntry {
            path: self.path.clone(),
            kind: self.kind,
            link_target: self.link_target.clone(),
        }
    }
}

/// Classifies one entry and refuses encrypted and special entries.
fn classify(name: &str, encrypted: bool, unix_mode: Option<u32>, size: u64) -> Result<ArchiveEntry> {
    if encrypted {
        fail!("Encrypted ZIP entries are not allowed: {name}");
    }
    let trimmed = name.strip_suffix('/').unwrap_or(name);
    let path = safe_relative_path(trimmed)?;
    let mode = unix_mode.unwrap_or(0);
    let unix_type = mode & ZIP_FILE_TYPE_MASK;

    if unix_type == ZIP_SYMBOLIC_LINK {
        if size > MAX_LINK_TARGET_BYTES {
            fail!("Archive link target is too long: {path}");
        }
        // The target is the entry's own content, so it is not known yet. Nothing may be extracted
        // until the entry list has read it and the link rules have passed.
        return Ok(ArchiveEntry {
            path,
            kind: EntryKind::Link,
            size,
            mode: 0o777,
            link_target: None,
        });
    }

    let is_directory = name.ends_with('/') || unix_type == ZIP_DIRECTORY;
    if !is_directory && unix_type != 0 && unix_type != ZIP_REGULAR_FILE {
        fail!("Archive special entries are not allowed: {path}");
    }
    Ok(ArchiveEntry {
        path,
        kind: if is_directory {
            EntryKind::Directory
        } else {
            EntryKind::File
        },
        size,
        mode: mode & 0o777,
        link_target: None,
    })
}

/// Refuses duplicate paths and file/directory collisions before extraction begins.
fn assert_no_collisions(entries: &[ArchiveEntry]) -> Result<()> {
    let mut seen: HashMap<&str, EntryKind> = HashMap::new();
    let mut parents_with_children: HashSet<&str> = HashSet::new();
    for entry in entries {
        if seen.contains_key(entry.path.as_str()) {
            fail!("Archive entry collides with another entry: {}", entry.path);
        }
        for (index, _) in entry.path.match_indices('/') {
            let parent = &entry.path[..index];
            if seen.get(parent) == Some(&EntryKind::File) {
                fail!("Archive entry collides with another entry: {}", entry.path);
            }
            parents_with_children.insert(parent);
        }
        if entry.kind == EntryKind::File && parents_with_children.contains(entry.path.as_str()) {
            fail!("Archive entry collides with another entry: {}", entry.path);
        }
        seen.insert(entry.path.as_str(), entry.kind);
    }
    Ok(())
}

/// Refuses an archive whose central directory names one path twice.
///
/// This is read from the raw bytes rather than from the ZIP backend, and it has to be: the backend
/// indexes entries by name, so a duplicate is collapsed before any reader can see it — the last
/// record silently wins. That is precisely the ambiguity the collision rule exists to remove, so the
/// question is asked of the archive as received.
///
/// A central-directory record is `PK\x01\x02` followed by 42 bytes of header, then the name.
fn assert_no_duplicate_names(path: &Path) -> Result<()> {
    const SIGNATURE: [u8; 4] = [b'P', b'K', 1, 2];
    const HEADER_LENGTH: usize = 46;
    let bytes = std::fs::read(path)
        .map_err(|error| Error::new(format!("cannot read archive {}: {error}", path.display())))?;
    let mut seen: HashSet<&[u8]> = HashSet::new();
    let mut cursor = 0usize;
    while cursor + HEADER_LENGTH <= bytes.len() {
        if bytes[cursor..cursor + 4] != SIGNATURE {
            cursor += 1;
            continue;
        }
        let name_length = u16::from_le_bytes([bytes[cursor + 28], bytes[cursor + 29]]) as usize;
        let start = cursor + HEADER_LENGTH;
        let Some(name) = bytes.get(start..start + name_length) else {
            break;
        };
        if !seen.insert(name) {
            let name = String::from_utf8_lossy(name);
            fail!("Archive entry collides with another entry: {name}");
        }
        cursor = start + name_length;
    }
    Ok(())
}

fn open(path: &Path) -> Result<zip::ZipArchive<std::fs::File>> {
    let file = std::fs::File::open(path)
        .map_err(|error| Error::new(format!("cannot read archive {}: {error}", path.display())))?;
    zip::ZipArchive::new(file)
        .map_err(|error| Error::new(format!("cannot read archive {}: {error}", path.display())))
}

/// Lists and validates every entry before any archive data is trusted or extracted.
///
/// # Errors
///
/// When the archive cannot be read, or holds an unsafe name, an encrypted or special entry, a
/// colliding name, or a link the contract does not permit.
pub fn list_zip_entries(path: &Path) -> Result<Vec<ArchiveEntry>> {
    assert_no_duplicate_names(path)?;
    let mut archive = open(path)?;
    let mut entries: Vec<ArchiveEntry> = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        // `by_index_raw` so an encrypted entry is refused by name here, rather than surfacing as the
        // zip backend's own "password required" further down.
        let (name, encrypted, mode, size) = {
            let entry = archive
                .by_index_raw(index)
                .map_err(|error| Error::new(format!("cannot read archive entry: {error}")))?;
            (
                entry.name().to_string(),
                entry.encrypted(),
                entry.unix_mode(),
                entry.size(),
            )
        };
        let mut classified = classify(&name, encrypted, mode, size)?;
        if classified.kind == EntryKind::Link {
            let mut target = String::new();
            archive
                .by_index(index)
                .map_err(|error| Error::new(format!("cannot read archive entry: {error}")))?
                .take(MAX_LINK_TARGET_BYTES + 1)
                .read_to_string(&mut target)
                .map_err(|error| {
                    Error::new(format!("cannot read archive link {}: {error}", classified.path))
                })?;
            if target.len() as u64 > MAX_LINK_TARGET_BYTES {
                fail!("Archive link target is too long: {}", classified.path);
            }
            classified.link_target = Some(target);
        }
        entries.push(classified);
    }

    assert_no_collisions(&entries)?;
    let payload: Vec<PayloadEntry> = entries.iter().map(ArchiveEntry::as_payload_entry).collect();
    if let Some(path) = find_unresolvable_link(&payload) {
        fail!("Archive link does not resolve to a file inside the payload: {path}");
    }
    if let Some(path) = find_entry_through_link(&payload) {
        fail!("Archive entry would be written through a link: {path}");
    }
    Ok(entries)
}

/// Reads one small metadata entry without extracting the surrounding archive.
///
/// # Errors
///
/// When the entry is missing, is not a regular file, or is larger than a metadata entry may be.
pub fn read_zip_entry(path: &Path, wanted: &str, maximum_bytes: u64) -> Result<Vec<u8>> {
    let safe = safe_relative_path(wanted)?;
    let mut archive = open(path)?;
    for index in 0..archive.len() {
        let (name, encrypted, mode, size) = {
            let entry = archive
                .by_index_raw(index)
                .map_err(|error| Error::new(format!("cannot read archive entry: {error}")))?;
            (
                entry.name().to_string(),
                entry.encrypted(),
                entry.unix_mode(),
                entry.size(),
            )
        };
        let classified = classify(&name, encrypted, mode, size)?;
        if classified.path != safe || classified.kind != EntryKind::File {
            continue;
        }
        if classified.size > maximum_bytes {
            fail!("ZIP entry is too large to read as metadata: {safe}");
        }
        let mut bytes = Vec::new();
        archive
            .by_index(index)
            .map_err(|error| Error::new(format!("cannot read archive entry: {error}")))?
            .take(maximum_bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| Error::new(format!("cannot read {safe}: {error}")))?;
        if bytes.len() as u64 > maximum_bytes {
            fail!("ZIP entry is too large to read as metadata: {safe}");
        }
        return Ok(bytes);
    }
    fail!("ZIP archive does not contain {safe}")
}

/// Reads one small metadata entry as UTF-8 text.
///
/// # Errors
///
/// See [`read_zip_entry`]; additionally when the bytes are not valid UTF-8.
pub fn read_zip_entry_text(path: &Path, wanted: &str) -> Result<String> {
    let bytes = read_zip_entry(path, wanted, MAX_METADATA_BYTES)?;
    String::from_utf8(bytes).map_err(|_| Error::new(format!("Invalid UTF-8 in {wanted}.")))
}

/// Extracts a prevalidated archive.
///
/// # Errors
///
/// When validation fails, or when the destination cannot be written.
pub fn extract_zip_archive(archive_path: &Path, destination: &Path) -> Result<()> {
    // Validated in full first, and the targets returned here are the only ones written below:
    // reading a link target twice would let a concurrently rewritten archive pass the check with one
    // value and extract with another.
    let validated = list_zip_entries(archive_path)?;
    let link_targets: HashMap<&str, &str> = validated
        .iter()
        .filter(|entry| entry.kind == EntryKind::Link)
        .filter_map(|entry| Some((entry.path.as_str(), entry.link_target.as_deref()?)))
        .collect();

    std::fs::create_dir_all(destination)?;
    let mut archive = open(archive_path)?;
    for (index, entry) in validated.iter().enumerate() {
        let output = join_relative(destination, &entry.path);
        match entry.kind {
            EntryKind::Directory => {
                std::fs::create_dir_all(&output)?;
                continue;
            }
            EntryKind::Link => {
                if let Some(parent) = output.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                // Written as the relative string it was validated as, never as a resolved absolute
                // path: the link must mean the same thing wherever the box is extracted.
                let target = link_targets.get(entry.path.as_str()).copied().unwrap_or("");
                create_symlink(target, &output)?;
                continue;
            }
            EntryKind::File => {}
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // `create_new` rather than `create`: an entry must never land on a path another entry
        // already produced, and the filesystem is the last place that can still say so.
        let mut file = new_file(&output, entry.mode)?;
        let mut source = archive
            .by_index(index)
            .map_err(|error| Error::new(format!("cannot read archive entry: {error}")))?;
        std::io::copy(&mut source, &mut file)
            .map_err(|error| Error::new(format!("cannot write {}: {error}", output.display())))?;
    }

    // The archive said what should be written; this asks what actually is.
    validate_extracted_tree(destination, true)
}

#[cfg(unix)]
fn new_file(path: &Path, mode: u32) -> Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt as _;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(if mode == 0 { 0o644 } else { mode })
        .open(path)
        .map_err(|error| Error::new(format!("cannot write {}: {error}", path.display())))
}

#[cfg(not(unix))]
fn new_file(path: &Path, _mode: u32) -> Result<std::fs::File> {
    // Windows extraction restores no mode, which is also why the payload digest does not record one.
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| Error::new(format!("cannot write {}: {error}", path.display())))
}

#[cfg(unix)]
fn create_symlink(target: &str, path: &Path) -> Result<()> {
    std::os::unix::fs::symlink(target, path)
        .map_err(|error| Error::new(format!("cannot write link {}: {error}", path.display())))
}

#[cfg(not(unix))]
fn create_symlink(target: &str, path: &Path) -> Result<()> {
    // A Windows box carries no links at all, so reaching this means an archive built for another
    // target. Creating one needs Developer Mode or elevation, and failing here is the honest answer.
    std::os::windows::fs::symlink_file(target, path)
        .map_err(|error| Error::new(format!("cannot write link {}: {error}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::{assert_no_collisions, classify, ArchiveEntry};
    use crate::contract::links::EntryKind;

    fn entry(path: &str, kind: EntryKind) -> ArchiveEntry {
        ArchiveEntry {
            path: path.to_string(),
            kind,
            size: 0,
            mode: 0o644,
            link_target: None,
        }
    }

    // The classifier is exercised directly rather than through crafted archives, because the ZIP
    // writer cannot emit the two cases that matter most: it refuses to encrypt without the AES
    // feature, and `unix_permissions` masks off exactly the type bits that make an entry special.
    // Testing through a writer that cannot express the hostile input would prove nothing.

    #[test]
    fn an_encrypted_entry_is_refused_before_anything_else() {
        let error = classify("box.json", true, Some(0o100_644), 10).unwrap_err();
        assert!(error.message().contains("Encrypted ZIP entries"), "{error}");
    }

    #[test]
    fn special_entries_are_refused_by_their_type_bits() {
        for (name, mode) in [
            ("fifo", 0o010_000),
            ("device", 0o020_000),
            ("block", 0o060_000),
            ("socket", 0o140_000),
        ] {
            let error = classify(name, false, Some(mode | 0o644), 0).unwrap_err();
            assert!(
                error.message().contains("special entries"),
                "{name} was accepted: {error}"
            );
        }
    }

    #[test]
    fn regular_files_and_directories_are_classified_as_the_format_expects() {
        let file = classify("box.json", false, Some(0o100_644), 12).unwrap();
        assert_eq!(file.kind, EntryKind::File);
        assert_eq!(file.mode, 0o644);

        // A directory is named either by its trailing slash or by its type bits.
        assert_eq!(
            classify("venv/", false, None, 0).unwrap().kind,
            EntryKind::Directory
        );
        assert_eq!(
            classify("venv", false, Some(0o040_755), 0).unwrap().kind,
            EntryKind::Directory
        );

        // An archive with no mode information at all still yields a usable regular file.
        assert_eq!(
            classify("plain.txt", false, None, 3).unwrap().kind,
            EntryKind::File
        );
    }

    #[test]
    fn a_link_is_classified_but_its_target_is_not_yet_known() {
        let link = classify("venv/bin/python", false, Some(0o120_777), 9).unwrap();
        assert_eq!(link.kind, EntryKind::Link);
        assert!(link.link_target.is_none());
    }

    #[test]
    fn an_oversized_link_target_is_refused_before_it_is_read() {
        let error = classify("venv/bin/python", false, Some(0o120_777), 4096).unwrap_err();
        assert!(error.message().contains("link target is too long"), "{error}");
    }

    #[test]
    fn an_entry_name_that_escapes_the_root_is_refused() {
        for name in ["../escape", "/etc/passwd", "C:/windows", "venv/../../out"] {
            let error = classify(name, false, Some(0o100_644), 1).unwrap_err();
            assert!(
                error.message().contains("Unsafe relative path"),
                "{name} was accepted: {error}"
            );
        }
    }

    #[test]
    fn colliding_entries_are_refused_in_every_shape() {
        // The same name twice.
        let duplicate = vec![entry("a.txt", EntryKind::File), entry("a.txt", EntryKind::File)];
        assert!(assert_no_collisions(&duplicate).is_err());

        // A file, then something written underneath it as if it were a directory.
        let through_file = vec![entry("a", EntryKind::File), entry("a/b", EntryKind::File)];
        assert!(assert_no_collisions(&through_file).is_err());

        // The same, in the order that makes the parent appear second.
        let after_children = vec![entry("a/b", EntryKind::File), entry("a", EntryKind::File)];
        assert!(assert_no_collisions(&after_children).is_err());

        // A legitimate tree collides with nothing.
        let fine = vec![
            entry("box.json", EntryKind::File),
            entry("venv", EntryKind::Directory),
            entry("venv/bin", EntryKind::Directory),
            entry("venv/bin/python", EntryKind::File),
        ];
        assert!(assert_no_collisions(&fine).is_ok());
    }
}
