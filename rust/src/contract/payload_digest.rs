//! Mirror of the rule deciding what a box commits to about its own extracted tree.
//!
//! A signed release commits to the archive's SHA-256, which proves every payload byte — but only
//! while the archive still exists. An application that installs a box once and runs it for months
//! has thrown that archive away. So a box also carries a *list*: one record per payload entry,
//! naming it and hashing its content. The release signs the SHA-256 of that list, and the list
//! travels inside the payload.
//!
//! The list is what makes verification a closed question. A verifier walks the *list*, never the
//! directory, so anything the list does not name is never visited: the `__pycache__` Python writes on
//! first import, the model cache a caller fills after extraction, the file an application writes into
//! its own working directory. Those are invisible by construction rather than by an exclusion list.
//!
//! Records are sorted by their own bytes rather than by their paths compared as strings. The two are
//! the same ordering — a path cannot contain NUL, and NUL sorts below every byte a path can hold —
//! but only one of them is unambiguous across languages. Comparing strings would ask each
//! implementation to agree on what a string is, and above the Basic Multilingual Plane JavaScript
//! orders by UTF-16 code unit while Python orders by code point. Rust would order by UTF-8 bytes and
//! quietly agree with neither, which is precisely why the format does not ask.
//!
//! `tests/contract.rs` proves this mirror against `fixtures/payload-digest-contract.json`.

use crate::error::{fail, Result};

use super::documents::sha256_hex;

/// The `format` a release names, and the first line of the stream it names it for.
pub const PAYLOAD_DIGEST_FORMAT: &str = "sha256-path-list-v1";

/// Where the list lives inside the payload.
///
/// It cannot appear in its own records — a file cannot contain its own hash — so the release commits
/// to it directly and it commits to everything else.
pub const PAYLOAD_DIGEST_FILE: &str = "payload-digest.v1";

/// The largest list a verifier will read before refusing.
///
/// At roughly a hundred bytes per record this is some two million entries, an order of magnitude past
/// the densest real prefix. The bound exists because the list arrives from the same untrusted tree it
/// describes, and reading it must not be the thing that exhausts memory.
pub const MAX_PAYLOAD_DIGEST_BYTES: u64 = 256 * 1024 * 1024;

const NUL: u8 = 0x00;
const LF: u8 = 0x0a;
const FILE_BYTE: u8 = b'f';
const LINK_BYTE: u8 = b'l';
const SHA256_HEX_LENGTH: usize = 64;

/// What a payload entry is, as the digest sees it. Directories are not represented: neither the
/// entry collector nor the archive writer produces one, so an empty directory is already lost
/// between build and install.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayloadDigestKind {
    /// A regular file, hashed over its bytes.
    File,
    /// A link, hashed over the UTF-8 bytes of its target.
    Link,
}

impl PayloadDigestKind {
    fn as_byte(self) -> u8 {
        match self {
            Self::File => FILE_BYTE,
            Self::Link => LINK_BYTE,
        }
    }

    fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            FILE_BYTE => Some(Self::File),
            LINK_BYTE => Some(Self::Link),
            _ => None,
        }
    }
}

/// One payload entry as the digest sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadDigestEntry {
    /// Payload-relative path, forward slashes.
    pub path: String,
    /// Whether the record describes a file or a link.
    pub kind: PayloadDigestKind,
    /// Lowercase hex SHA-256 of the file's bytes, or of the link body.
    pub content_sha256: String,
}

/// What a release carries to commit to its extracted tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadDigest {
    /// Always [`PAYLOAD_DIGEST_FORMAT`].
    pub format: &'static str,
    /// SHA-256 of the canonical stream.
    pub sha256: String,
}

/// Whether a value is lowercase hex SHA-256.
fn is_sha256_hex(value: &str) -> bool {
    value.len() == SHA256_HEX_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Serialises payload entries into the canonical bytes a release commits to.
///
/// The format name is inside the stream rather than only beside it in the manifest, so a later
/// revision cannot produce the same bytes for different rules, and the `format` field cannot be
/// swapped without the hash noticing.
///
/// # Errors
///
/// When an entry carries an empty path, a NUL in its path, a duplicate path, or a digest that is not
/// lowercase hex SHA-256.
pub fn payload_digest_stream(entries: &[PayloadDigestEntry]) -> Result<Vec<u8>> {
    let mut records: Vec<Vec<u8>> = Vec::with_capacity(entries.len());
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for entry in entries {
        // Asserted rather than assumed: a NUL would end the path field early and let two different
        // trees produce one stream. `safe_relative_path` already refuses it, and POSIX cannot
        // express it.
        if entry.path.is_empty() || entry.path.contains('\0') {
            fail!("Unsupported payload entry path: {:?}", entry.path);
        }
        if !seen.insert(entry.path.as_str()) {
            fail!("Duplicate payload entry: {}", entry.path);
        }
        if !is_sha256_hex(&entry.content_sha256) {
            fail!(
                "Invalid payload entry digest for {}: {}",
                entry.path,
                entry.content_sha256
            );
        }

        let path_bytes = entry.path.as_bytes();
        let mut record = Vec::with_capacity(path_bytes.len() + SHA256_HEX_LENGTH + 4);
        record.extend_from_slice(path_bytes);
        record.push(NUL);
        record.push(entry.kind.as_byte());
        record.push(NUL);
        record.extend_from_slice(entry.content_sha256.as_bytes());
        record.push(LF);
        records.push(record);
    }
    records.sort_unstable();

    let mut stream = Vec::new();
    stream.extend_from_slice(PAYLOAD_DIGEST_FORMAT.as_bytes());
    stream.push(LF);
    for record in records {
        stream.extend_from_slice(&record);
    }
    Ok(stream)
}

/// Serialises the entries and returns what a release carries about them.
///
/// # Errors
///
/// When the entries cannot be serialised — see [`payload_digest_stream`].
pub fn payload_digest(entries: &[PayloadDigestEntry]) -> Result<PayloadDigest> {
    let stream = payload_digest_stream(entries)?;
    Ok(PayloadDigest {
        format: PAYLOAD_DIGEST_FORMAT,
        sha256: sha256_hex(&stream),
    })
}

/// Reads a list back into entries, refusing anything a serialiser could not have produced.
///
/// This parses bytes that arrived with the tree they describe, so it is written as a scanner over a
/// fixed frame rather than a split on separators: a newline is legal inside a filename, and only the
/// NUL delimiter and the fixed-width hash field make the framing unambiguous. A caller must have
/// already compared the stream's hash against the signed release — parsing is not a trust decision,
/// and nothing here makes untrusted bytes safe.
///
/// # Errors
///
/// When the stream is not exactly what [`payload_digest_stream`] emits.
pub fn parse_payload_digest_stream(bytes: &[u8]) -> Result<Vec<PayloadDigestEntry>> {
    let mut header = Vec::from(PAYLOAD_DIGEST_FORMAT.as_bytes());
    header.push(LF);
    if bytes.len() < header.len() || &bytes[..header.len()] != header.as_slice() {
        fail!("Payload digest list does not carry the expected format header.");
    }

    let mut entries = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut cursor = header.len();
    let mut previous: Option<&[u8]> = None;
    while cursor < bytes.len() {
        let start = cursor;
        let Some(offset) = bytes[cursor..].iter().position(|byte| *byte == NUL) else {
            fail!("Payload digest list ends inside a record.");
        };
        let path_end = cursor + offset;
        // The frame after the path is fixed: kind, NUL, sixty-four hex digits, newline.
        let end = path_end + SHA256_HEX_LENGTH + 4;
        if end > bytes.len() {
            fail!("Payload digest list ends inside a record.");
        }
        let Some(kind) = PayloadDigestKind::from_byte(bytes[path_end + 1]) else {
            fail!("Payload digest list holds a malformed record.");
        };
        if bytes[path_end + 2] != NUL || bytes[end - 1] != LF {
            fail!("Payload digest list holds a malformed record.");
        }

        let (Ok(path), Ok(content_sha256)) = (
            std::str::from_utf8(&bytes[start..path_end]),
            std::str::from_utf8(&bytes[path_end + 3..end - 1]),
        ) else {
            fail!("Payload digest list holds bytes that are not valid UTF-8.");
        };
        if !is_sha256_hex(content_sha256) {
            fail!("Payload digest list holds an invalid digest for {path}.");
        }
        if !seen.insert(path.to_string()) {
            fail!("Payload digest list names {path} twice.");
        }

        // Order is part of the format, not a convenience: a reader that accepted any order would
        // accept streams the builder cannot emit, and two trees could then share one hash.
        let record = &bytes[start..end];
        if previous.is_some_and(|earlier| earlier >= record) {
            fail!("Payload digest list is not in canonical order.");
        }
        previous = Some(record);

        entries.push(PayloadDigestEntry {
            path: path.to_string(),
            kind,
            content_sha256: content_sha256.to_string(),
        });
        cursor = end;
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_payload_digest_stream, payload_digest_stream, PayloadDigestEntry, PayloadDigestKind,
        PAYLOAD_DIGEST_FORMAT,
    };

    fn entry(path: &str, kind: PayloadDigestKind, digest_byte: u8) -> PayloadDigestEntry {
        PayloadDigestEntry {
            path: path.to_string(),
            kind,
            content_sha256: format!("{digest_byte:02x}").repeat(32),
        }
    }

    fn file(path: &str) -> PayloadDigestEntry {
        entry(path, PayloadDigestKind::File, 0xab)
    }

    #[test]
    fn an_empty_payload_still_commits_to_its_format() {
        let stream = payload_digest_stream(&[]).unwrap();
        assert_eq!(stream, format!("{PAYLOAD_DIGEST_FORMAT}\n").into_bytes());
        assert!(parse_payload_digest_stream(&stream).unwrap().is_empty());
    }

    #[test]
    fn a_round_trip_preserves_every_record() {
        let entries = vec![
            file("venv/bin/python3.11"),
            entry("venv/bin/python", PayloadDigestKind::Link, 0x01),
            file("box.json"),
        ];
        let stream = payload_digest_stream(&entries).unwrap();
        let parsed = parse_payload_digest_stream(&stream).unwrap();
        // Sorted by record bytes, so the parse comes back in canonical order rather than input order.
        let paths: Vec<&str> = parsed.iter().map(|entry| entry.path.as_str()).collect();
        assert_eq!(paths, ["box.json", "venv/bin/python", "venv/bin/python3.11"]);
        assert_eq!(parsed[1].kind, PayloadDigestKind::Link);
    }

    #[test]
    fn a_newline_inside_a_filename_does_not_break_the_framing() {
        let entries = vec![file("we\nird"), file("weird")];
        let stream = payload_digest_stream(&entries).unwrap();
        let parsed = parse_payload_digest_stream(&stream).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].path, "we\nird");
    }

    #[test]
    fn a_serialiser_refuses_what_it_could_not_frame() {
        assert!(payload_digest_stream(&[file("")]).is_err());
        assert!(payload_digest_stream(&[file("a\0b")]).is_err());
        assert!(payload_digest_stream(&[file("a"), file("a")]).is_err());

        let mut bad_digest = file("a");
        bad_digest.content_sha256 = "NOTHEX".to_string();
        assert!(payload_digest_stream(&[bad_digest]).is_err());

        let mut uppercase = file("a");
        uppercase.content_sha256 = "AB".repeat(32);
        assert!(payload_digest_stream(&[uppercase]).is_err());
    }

    #[test]
    fn a_reader_refuses_streams_the_builder_cannot_emit() {
        let good = payload_digest_stream(&[file("a"), file("b")]).unwrap();

        // Wrong header.
        assert!(parse_payload_digest_stream(b"sha256-path-list-v2\n").is_err());
        assert!(parse_payload_digest_stream(b"").is_err());

        // Truncated inside a record.
        assert!(parse_payload_digest_stream(&good[..good.len() - 1]).is_err());

        // Reordered: same records, order the serialiser would never produce.
        let header_length = PAYLOAD_DIGEST_FORMAT.len() + 1;
        let record_length = 1 + 64 + 4;
        let mut reordered = good[..header_length].to_vec();
        reordered.extend_from_slice(&good[header_length + record_length..]);
        reordered.extend_from_slice(&good[header_length..header_length + record_length]);
        let error = parse_payload_digest_stream(&reordered).unwrap_err();
        assert!(error.message().contains("canonical order"), "{error}");

        // A kind byte the format does not define.
        let mut wrong_kind = good.clone();
        wrong_kind[header_length + 2] = b'd';
        assert!(parse_payload_digest_stream(&wrong_kind).is_err());
    }
}
