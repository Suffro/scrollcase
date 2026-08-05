//! The half of the trust chain that needs no archive.
//!
//! Everything here answers questions about the signed document alone — is the signature good, is the
//! payload a schema-version-2 release, does it describe a target this build understands. It is split
//! out for the same reason Node splits it: a box that is already extracted has no archive to check,
//! and re-deriving these steps beside the ones that do would create the second interpretation of a
//! signed release that the shared inspection exists to prevent.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::archive::{list_zip_entries, read_zip_entry_text, ArchiveEntry};
use crate::contract::documents::SignedDocument;
use crate::contract::links::EntryKind;
use crate::contract::targets::{assert_python_entry_point, box_target_adapter, BoxTargetAdapter};
use crate::error::{fail, Error, Result};
use crate::execution::assert_execution_files;
use crate::filesystem::sha256_file;
use crate::release::{BoxManifest, ReleaseManifest};
use crate::trust::{load_trusted_keys, verify_signed_document, TrustedKey};

/// A signed release that has passed every check possible without its archive.
#[derive(Debug, Clone)]
pub struct InspectedRelease {
    /// Where the document was read from.
    pub release_path: PathBuf,
    /// The envelope exactly as received, kept so a caller can persist what it verified.
    pub signed: SignedDocument,
    /// The verified release.
    pub release: ReleaseManifest,
    /// The adapter for the release's target.
    pub adapter: &'static BoxTargetAdapter,
}

/// Verifies a signed release document against a caller-supplied trust file.
///
/// The order is the guarantee. The envelope is shape-checked, then its signature is verified, and
/// only then is the payload interpreted as a release: nothing about the release is believed — not
/// its target, not its paths, not its provenance — until a trusted key has vouched for the exact
/// bytes it was read from.
///
/// # Errors
///
/// When the document cannot be read, is not a v2 envelope, carries no signature from a trusted key,
/// or describes a release this build cannot accept.
pub fn inspect_release_document(
    release_document_path: &Path,
    public_key_path: &Path,
) -> Result<InspectedRelease> {
    let trusted = load_trusted_keys(public_key_path)?;
    inspect_release_document_with_keys(release_document_path, &trusted)
}

/// The same inspection against keys a caller already holds in memory.
///
/// # Errors
///
/// See [`inspect_release_document`].
pub fn inspect_release_document_with_keys(
    release_document_path: &Path,
    trusted: &[TrustedKey],
) -> Result<InspectedRelease> {
    let release_path = release_document_path
        .canonicalize()
        .unwrap_or_else(|_| release_document_path.to_path_buf());
    let raw = std::fs::read(&release_path).map_err(|error| {
        Error::new(format!(
            "Invalid signed release document {}: {error}",
            release_path.display()
        ))
    })?;

    let signed = SignedDocument::parse(&raw)?;
    let payload = verify_signed_document(&signed, trusted)?;

    // A v1 payload inside a v2 envelope is refused by name rather than reinterpreted.
    if payload.value.get("schemaVersion").and_then(serde_json::Value::as_u64) == Some(1) {
        fail!("Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.");
    }
    let release: ReleaseManifest = serde_json::from_value(payload.value)
        .map_err(|error| Error::new(format!("Invalid release manifest: {error}.")))?;
    release.validate()?;

    let adapter = box_target_adapter(&release.target)?;
    assert_python_entry_point(adapter, &release.python_entry_point)?;

    Ok(InspectedRelease {
        release_path,
        signed,
        release,
        adapter,
    })
}

/// Binds the self-description inside the archive to the signed release outside it.
///
/// Only fields present in both schema-version-2 documents belong here. Release-only transport data
/// has no counterpart in `box.json`; every shared identity, target, layout, self-test, environment,
/// asset-policy and provenance field must agree. Without this, a correctly hashed archive could be
/// paired with a signed manifest describing something else entirely.
///
/// # Errors
///
/// When any shared field differs, naming the first one that does.
pub fn assert_box_manifest_agreement(
    box_manifest: &BoxManifest,
    release: &ReleaseManifest,
) -> Result<()> {
    // Written as explicit pairs rather than a derived comparison so the field name in the message is
    // the field that actually differed — the Node and Python consumers report the same way, and the
    // conformance fixture pins `box.json mismatch: modelId` among others.
    let mismatch = if box_manifest.schema_version != release.schema_version {
        Some("schemaVersion")
    } else if box_manifest.box_id != release.box_id {
        Some("boxId")
    } else if box_manifest.model_id != release.model_id {
        Some("modelId")
    } else if box_manifest.runtime_id != release.runtime_id {
        Some("runtimeId")
    } else if box_manifest.version != release.version {
        Some("version")
    } else if box_manifest.target != release.target {
        Some("target")
    } else if box_manifest.python_entry_point != release.python_entry_point {
        Some("pythonEntryPoint")
    } else if box_manifest.model_cache_subdir != release.model_cache_subdir {
        Some("modelCacheSubdir")
    } else if box_manifest.environment != release.environment {
        Some("environment")
    } else if box_manifest.self_test != release.self_test {
        Some("selfTest")
    } else if box_manifest.execution != release.execution {
        Some("execution")
    } else if box_manifest.weights != release.weights {
        Some("weights")
    } else if box_manifest.assets != release.assets {
        Some("assets")
    } else if box_manifest.provenance != release.provenance {
        Some("provenance")
    } else {
        None
    };
    if let Some(field) = mismatch {
        fail!("box.json mismatch: {field}");
    }
    Ok(())
}

/// A signed release together with the archive it commits to, both checked.
#[derive(Debug, Clone)]
pub struct InspectedArchive {
    /// The archive-free half of the chain.
    pub release: InspectedRelease,
    /// Where the archive was read from.
    pub archive_path: PathBuf,
    /// The box's own self-description, proved to agree with the release.
    pub box_manifest: BoxManifest,
    /// Every validated archive entry.
    pub entries: Vec<ArchiveEntry>,
}

/// Performs the complete read-only trust chain, archive included.
///
/// Keeping this as one operation matters: an execution API must not create a second, subtly
/// different interpretation of a signed release. The caller receives validated in-memory objects and
/// the exact archive path, while extraction and execution remain separate steps.
///
/// # Errors
///
/// When the release fails inspection, the archive is missing or does not match its signed size and
/// hash, the archive holds an entry the format forbids, or `box.json` disagrees with the release.
pub fn inspect_box_archive(
    release_document_path: &Path,
    public_key_path: &Path,
    archive_override: Option<&Path>,
) -> Result<InspectedArchive> {
    let release = inspect_release_document(release_document_path, public_key_path)?;
    inspect_archive_for(release, archive_override)
}

/// The archive half, against a release this process already inspected.
///
/// # Errors
///
/// See [`inspect_box_archive`].
pub fn inspect_archive_for(
    inspected: InspectedRelease,
    archive_override: Option<&Path>,
) -> Result<InspectedArchive> {
    let release = &inspected.release;
    // By convention the archive sits next to its release document under the hash that document
    // commits to — the same name it is published under, so this resolves identically against a local
    // dist tree and a directory copied from a mirror.
    let archive_path = match archive_override {
        Some(path) => path.to_path_buf(),
        None => inspected
            .release_path
            .parent()
            .unwrap_or(Path::new("."))
            .join(format!("{}.zip", release.archive.sha256)),
    };
    let metadata = std::fs::metadata(&archive_path)
        .map_err(|_| Error::new(format!("Archive not found: {}", archive_path.display())))?;
    if metadata.len() != release.archive.size_bytes {
        fail!("Archive size mismatch.");
    }
    if sha256_file(&archive_path)? != release.archive.sha256 {
        fail!("Archive SHA-256 mismatch.");
    }

    let entries = list_zip_entries(&archive_path)?;
    // Two questions, deliberately not the same set. `box.json` is read out of the archive, so it must
    // be an entry with its own bytes. Everything else asks only whether a path resolves — and a link
    // does resolve, to a file inside this same payload, because nothing else was allowed in.
    let files: BTreeSet<String> = entries
        .iter()
        .filter(|entry| entry.kind == EntryKind::File)
        .map(|entry| entry.path.clone())
        .collect();
    let resolvable: BTreeSet<String> = entries
        .iter()
        .filter(|entry| matches!(entry.kind, EntryKind::File | EntryKind::Link))
        .map(|entry| entry.path.clone())
        .collect();

    if !files.contains("box.json") {
        fail!("Archive is missing box.json.");
    }
    let raw = read_zip_entry_text(&archive_path, "box.json")?;
    let box_manifest: BoxManifest = serde_json::from_str(&raw)
        .map_err(|error| Error::new(format!("Invalid box.json: {error}.")))?;
    assert_box_manifest_agreement(&box_manifest, release)?;

    if !resolvable.contains(&release.python_entry_point) {
        fail!("Archive is missing {}.", release.python_entry_point);
    }
    assert_execution_files(
        release.execution.as_ref(),
        inspected.adapter,
        &release.provenance.python_version,
        &resolvable,
    )?;

    Ok(InspectedArchive {
        release: inspected,
        archive_path,
        box_manifest,
        entries,
    })
}
