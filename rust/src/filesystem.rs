//! Reading a payload tree, and refusing one that is not a payload tree.
//!
//! Everything here walks with `symlink_metadata`, never `metadata`. Following a link while deciding
//! what an entry *is* would let a link to a directory be walked into as a directory, which is the
//! exact confusion the link rules exist to remove.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::contract::links::{find_entry_through_link, find_unresolvable_link, EntryKind, PayloadEntry};
use crate::error::{fail, Error, Result};

/// Names a build never carries into a payload, and that an installed tree grows on its own.
const IGNORED_NAMES: &[&str] = &["__pycache__", ".DS_Store"];

/// Lowercase hex SHA-256 of a file's bytes, streamed rather than buffered.
///
/// # Errors
///
/// When the file cannot be read.
pub fn sha256_file(path: &Path) -> Result<String> {
    use std::io::Read as _;
    let mut file = std::fs::File::open(path)
        .map_err(|error| Error::new(format!("cannot read {}: {error}", path.display())))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 128 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| Error::new(format!("cannot read {}: {error}", path.display())))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    Ok(hex)
}

/// Lists payload entries in the stable order hashing and archive creation use.
///
/// A payload may hold regular files and the narrow class of links the contract permits; anything
/// else — a socket, a device, a fifo — is refused, because nothing that is not one of those two
/// things can be archived, hashed or relocated meaningfully.
///
/// # Errors
///
/// When the tree cannot be read, or holds an entry that is neither a file nor a link.
pub fn collect_entries(root: &Path) -> Result<Vec<PayloadEntry>> {
    let mut entries = Vec::new();
    collect_into(root, root, &mut entries)?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

fn collect_into(root: &Path, current: &Path, entries: &mut Vec<PayloadEntry>) -> Result<()> {
    let mut names: Vec<PathBuf> = std::fs::read_dir(current)
        .map_err(|error| Error::new(format!("cannot read {}: {error}", current.display())))?
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .collect();
    names.sort();

    for path in names {
        let name = path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .unwrap_or_default()
            .to_string();
        // Case-sensitive on purpose: CPython writes `.pyc` and nothing else, and the Node and
        // Python collectors compare the same way. A case-insensitive match here would skip a payload
        // file the other implementations carry.
        #[allow(clippy::case_sensitive_file_extension_comparisons)]
        if IGNORED_NAMES.contains(&name.as_str()) || name.ends_with(".pyc") {
            continue;
        }
        let relative = relative_forward_slash(root, &path)?;
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| Error::new(format!("cannot read {}: {error}", path.display())))?;
        // Order matters: a link to a directory reports `is_dir()` false under symlink_metadata, but
        // classifying by directory first would still walk into one on a following stat.
        if metadata.is_symlink() {
            let target = std::fs::read_link(&path)
                .map_err(|error| Error::new(format!("cannot read {}: {error}", path.display())))?;
            entries.push(PayloadEntry::link(
                relative,
                target.to_string_lossy().replace('\\', "/"),
            ));
        } else if metadata.is_dir() {
            collect_into(root, &path, entries)?;
        } else if metadata.is_file() {
            entries.push(PayloadEntry::file(relative));
        } else {
            fail!("box special entries are not allowed: {relative}");
        }
    }
    Ok(())
}

fn relative_forward_slash(root: &Path, path: &Path) -> Result<String> {
    let Ok(relative) = path.strip_prefix(root) else {
        fail!("Unsafe relative path: {}", path.display());
    };
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

/// Every path in a payload that resolves to content: regular files and the links to them.
///
/// A link is included deliberately. A real box reaches its interpreter through exactly that shape —
/// `venv/bin/python` links to the versioned binary beside it — so a check that accepted only regular
/// files here would reject every box the builder produces on macOS and Linux. The archive side asks
/// the same question of the same set; only reading `box.json` needs an entry with its own bytes.
///
/// # Errors
///
/// See [`collect_entries`].
pub fn collect_files(root: &Path) -> Result<BTreeSet<String>> {
    Ok(collect_entries(root)?
        .into_iter()
        .filter(|entry| entry.kind != EntryKind::Directory)
        .map(|entry| entry.path)
        .collect())
}

/// Logical size of a payload.
///
/// A link contributes the length of its target string, which is what a POSIX filesystem reports as
/// its size and what the Node and Python consumers therefore measure. Counting it as zero would make
/// an honest box with a linked interpreter fail its own signed `installedSizeBytes`.
///
/// # Errors
///
/// See [`collect_entries`].
pub fn payload_size(root: &Path) -> Result<u64> {
    let mut total = 0u64;
    for entry in collect_entries(root)? {
        if entry.kind == EntryKind::Directory {
            continue;
        }
        let path = crate::path::join_relative(root, &entry.path);
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| Error::new(format!("cannot read {}: {error}", path.display())))?;
        total = total.saturating_add(metadata.len());
    }
    Ok(total)
}

/// Re-applies the payload rules to a tree that has just been written.
///
/// Validating the archive before extraction says what *should* have been written; this says what is
/// actually on disk. They are different questions, and only the second one accounts for a filesystem
/// that resolved two entry names to one path.
///
/// # Errors
///
/// When the tree holds a special entry, or a link the contract does not permit.
pub fn validate_extracted_tree(root: &Path, allow_links: bool) -> Result<()> {
    let entries = collect_entries(root)?;
    if !allow_links {
        if let Some(link) = entries.iter().find(|entry| entry.kind == EntryKind::Link) {
            fail!("Archive links and special entries are not allowed: {}", link.path);
        }
        return Ok(());
    }
    if let Some(path) = find_unresolvable_link(&entries) {
        fail!("Extracted link does not resolve to a file inside the payload: {path}");
    }
    if let Some(path) = find_entry_through_link(&entries) {
        fail!("Extracted entry would be written through a link: {path}");
    }
    Ok(())
}
