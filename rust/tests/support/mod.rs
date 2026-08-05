//! A real signed box, built on disk, so the archive tests exercise the production path.
//!
//! Everything here is deliberately assembled the way a build assembles it — a `box.json` inside the
//! archive, an interpreter at the layout the target adapter fixes, a release document signed over the
//! archive's actual hash and size. A fixture that shortcut any of those would test a chain this crate
//! never walks.
//!
//! The signing key is a fixed seed rather than a generated one: a fixture that changes every run
//! cannot be reasoned about when it fails. That the crate agrees with the *real* signer is proved
//! separately, in `release_document.rs`, against a document `node:crypto` produced.
//!
//! Rust compiles this module into each integration binary separately, so a helper only one of them
//! uses reads as dead code in the others. That is what the allow below is for, and nothing more.

#![allow(dead_code)]

use std::io::Write as _;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::pkcs8::spki::der::pem::LineEnding;
use ed25519_dalek::pkcs8::spki::EncodePublicKey as _;
use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use scrollcase_consumer::contract::payload_digest::{
    payload_digest_stream, PayloadDigestEntry, PayloadDigestKind, PAYLOAD_DIGEST_FILE,
};
use zip::write::SimpleFileOptions;

pub const KEY_ID: &str = "scrollcase-fixture";
const SIGNING_SEED: [u8; 32] = [7u8; 32];

/// The target this host can actually run.
///
/// `attach` and `run` assert the native host, so a fixture pinned to one platform could only ever be
/// exercised on that platform. Building for the host is what lets the same cases run on all three.
pub fn native_target() -> Value {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => json!({
            "platform": "macos", "arch": "aarch64", "accelerator": "metal",
        }),
        ("windows", _) => json!({
            "platform": "windows", "arch": "x86_64", "accelerator": "cpu",
        }),
        _ => json!({ "platform": "linux", "arch": "x86_64", "accelerator": "cpu" }),
    }
}

/// The interpreter path the native target's adapter fixes.
pub fn native_python_entry_point() -> &'static str {
    if std::env::consts::OS == "windows" {
        "venv/python.exe"
    } else {
        "venv/bin/python"
    }
}

/// One entry to place in the fixture archive.
pub enum Entry {
    File(&'static str, Vec<u8>, u32),
    Link(&'static str, &'static str),
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    Sha256::digest(bytes)
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

/// A scratch directory holding one built box.
pub struct BoxFixture {
    pub directory: PathBuf,
    pub archive_path: PathBuf,
    pub release_path: PathBuf,
    pub key_path: PathBuf,
}

impl Drop for BoxFixture {
    fn drop(&mut self) {
        // Tests never write outside their own temporary directory, and never leave it behind.
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn scratch(name: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = std::env::temp_dir().join(format!("scrollcase-{name}-{unique}"));
    std::fs::create_dir_all(&directory).unwrap();
    directory
}

/// The `box.json` of a valid linux-x86_64-cpu box.
pub fn box_manifest() -> Value {
    json!({
        "schemaVersion": 2,
        "boxId": "fixture-box",
        "modelId": "fixture-model",
        "runtimeId": "fixture-runtime",
        "version": "1.0.0",
        "target": native_target(),
        "pythonEntryPoint": native_python_entry_point(),
        "modelCacheSubdir": "model-cache/fixture",
        "selfTest": { "pythonImports": ["json"], "timeoutSeconds": 30 },
        "execution": { "kind": "python-script", "script": "app/main.py", "defaultArgs": [] },
        "provenance": {
            "scrollId": "fixture-box",
            "scrollVersion": "1.0.0",
            "builderRevision": "b".repeat(40),
            "sourceTreeDirty": false,
            "sourceRevision": "c".repeat(40),
            "pythonVersion": "3.11.9",
            "dependencyLockSha256": "d".repeat(64),
            "builtAt": "2026-01-01T00:00:00.000Z",
            "pixiVersion": "0.50.0"
        }
    })
}

/// A stand-in interpreter that records how it was invoked and obeys the caller's environment.
///
/// Executing a box means executing *its own* interpreter, so a test that shortcut the spawn would
/// prove nothing about the argument vector or the environment. This is a real executable placed at
/// the path the adapter fixes, and it writes down exactly what it received.
pub const FIXTURE_INTERPRETER: &[u8] = b"#!/bin/sh\n\
printf '%s\\n' \"$@\" > invocation.txt\n\
printf '%s' \"${SCROLLCASE_TEST_ENV-}\" > environment.txt\n\
if [ -n \"${SCROLLCASE_TEST_SLEEP-}\" ]; then sleep \"$SCROLLCASE_TEST_SLEEP\"; fi\n\
exit \"${SCROLLCASE_TEST_EXIT-0}\"\n";

/// The default archive contents: metadata, an interpreter, and the declared entry point.
pub fn default_entries(manifest: &Value) -> Vec<Entry> {
    vec![
        Entry::File(
            "box.json",
            serde_json::to_vec_pretty(manifest).unwrap(),
            0o644,
        ),
        Entry::File(native_python_entry_point(), FIXTURE_INTERPRETER.to_vec(), 0o755),
        Entry::File("app/main.py", b"print('fixture')\n".to_vec(), 0o644),
    ]
}

/// Writes an archive holding exactly these entries.
pub fn write_archive(path: &Path, entries: &[Entry]) {
    let file = std::fs::File::create(path).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    for entry in entries {
        match entry {
            Entry::File(name, bytes, mode) => {
                writer
                    .start_file(
                        *name,
                        SimpleFileOptions::default()
                            .compression_method(zip::CompressionMethod::Deflated)
                            .unix_permissions(*mode),
                    )
                    .unwrap();
                writer.write_all(bytes).unwrap();
            }
            Entry::Link(name, target) => {
                writer
                    .add_symlink(*name, *target, SimpleFileOptions::default())
                    .unwrap();
            }
        }
    }
    writer.finish().unwrap();
}

/// Builds the signed release describing an archive on disk.
pub fn release_for(manifest: &Value, archive_path: &Path) -> Value {
    let bytes = std::fs::read(archive_path).unwrap();
    let mut release = manifest.clone();
    let object = release.as_object_mut().unwrap();
    object.insert("kind".to_string(), json!("scrollcase.box.release"));
    object.insert("compatibility".to_string(), json!({}));
    object.insert(
        "archive".to_string(),
        json!({
            "format": "zip",
            "url": "https://example.invalid/fixture.zip",
            "sha256": sha256_hex(&bytes),
            "sizeBytes": bytes.len(),
        }),
    );
    release
}

/// Wraps a payload in the signed envelope, signing it with the fixture key.
pub fn sign(payload: &Value) -> Value {
    let bytes = serde_json::to_vec(payload).unwrap();
    let key = SigningKey::from_bytes(&SIGNING_SEED);
    json!({
        "schemaVersion": 2,
        "payloadEncoding": "base64-json-utf8",
        "payloadBase64": BASE64.encode(&bytes),
        "payloadSha256": sha256_hex(&bytes),
        "signatures": [{
            "algorithm": "ed25519",
            "keyId": KEY_ID,
            "signatureBase64": BASE64.encode(key.sign(&bytes).to_bytes()),
        }],
    })
}

/// Writes the trust file naming the fixture's public key.
pub fn write_key(path: &Path) {
    let key = SigningKey::from_bytes(&SIGNING_SEED);
    let pem = key
        .verifying_key()
        .to_public_key_pem(LineEnding::LF)
        .unwrap();
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&json!({
            "algorithm": "ed25519",
            "keyId": KEY_ID,
            "publicKeyPem": pem,
        }))
        .unwrap(),
    )
    .unwrap();
}

/// Builds a complete fixture, letting a caller mutate the manifest, the entries, and the release
/// before each is committed to disk.
pub fn build(
    name: &str,
    mutate_manifest: impl Fn(&mut Value),
    mutate_entries: impl Fn(&mut Vec<Entry>),
    mutate_release: impl Fn(&mut Value),
) -> BoxFixture {
    let directory = scratch(name);
    let mut manifest = box_manifest();
    mutate_manifest(&mut manifest);

    let mut entries = default_entries(&manifest);
    mutate_entries(&mut entries);

    let archive_path = directory.join("box.zip");
    write_archive(&archive_path, &entries);

    let mut release = release_for(&manifest, &archive_path);
    mutate_release(&mut release);

    let release_path = directory.join("release.json");
    std::fs::write(&release_path, serde_json::to_vec_pretty(&sign(&release)).unwrap()).unwrap();

    let key_path = directory.join("trusted-key.json");
    write_key(&key_path);

    BoxFixture {
        directory,
        archive_path,
        release_path,
        key_path,
    }
}

/// The common case: a valid box with nothing changed.
pub fn valid(name: &str) -> BoxFixture {
    build(name, |_| {}, |_| {}, |_| {})
}

/// The canonical digest list describing a set of archive entries.
///
/// The list cannot appear in its own records — a file cannot contain its own hash — so it is built
/// from everything else and the release commits to it directly.
pub fn payload_digest_stream_for(entries: &[Entry]) -> Vec<u8> {
    let records: Vec<PayloadDigestEntry> = entries
        .iter()
        .map(|entry| match entry {
            Entry::File(name, bytes, _) => PayloadDigestEntry {
                path: (*name).to_string(),
                kind: PayloadDigestKind::File,
                content_sha256: sha256_hex(bytes),
            },
            // A link is hashed over the UTF-8 bytes of its target, never over what it points at.
            Entry::Link(name, target) => PayloadDigestEntry {
                path: (*name).to_string(),
                kind: PayloadDigestKind::Link,
                content_sha256: sha256_hex(target.as_bytes()),
            },
        })
        .collect();
    payload_digest_stream(&records).unwrap()
}

/// Builds a fixture whose release commits to its extracted tree.
pub fn build_with_payload_digest(
    name: &str,
    mutate_entries: impl Fn(&mut Vec<Entry>),
) -> BoxFixture {
    let directory = scratch(name);
    let manifest = box_manifest();

    let mut entries = default_entries(&manifest);
    mutate_entries(&mut entries);
    let stream = payload_digest_stream_for(&entries);
    let digest = sha256_hex(&stream);
    entries.push(Entry::File(PAYLOAD_DIGEST_FILE, stream, 0o644));

    let archive_path = directory.join("box.zip");
    write_archive(&archive_path, &entries);

    let mut release = release_for(&manifest, &archive_path);
    release.as_object_mut().unwrap().insert(
        "payloadDigest".to_string(),
        json!({ "format": "sha256-path-list-v1", "sha256": digest }),
    );

    let release_path = directory.join("release.json");
    std::fs::write(&release_path, serde_json::to_vec_pretty(&sign(&release)).unwrap()).unwrap();

    let key_path = directory.join("trusted-key.json");
    write_key(&key_path);

    BoxFixture {
        directory,
        archive_path,
        release_path,
        key_path,
    }
}

/// Patches the central-directory record of one entry, so a test can build an archive the ZIP writer
/// refuses to produce.
///
/// Two hostile shapes are unreachable through the writer: `unix_permissions` masks off exactly the
/// type bits that make an entry special, and encryption needs a feature this crate does not carry.
/// Both live in the central directory as fixed-offset fields, so editing them there is the honest way
/// to hand the reader the bytes a hostile archive would actually contain.
///
/// A central-directory record is `PK\x01\x02`, then 42 bytes of header, then the name. Within it the
/// general-purpose flag sits at offset 8 and the external attributes at offset 38.
fn patch_central_directory(
    archive: &Path,
    entry_name: &str,
    mut patch: impl FnMut(&mut [u8]),
) {
    const SIGNATURE: [u8; 4] = [b'P', b'K', 1, 2];
    const HEADER_LENGTH: usize = 46;
    let mut bytes = std::fs::read(archive).unwrap();
    let mut cursor = 0usize;
    let mut patched = false;
    while cursor + HEADER_LENGTH <= bytes.len() {
        if bytes[cursor..cursor + 4] != SIGNATURE {
            cursor += 1;
            continue;
        }
        let name_length = u16::from_le_bytes([bytes[cursor + 28], bytes[cursor + 29]]) as usize;
        let name_start = cursor + HEADER_LENGTH;
        if name_start + name_length > bytes.len() {
            break;
        }
        if &bytes[name_start..name_start + name_length] == entry_name.as_bytes() {
            patch(&mut bytes[cursor..cursor + HEADER_LENGTH]);
            patched = true;
            break;
        }
        cursor = name_start + name_length;
    }
    assert!(patched, "no central-directory record named {entry_name}");
    std::fs::write(archive, bytes).unwrap();
}

/// Rewrites an entry's unix type bits, turning a regular file into something a payload may not carry.
pub fn set_entry_file_type(archive: &Path, entry_name: &str, file_type: u32) {
    patch_central_directory(archive, entry_name, |header| {
        let mode = file_type | 0o644;
        header[38..42].copy_from_slice(&(mode << 16).to_le_bytes());
    });
}

/// Sets the general-purpose encryption bit on an entry.
pub fn mark_entry_encrypted(archive: &Path, entry_name: &str) {
    patch_central_directory(archive, entry_name, |header| {
        let flag = u16::from_le_bytes([header[8], header[9]]) | 0x0001;
        header[8..10].copy_from_slice(&flag.to_le_bytes());
    });
}

/// Renames an entry by patching its bytes, for names the ZIP writer refuses to produce.
///
/// The writer rejects a duplicate filename and normalises a traversing or absolute one — reasonably,
/// since it is meant to write valid archives. A consumer must still be handed the invalid ones, so
/// the entry is written under a placeholder of the same length and renamed here. Equal length is what
/// keeps every stored offset valid, so no other field has to be recomputed.
pub fn rename_entry_bytes(archive: &Path, from: &str, to: &str) {
    assert_eq!(
        from.len(),
        to.len(),
        "renaming a ZIP entry in place needs names of equal length"
    );
    let bytes = std::fs::read(archive).unwrap();
    let mut patched = Vec::with_capacity(bytes.len());
    let mut cursor = 0usize;
    let mut hits = 0usize;
    while cursor < bytes.len() {
        if bytes[cursor..].starts_with(from.as_bytes()) {
            patched.extend_from_slice(to.as_bytes());
            cursor += from.len();
            hits += 1;
            continue;
        }
        patched.push(bytes[cursor]);
        cursor += 1;
    }
    // Once in the local header, once in the central directory.
    assert!(hits >= 2, "expected {from} in both headers, found {hits}");
    std::fs::write(archive, patched).unwrap();
}
