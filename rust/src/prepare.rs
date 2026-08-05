//! Verification and durable preparation of a caller-supplied local box.
//!
//! A [`PreparedBox`] is deliberately opaque. Its accessors expose useful signed identity and audit
//! data, while the verified release and the root's filesystem identity stay private. A caller
//! therefore cannot construct something that looks prepared and use it to skip the trust chain before
//! execution — in Rust that is not a convention but a property of the type: the fields are private,
//! there is no public constructor, and the only values in existence came from a function that
//! performed the checks.
//!
//! `status` says which of the two producers minted a receipt, because they do not prove the same
//! thing. `Prepared` means the bytes came from an archive whose signed hash was checked in this
//! process. `Attached` means an existing directory was re-identified against a signed release with no
//! archive to check it against — and the receipt must not claim more than that.

use std::collections::BTreeMap;
use std::fs::Metadata;
use std::path::{Path, PathBuf};

use crate::archive::extract_zip_archive;
use crate::contract::payload_digest::{
    parse_payload_digest_stream, PayloadDigestKind, MAX_PAYLOAD_DIGEST_BYTES, PAYLOAD_DIGEST_FILE,
};
use crate::contract::targets::{assert_native_host, box_target_id, BoxTargetAdapter};
use crate::environment::{
    resolve_environment, EnvironmentLayer, EnvironmentReport, EnvironmentSource, ResolveOptions,
};
use crate::error::{fail, Error, Result};
use crate::execution::assert_execution_files;
use crate::filesystem::{collect_files, payload_size, sha256_file};
use crate::path::{join_relative, safe_relative_path};
use crate::release::{AssetDescriptor, Execution, ReleaseManifest};
use crate::verify::{inspect_archive_for, inspect_release_document, InspectedRelease};

/// Which producer minted a receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedStatus {
    /// Extracted in this process from an archive whose signed hash was checked.
    Prepared,
    /// Re-identified from an existing directory, with no archive to check it against.
    Attached,
}

/// How much of the environment a verification receipt should describe.
#[derive(Debug, Clone, Default)]
pub struct EnvironmentReportOptions {
    /// List every variable rather than only the actionable ones.
    pub env_report: bool,
    /// Show inherited host values rather than masking them. Implies `env_report`.
    pub env_report_values: bool,
    /// The inherited environment the report resolves against. Defaults to this process's, and is
    /// injectable so a test can state one without mutating what every thread in the process shares.
    pub host_environment: Option<Vec<(String, String)>>,
}

/// On unix a root is identified by the pair that survives a rename; elsewhere by its canonical path.
///
/// The unix form is strictly stronger: it detects a directory swapped for another at the same name.
/// The fallback is what the platform makes available without opening a directory handle, and saying
/// so is better than implying a guarantee that is not there.
#[cfg(unix)]
type RootIdentity = (u64, u64);
#[cfg(not(unix))]
type RootIdentity = PathBuf;

// Fallible on the other branch, where canonicalising can fail, so both keep one signature.
#[cfg_attr(unix, allow(clippy::unnecessary_wraps))]
#[cfg(unix)]
fn root_identity(_path: &Path, metadata: &Metadata) -> Result<RootIdentity> {
    use std::os::unix::fs::MetadataExt as _;
    Ok((metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn root_identity(path: &Path, _metadata: &Metadata) -> Result<RootIdentity> {
    std::fs::canonicalize(path)
        .map_err(|error| Error::new(format!("cannot identify {}: {error}", path.display())))
}

/// Whether the directory that landed at the destination is the one that was staged.
///
/// On unix the inode pair survives a rename, so this is a real check: it catches the staged tree
/// being swapped for another between the move and the receipt. Elsewhere a directory's identity *is*
/// its path, and the rename changed the path deliberately, so there is nothing to compare — saying
/// so is better than inventing a comparison that would either always pass or always fail.
#[cfg(unix)]
fn survived_the_rename(staged: &Metadata, installed: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt as _;
    (staged.dev(), staged.ino()) == (installed.dev(), installed.ino())
}

#[cfg(not(unix))]
fn survived_the_rename(_staged: &Metadata, installed: &Metadata) -> bool {
    installed.is_dir()
}

/// The immutable result of a successfully verified box.
#[derive(Debug, Clone)]
pub struct PreparedBox {
    status: PreparedStatus,
    root: PathBuf,
    target_id: String,
    signing_key_ids: Vec<String>,
    release_payload_sha256: String,
    installed_size_bytes: u64,
    environment_report: EnvironmentReport,
    release: ReleaseManifest,
    // Private state read only by the execution surface. Never accessors: nothing outside this crate
    // may reach them, which is what stops a caller from reconstructing a receipt.
    adapter: &'static BoxTargetAdapter,
    root_identity: RootIdentity,
}

impl PreparedBox {
    /// Which producer minted this receipt, and therefore what it proves.
    #[must_use]
    pub fn status(&self) -> PreparedStatus {
        self.status
    }

    /// Absolute path of the extracted box root.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Box identity, from the signed release.
    #[must_use]
    pub fn box_id(&self) -> &str {
        &self.release.box_id
    }

    /// Model identity, from the signed release.
    #[must_use]
    pub fn model_id(&self) -> &str {
        &self.release.model_id
    }

    /// Installed-directory identity, from the signed release.
    #[must_use]
    pub fn runtime_id(&self) -> &str {
        &self.release.runtime_id
    }

    /// Box version, from the signed release.
    #[must_use]
    pub fn version(&self) -> &str {
        &self.release.version
    }

    /// Canonical target slug.
    #[must_use]
    pub fn target_id(&self) -> &str {
        &self.target_id
    }

    /// Interpreter path, relative to the box root.
    #[must_use]
    pub fn python_entry_point(&self) -> &str {
        &self.release.python_entry_point
    }

    /// The declared application entry point, if the box has one.
    #[must_use]
    pub fn execution(&self) -> Option<&Execution> {
        self.release.execution.as_ref()
    }

    /// Assets the caller must materialise. Scrollcase never downloads them.
    #[must_use]
    pub fn required_assets(&self) -> &[AssetDescriptor] {
        required_assets_of(&self.release)
    }

    /// Which keys signed the release this box was verified against.
    #[must_use]
    pub fn signing_key_ids(&self) -> &[String] {
        &self.signing_key_ids
    }

    /// SHA-256 of the signed release payload.
    #[must_use]
    pub fn release_payload_sha256(&self) -> &str {
        &self.release_payload_sha256
    }

    /// SHA-256 the signed release commits the archive to.
    #[must_use]
    pub fn archive_sha256(&self) -> &str {
        &self.release.archive.sha256
    }

    /// Size the signed release commits the archive to.
    #[must_use]
    pub fn archive_size_bytes(&self) -> u64 {
        self.release.archive.size_bytes
    }

    /// Logical size of the box root when this receipt was produced.
    ///
    /// On an attached receipt this is a current measurement, never an agreement with the release: an
    /// installed tree legitimately grows after extraction.
    #[must_use]
    pub fn installed_size_bytes(&self) -> u64 {
        self.installed_size_bytes
    }

    /// Diagnostic snapshot of this process's environment against the signed declaration.
    #[must_use]
    pub fn environment_report(&self) -> &EnvironmentReport {
        &self.environment_report
    }

    /// The verified release, for code inside this crate only.
    pub(crate) fn release(&self) -> &ReleaseManifest {
        &self.release
    }

    /// The target adapter, for code inside this crate only.
    pub(crate) fn adapter(&self) -> &'static BoxTargetAdapter {
        self.adapter
    }

    /// Re-checks that the root is still the directory this receipt was minted for.
    pub(crate) fn assert_root_unchanged(&self) -> Result<()> {
        let Ok(metadata) = std::fs::symlink_metadata(&self.root) else {
            fail!("Prepared box root no longer matches the prepared box.");
        };
        if !metadata.is_dir() || root_identity(&self.root, &metadata)? != self.root_identity {
            fail!("Prepared box root no longer matches the prepared box.");
        }
        Ok(())
    }
}

/// The on-demand descriptors a release requires a caller to have materialised.
fn required_assets_of(release: &ReleaseManifest) -> &[AssetDescriptor] {
    if release.weights.as_deref() == Some("on-demand") {
        release.assets.as_deref().unwrap_or(&[])
    } else {
        &[]
    }
}

/// Checks the assets a caller was told to place, against their signed descriptors.
///
/// # Errors
///
/// When an asset is missing, is not a regular file, or does not match its signed size or digest.
pub fn verify_required_assets(root: &Path, assets: &[AssetDescriptor]) -> Result<()> {
    for asset in assets {
        let relative = safe_relative_path(&asset.relative_path)?;
        let path = join_relative(root, &relative);
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            fail!(
                "Required on-demand asset is missing: {}.",
                asset.relative_path
            );
        };
        if !metadata.is_file() {
            fail!(
                "Required on-demand asset is not a regular file: {}.",
                asset.relative_path
            );
        }
        if metadata.len() != asset.size_bytes {
            fail!(
                "Required on-demand asset size mismatch: {}.",
                asset.relative_path
            );
        }
        if sha256_file(&path)? != asset.sha256 {
            fail!(
                "Required on-demand asset SHA-256 mismatch: {}.",
                asset.relative_path
            );
        }
    }
    Ok(())
}

/// The diagnostic every verification receipt carries.
fn release_environment_report(
    release: &ReleaseManifest,
    adapter: &BoxTargetAdapter,
    options: &EnvironmentReportOptions,
) -> Result<EnvironmentReport> {
    let host: Vec<(String, String)> = options
        .host_environment
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    let host_pairs: Vec<(&str, &str)> = host
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();
    let declared: BTreeMap<String, String> = release.environment.clone().unwrap_or_default();
    let release_pairs: Vec<(&str, &str)> = declared
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();

    Ok(resolve_environment(&ResolveOptions {
        platform: adapter.platform,
        layers: vec![
            EnvironmentLayer {
                source: EnvironmentSource::Host,
                values: host_pairs,
            },
            EnvironmentLayer {
                source: EnvironmentSource::Release,
                values: release_pairs,
            },
        ],
        execution_affecting_variables: adapter.execution_affecting_environment_variables,
        expanded: options.env_report || options.env_report_values,
        reveal_host_values: options.env_report_values,
    })?
    .report)
}

fn mint(
    status: PreparedStatus,
    root: PathBuf,
    inspected: &InspectedRelease,
    installed_size_bytes: u64,
    identity: RootIdentity,
    options: &EnvironmentReportOptions,
) -> Result<PreparedBox> {
    let release = inspected.release.clone();
    Ok(PreparedBox {
        status,
        root,
        target_id: box_target_id(&release.target)?,
        signing_key_ids: inspected
            .signed
            .signatures
            .iter()
            .map(|signature| signature.key_id.clone())
            .collect(),
        release_payload_sha256: inspected.signed.payload_sha256.clone(),
        installed_size_bytes,
        environment_report: release_environment_report(&release, inspected.adapter, options)?,
        release,
        adapter: inspected.adapter,
        root_identity: identity,
    })
}

/// Where the caller wants a box prepared, and how much to say about the environment.
pub struct PrepareOptions<'a> {
    /// Trust file naming the keys the caller accepts.
    pub public_key_path: &'a Path,
    /// The archive, when it is not beside its release document under its own hash.
    pub archive: Option<&'a Path>,
    /// Where the box must end up. Must not already exist.
    pub destination: &'a Path,
    /// Environment reporting.
    pub environment: EnvironmentReportOptions,
}

/// Verifies and extracts one local box without executing any code from it.
///
/// The destination must not exist. Extraction happens in a fresh sibling directory so the final
/// rename stays on one filesystem and exposes either the complete verified tree or nothing at all —
/// a box is never observed half-installed.
///
/// # Errors
///
/// When the destination exists, the trust chain fails, the extracted size disagrees with the signed
/// release, or the archive changed while it was being read.
pub fn verify_and_extract_box(
    release_document_path: &Path,
    options: &PrepareOptions<'_>,
) -> Result<PreparedBox> {
    let final_root = absolute(options.destination);
    if std::fs::symlink_metadata(&final_root).is_ok() {
        fail!("Destination already exists: {}", final_root.display());
    }

    let inspected = inspect_release_document(release_document_path, options.public_key_path)?;
    let archive = inspect_archive_for(inspected, options.archive)?;
    let release = &archive.release.release;

    let parent = final_root
        .parent()
        .ok_or_else(|| Error::new("A destination must have a parent directory."))?
        .to_path_buf();
    std::fs::create_dir_all(&parent)?;
    if std::fs::symlink_metadata(&final_root).is_ok() {
        fail!("Destination already exists: {}", final_root.display());
    }

    let stage_root = parent.join(format!(
        ".scrollcase-prepare-{}-{}",
        final_root
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .unwrap_or("box"),
        unique_suffix()
    ));
    std::fs::create_dir_all(&stage_root)?;
    let result = prepare_into(&stage_root, &final_root, &archive.archive_path, &archive.release, release, options);
    let _ = std::fs::remove_dir_all(&stage_root);
    result
}

fn prepare_into(
    stage_root: &Path,
    final_root: &Path,
    archive_path: &Path,
    inspected: &InspectedRelease,
    release: &ReleaseManifest,
    options: &PrepareOptions<'_>,
) -> Result<PreparedBox> {
    let extracted_root = stage_root.join("payload");
    extract_zip_archive(archive_path, &extracted_root)?;

    let extracted_size = payload_size(&extracted_root)?;
    if release
        .installed_size_bytes
        .is_some_and(|declared| declared != extracted_size)
    {
        fail!("Extracted payload size does not match the signed release.");
    }

    // Re-checked after extraction: this catches a local archive being replaced between the initial
    // trust decision and the move into the caller's durable destination.
    if sha256_file(archive_path)? != release.archive.sha256 {
        fail!("Archive SHA-256 changed during extraction.");
    }

    let staged = std::fs::symlink_metadata(&extracted_root)?;
    if std::fs::symlink_metadata(final_root).is_ok() {
        fail!("Destination already exists: {}", final_root.display());
    }
    std::fs::rename(&extracted_root, final_root).map_err(|error| {
        Error::new(format!(
            "cannot install into {}: {error}",
            final_root.display()
        ))
    })?;

    let installed = std::fs::symlink_metadata(final_root)?;
    if !survived_the_rename(&staged, &installed) {
        fail!("Prepared destination identity changed during installation.");
    }

    mint(
        PreparedStatus::Prepared,
        final_root.to_path_buf(),
        inspected,
        extracted_size,
        root_identity(final_root, &installed)?,
        &options.environment,
    )
}

/// Where an already-extracted box lives.
pub struct AttachOptions<'a> {
    /// Trust file naming the keys the caller accepts.
    pub public_key_path: &'a Path,
    /// The extracted box root.
    pub root: &'a Path,
    /// Environment reporting.
    pub environment: EnvironmentReportOptions,
}

/// Resolves a directory a caller claims holds an extracted box, refusing anything that is not one.
fn resolve_extracted_root(root: &Path) -> Result<(PathBuf, Metadata)> {
    let resolved = absolute(root);
    let Ok(metadata) = std::fs::symlink_metadata(&resolved) else {
        fail!("{} is not an extracted box directory.", resolved.display());
    };
    // `symlink_metadata`, so a link reports false here. That is deliberate: running a box requires a
    // real directory, and accepting a link would mint a receipt that can never be executed.
    if !metadata.is_dir() {
        fail!("{} is not an extracted box directory.", resolved.display());
    }
    Ok((resolved, metadata))
}

/// Re-identifies a box that is already extracted, without its archive.
///
/// This is what lets an application install a box once and run it across restarts. It performs every
/// check that needs no data beyond the signed release — signature and schema, a target this host can
/// run, the interpreter and execution files present, the signed digests of on-demand assets — and
/// deliberately does not read the payload. Proving the installed bytes is
/// [`verify_extracted_payload`], a separate decision with a separate cost.
///
/// Unlike preparation, this asserts the native host: preparing only writes files, but a receipt
/// minted here exists to be executed.
///
/// # Errors
///
/// When the root is not a directory, the trust chain fails, the host cannot run the target, the
/// interpreter or execution files are absent, or an on-demand asset does not match its descriptor.
pub fn attach_extracted_box(
    release_document_path: &Path,
    options: &AttachOptions<'_>,
) -> Result<PreparedBox> {
    let (root, metadata) = resolve_extracted_root(options.root)?;
    let inspected = inspect_release_document(release_document_path, options.public_key_path)?;
    let release = &inspected.release;

    if assert_native_host(inspected.adapter).is_err() {
        fail!(
            "Box target {} cannot run on {}/{}; it requires {}/{}.",
            box_target_id(&release.target)?,
            std::env::consts::OS,
            std::env::consts::ARCH,
            inspected.adapter.host_os,
            inspected.adapter.host_arch
        );
    }

    let files = collect_files(&root)?;
    if !files.contains(&release.python_entry_point) {
        fail!("Attached box is missing {}.", release.python_entry_point);
    }
    assert_execution_files(
        release.execution.as_ref(),
        inspected.adapter,
        &release.provenance.python_version,
        &files,
    )?;
    verify_required_assets(&root, required_assets_of(release))?;

    // Measured, never compared: an installed tree legitimately grows after extraction — on-demand
    // assets, caches, whatever the application writes — so holding it to the signed figure would
    // fail honest boxes.
    let installed_size_bytes = payload_size(&root)?;
    let settled = std::fs::symlink_metadata(&root)?;
    if root_identity(&root, &settled)? != root_identity(&root, &metadata)? {
        fail!("Attached box root changed while it was being checked.");
    }

    mint(
        PreparedStatus::Attached,
        root.clone(),
        &inspected,
        installed_size_bytes,
        root_identity(&root, &settled)?,
        &options.environment,
    )
}

/// The result of comparing an extracted tree against the entry list its release commits to.
#[derive(Debug, Clone)]
pub struct PayloadVerification {
    /// The tree that was checked.
    pub root: PathBuf,
    /// Box identity, from the signed release.
    pub box_id: String,
    /// Box version, from the signed release.
    pub version: String,
    /// Canonical target slug.
    pub target_id: String,
    /// How many payload entries were checked.
    pub entry_count: usize,
    /// Diagnostic snapshot of the environment.
    pub environment_report: EnvironmentReport,
}

/// Proves an extracted tree is the one a signed release describes.
///
/// Deliberately standalone. Nothing calls it — not preparation, not attachment, not execution —
/// because it reads every byte the box carries, and because a check that passed at one moment says
/// nothing about the next: between here and a later import the tree can change, and no library can
/// close that window. Filesystem permissions do, and they belong to the operating system and the
/// application. What this answers is narrower and worth answering: is this directory the box that
/// release describes, and is it still whole.
///
/// # Errors
///
/// When the release commits to no payload digest, the list is missing or does not match the signed
/// value, or any entry it names is absent, of the wrong kind, or of different content.
pub fn verify_extracted_payload(
    release_document_path: &Path,
    options: &AttachOptions<'_>,
) -> Result<PayloadVerification> {
    let (root, _) = resolve_extracted_root(options.root)?;
    let inspected = inspect_release_document(release_document_path, options.public_key_path)?;
    let release = &inspected.release;

    let Some(commitment) = release.payload_digest.as_ref() else {
        fail!("This release does not commit to a payload digest; it was built before payload verification existed.");
    };

    let list_path = root.join(PAYLOAD_DIGEST_FILE);
    let Ok(list_metadata) = std::fs::symlink_metadata(&list_path) else {
        fail!("Attached box is missing its payload digest list: {PAYLOAD_DIGEST_FILE}.");
    };
    if list_metadata.len() > MAX_PAYLOAD_DIGEST_BYTES {
        fail!("Payload digest list is larger than this consumer will read.");
    }
    // Hashed before it is parsed. The list arrives with the untrusted tree it describes, so until it
    // matches the signed value it is not a list — it is input.
    if sha256_file(&list_path)? != commitment.sha256 {
        fail!("Payload digest list does not match the signed release.");
    }

    let bytes = std::fs::read(&list_path)?;
    let entries = parse_payload_digest_stream(&bytes)
        .map_err(|error| Error::new(format!("Invalid payload digest list: {error}")))?;

    for entry in &entries {
        let relative = safe_relative_path(&entry.path)?;
        let path = join_relative(&root, &relative);
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            fail!(
                "Payload does not match the signed release: {} is missing.",
                entry.path
            );
        };
        let kind = if metadata.is_symlink() {
            Some(PayloadDigestKind::Link)
        } else if metadata.is_file() {
            Some(PayloadDigestKind::File)
        } else {
            None
        };
        if kind != Some(entry.kind) {
            let expected = match entry.kind {
                PayloadDigestKind::File => "file",
                PayloadDigestKind::Link => "link",
            };
            fail!(
                "Payload does not match the signed release: {} is not a {expected}.",
                entry.path
            );
        }
        // A link is compared by its target string, never opened: following it would compare the
        // target's bytes under two names and make a link indistinguishable from a copy.
        let actual = if entry.kind == PayloadDigestKind::Link {
            let target = std::fs::read_link(&path)?;
            crate::contract::documents::sha256_hex(
                target.to_string_lossy().replace('\\', "/").as_bytes(),
            )
        } else {
            sha256_file(&path)?
        };
        if actual != entry.content_sha256 {
            fail!(
                "Payload does not match the signed release: {}.",
                entry.path
            );
        }
    }

    Ok(PayloadVerification {
        root,
        box_id: release.box_id.clone(),
        version: release.version.clone(),
        target_id: box_target_id(&release.target)?,
        entry_count: entries.len(),
        environment_report: release_environment_report(
            release,
            inspected.adapter,
            &options.environment,
        )?,
    })
}

fn absolute(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().map_or_else(|_| path.to_path_buf(), |current| current.join(path))
    }
}

fn unique_suffix() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default()
    )
}
