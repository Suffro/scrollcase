//! The signed release manifest, and the `box.json` that must agree with it.
//!
//! These types are the runtime shape check. Node and Python validate the same documents against the
//! canonical JSON schemas at runtime; this crate encodes those schemas as types instead, because the
//! schemas set `additionalProperties: false` throughout and a typed `deny_unknown_fields` parse says
//! exactly that — while a JSON Schema evaluator for the eighteen keywords these schemas actually use
//! would be six hundred lines of validation logic whose failure mode is validating *less* than it
//! claims.
//!
//! The equivalence is not assumed. `tests/schema.rs` validates the same documents against the
//! bundled canonical schemas and asserts the two agree, so a type that drifts from its schema is a
//! red test rather than a silent divergence between implementations.
//!
//! What the types cannot express — patterns, non-empty strings, positive integers, and the
//! `weights`/`assets` co-requirement — is checked explicitly in [`ReleaseManifest::validate`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::contract::documents::{parse_document_kind, DocumentType, BOX_SCHEMA_VERSION};
use crate::contract::targets::BoxTarget;
use crate::error::{fail, Result};
use crate::path::safe_relative_path;

/// Host requirements a caller may enforce. Scrollcase records them; it does not decide policy.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Compatibility {
    /// Minimum version of the consuming application.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_host_app_version: Option<String>,
    /// First version of the consuming application this box no longer supports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_host_app_version_exclusive: Option<String>,
    /// Minimum macOS version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_macos_version: Option<String>,
    /// Minimum installed memory, in decimal gigabytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_ram_gb: Option<f64>,
    /// Minimum NVIDIA driver version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_nvidia_driver_version: Option<String>,
    /// Execution environments this payload was validated for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_environments: Option<Vec<String>>,
}

/// Where the archive lives and what it must hash and weigh.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Archive {
    /// Always `zip`.
    pub format: String,
    /// Where the archive was published. This crate never fetches it.
    pub url: String,
    /// Lowercase hex SHA-256 of the archive bytes.
    pub sha256: String,
    /// Exact archive size.
    pub size_bytes: u64,
}

/// What a release commits to about its own extracted tree.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PayloadDigestCommitment {
    /// Always `sha256-path-list-v1`.
    pub format: String,
    /// Lowercase hex SHA-256 of the canonical entry list.
    pub sha256: String,
}

/// The import check a box must pass with its own interpreter.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelfTest {
    /// Modules to import.
    pub python_imports: Vec<String>,
    /// How long the import check may take.
    pub timeout_seconds: u64,
}

/// The optional, shell-free application entry point.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Execution {
    /// Run one regular payload file with the box's own Python interpreter.
    #[serde(rename_all = "camelCase")]
    PythonScript {
        /// Safe path to a regular Python file inside the box.
        script: String,
        /// Arguments always passed before a caller's own.
        default_args: Vec<String>,
    },
    /// Run one dotted Python module.
    #[serde(rename_all = "camelCase")]
    PythonModule {
        /// Strict dotted-module name, with no command-line or shell syntax.
        module: String,
        /// Arguments always passed before a caller's own.
        default_args: Vec<String>,
    },
}

/// How the box was produced. Recorded, signed, and never fabricated.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provenance {
    /// Identity of the scroll that produced this box.
    pub scroll_id: String,
    /// Version declared by that scroll.
    pub scroll_version: String,
    /// Commit of Scrollcase itself.
    pub builder_revision: String,
    /// Whether the source tree was dirty at build time. Never quietly downgraded.
    pub source_tree_dirty: bool,
    /// Commit the box was built from.
    pub source_revision: String,
    /// Python version inside the box.
    pub python_version: String,
    /// SHA-256 of the dependency lock.
    pub dependency_lock_sha256: String,
    /// When the box was built.
    pub built_at: String,
    /// pixi version that solved the environment.
    pub pixi_version: String,
}

/// One on-demand asset a caller must materialise before execution.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetDescriptor {
    /// Where the asset was published. This crate never fetches it.
    pub url: String,
    /// Where it must be placed, relative to the box root.
    pub relative_path: String,
    /// Exact size the placed file must have.
    pub size_bytes: u64,
    /// Lowercase hex SHA-256 the placed file must have.
    pub sha256: String,
}

/// The immutable description of one built box.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseManifest {
    /// Format version; always 2.
    pub schema_version: u32,
    /// `<namespace>.release`, in the publishing project's own namespace.
    pub kind: String,
    /// Box identity.
    pub box_id: String,
    /// Model identity.
    pub model_id: String,
    /// Installed-directory identity.
    pub runtime_id: String,
    /// Box version.
    pub version: String,
    /// The target this box was built for.
    pub target: BoxTarget,
    /// Host requirements.
    pub compatibility: Compatibility,
    /// The archive this release commits to.
    pub archive: Archive,
    /// Logical payload size before anything is written into the installed tree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_size_bytes: Option<u64>,
    /// Commitment to the extracted tree, absent on boxes built before it existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload_digest: Option<PayloadDigestCommitment>,
    /// Interpreter path, relative to the box root.
    pub python_entry_point: String,
    /// Where a caller's model cache belongs inside the box.
    pub model_cache_subdir: String,
    /// Signed environment applied whenever Scrollcase runs the interpreter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<BTreeMap<String, String>>,
    /// The import check.
    pub self_test: SelfTest,
    /// The optional application entry point.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<Execution>,
    /// How the box was produced.
    pub provenance: Provenance,
    /// Present only when assets are carried outside the archive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weights: Option<String>,
    /// Descriptors of the assets a caller must materialise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assets: Option<Vec<AssetDescriptor>>,
}

/// The box's self-description, carried inside the archive.
///
/// Every field it holds also appears in the release, and all of them must agree: without that, a
/// correctly hashed archive could be paired with a signed manifest describing something else.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoxManifest {
    /// Format version; always 2.
    pub schema_version: u32,
    /// Box identity.
    pub box_id: String,
    /// Model identity.
    pub model_id: String,
    /// Installed-directory identity.
    pub runtime_id: String,
    /// Box version.
    pub version: String,
    /// The target this box was built for.
    pub target: BoxTarget,
    /// Interpreter path, relative to the box root.
    pub python_entry_point: String,
    /// Where a caller's model cache belongs inside the box.
    pub model_cache_subdir: String,
    /// Signed environment applied whenever Scrollcase runs the interpreter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<BTreeMap<String, String>>,
    /// The import check.
    pub self_test: SelfTest,
    /// The optional application entry point.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<Execution>,
    /// How the box was produced.
    pub provenance: Provenance,
    /// Present only when assets are carried outside the archive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weights: Option<String>,
    /// Descriptors of the assets a caller must materialise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assets: Option<Vec<AssetDescriptor>>,
}

/// Whether a value is lowercase hex of the given length.
fn is_lowercase_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Whether a value is the format's dotted-lowercase identifier.
fn is_identifier(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let mut group_is_empty = true;
    for character in value.chars() {
        match character {
            'a'..='z' | '0'..='9' => group_is_empty = false,
            '-' | '.' if !group_is_empty => group_is_empty = true,
            _ => return false,
        }
    }
    !group_is_empty
}

/// Whether a value is a strict Python dotted-module name.
fn is_python_module(value: &str) -> bool {
    !value.is_empty()
        && value.split('.').all(|segment| {
            let mut characters = segment.chars();
            characters
                .next()
                .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
                && characters.all(|rest| rest.is_ascii_alphanumeric() || rest == '_')
        })
}

impl Execution {
    /// Checks the constraints the type cannot express.
    ///
    /// # Errors
    ///
    /// When the script path is unsafe or the module name is not a strict dotted name.
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::PythonScript { script, .. } => {
                safe_relative_path(script)?;
            }
            Self::PythonModule { module, .. } => {
                if !is_python_module(module) {
                    fail!("Invalid release manifest: execution module {module} is not a dotted Python module name.");
                }
            }
        }
        Ok(())
    }
}

impl ReleaseManifest {
    /// Checks every constraint the schema states that the types cannot.
    ///
    /// # Errors
    ///
    /// When any pattern, bound, or co-requirement the schema states is violated.
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != BOX_SCHEMA_VERSION {
            fail!(
                "Unsupported schemaVersion {}; expected {BOX_SCHEMA_VERSION}.",
                self.schema_version
            );
        }
        if parse_document_kind(&self.kind).map(|parsed| parsed.document_type)
            != Some(DocumentType::Release)
        {
            fail!("Document is not a box release.");
        }
        // The target model is a contract rule rather than a field check: this rejects a triple
        // outside the supported matrix, a CUDA target without a version, and a version on a target
        // that may not carry one, all in the same call the slug is derived from.
        crate::contract::targets::box_target_id(&self.target)?;
        for (label, value) in [
            ("boxId", &self.box_id),
            ("modelId", &self.model_id),
            ("runtimeId", &self.runtime_id),
        ] {
            if !is_identifier(value) {
                fail!("Invalid release manifest: {label} is not a valid identifier.");
            }
        }
        for (label, value) in [
            ("version", &self.version),
            ("pythonEntryPoint", &self.python_entry_point),
            ("modelCacheSubdir", &self.model_cache_subdir),
            ("archive.url", &self.archive.url),
        ] {
            if value.is_empty() {
                fail!("Invalid release manifest: {label} must not be empty.");
            }
        }
        if self.archive.format != "zip" {
            fail!("Invalid release manifest: archive format must be zip.");
        }
        if !is_lowercase_hex(&self.archive.sha256, 64) {
            fail!("Invalid release manifest: archive sha256 is not a SHA-256 digest.");
        }
        if self.archive.size_bytes == 0 {
            fail!("Invalid release manifest: archive sizeBytes must be positive.");
        }
        if self.installed_size_bytes == Some(0) {
            fail!("Invalid installed size.");
        }
        if let Some(digest) = &self.payload_digest {
            if digest.format != crate::contract::payload_digest::PAYLOAD_DIGEST_FORMAT
                || !is_lowercase_hex(&digest.sha256, 64)
            {
                fail!("Invalid release manifest: payloadDigest is not a supported commitment.");
            }
        }
        if self.self_test.python_imports.is_empty()
            || self
                .self_test
                .python_imports
                .iter()
                .any(std::string::String::is_empty)
        {
            fail!("Invalid release manifest: selfTest pythonImports must be non-empty.");
        }
        if self.self_test.timeout_seconds == 0 {
            fail!("Invalid release manifest: selfTest timeoutSeconds must be positive.");
        }
        validate_environment(self.environment.as_ref())?;
        if let Some(execution) = &self.execution {
            execution.validate()?;
        }
        validate_provenance(&self.provenance)?;
        validate_compatibility(&self.compatibility)?;
        self.validate_assets()?;
        Ok(())
    }

    /// The `weights`/`assets` co-requirement, and the descriptors themselves.
    fn validate_assets(&self) -> Result<()> {
        let assets = match (self.weights.as_deref(), self.assets.as_deref()) {
            (None, None) => return Ok(()),
            (Some("on-demand"), Some(assets)) => assets,
            (Some(other), Some(_)) => {
                fail!("Invalid release manifest: unsupported weights value {other}.")
            }
            // `dependentRequired` in both directions: neither field means anything alone.
            (Some(_), None) | (None, Some(_)) => {
                fail!("Invalid release manifest: weights and assets must be declared together.")
            }
        };
        if assets.is_empty() {
            fail!("Invalid release manifest: assets must not be empty.");
        }
        for asset in assets {
            // Screened before anything is joined onto a caller's directory.
            safe_relative_path(&asset.relative_path)?;
            if asset.url.is_empty() {
                fail!("Invalid release manifest: asset url must not be empty.");
            }
            if asset.size_bytes == 0 {
                fail!("Invalid release manifest: asset sizeBytes must be positive.");
            }
            if !is_lowercase_hex(&asset.sha256, 64) {
                fail!("Invalid release manifest: asset sha256 is not a SHA-256 digest.");
            }
        }
        Ok(())
    }
}

/// Environment names and values, as the schema constrains them.
fn validate_environment(environment: Option<&BTreeMap<String, String>>) -> Result<()> {
    let Some(environment) = environment else {
        return Ok(());
    };
    for (name, value) in environment {
        if name.is_empty() || name.contains('=') || name.contains('\0') || value.contains('\0') {
            fail!("Invalid release manifest: environment variable {name} is not a valid name.");
        }
    }
    Ok(())
}

fn validate_provenance(provenance: &Provenance) -> Result<()> {
    if !is_lowercase_hex(&provenance.builder_revision, 40) {
        fail!("Invalid release manifest: provenance builderRevision is not a commit.");
    }
    if !is_lowercase_hex(&provenance.dependency_lock_sha256, 64) {
        fail!("Invalid release manifest: provenance dependencyLockSha256 is not a SHA-256 digest.");
    }
    for (label, value) in [
        ("scrollId", &provenance.scroll_id),
        ("scrollVersion", &provenance.scroll_version),
        ("sourceRevision", &provenance.source_revision),
        ("pythonVersion", &provenance.python_version),
        ("builtAt", &provenance.built_at),
        ("pixiVersion", &provenance.pixi_version),
    ] {
        if value.is_empty() {
            fail!("Invalid release manifest: provenance {label} must not be empty.");
        }
    }
    Ok(())
}

fn validate_compatibility(compatibility: &Compatibility) -> Result<()> {
    if compatibility.min_ram_gb.is_some_and(|value| value <= 0.0) {
        fail!("Invalid release manifest: minRamGb must be positive.");
    }
    if let Some(environments) = &compatibility.host_environments {
        if environments.is_empty() {
            fail!("Invalid release manifest: hostEnvironments must not be empty.");
        }
        for environment in environments {
            if environment != "native" && environment != "windows-wsl2" {
                fail!("Invalid release manifest: unsupported host environment {environment}.");
            }
        }
    }
    for (label, value) in [
        ("minHostAppVersion", &compatibility.min_host_app_version),
        (
            "maxHostAppVersionExclusive",
            &compatibility.max_host_app_version_exclusive,
        ),
        ("minMacosVersion", &compatibility.min_macos_version),
        (
            "minNvidiaDriverVersion",
            &compatibility.min_nvidia_driver_version,
        ),
    ] {
        if value.as_deref().is_some_and(str::is_empty) {
            fail!("Invalid release manifest: compatibility {label} must not be empty.");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_identifier, is_python_module, Execution};

    #[test]
    fn identifiers_follow_the_shared_pattern() {
        for valid in ["hello-box", "a", "example.model-1", "b0x"] {
            assert!(is_identifier(valid), "{valid} was refused");
        }
        for invalid in ["", "-a", "a-", "a..b", "A", "a_b", "a b", ".a"] {
            assert!(!is_identifier(invalid), "{invalid} was accepted");
        }
    }

    #[test]
    fn module_names_carry_no_command_line_syntax() {
        for valid in ["main", "_pkg.main", "example_model.cli.main"] {
            assert!(is_python_module(valid), "{valid} was refused");
        }
        // The name is passed to `python -m`, so anything that is not a dotted identifier — a space,
        // a semicolon, a flag, a path — must never reach the argument list.
        for invalid in ["", "a b", "a;b", "-c", "a/b", "1abc", "a..b", "a."] {
            assert!(!is_python_module(invalid), "{invalid} was accepted");
        }
    }

    #[test]
    fn execution_paths_are_screened_before_they_are_joined() {
        let escape = Execution::PythonScript {
            script: "../outside.py".to_string(),
            default_args: vec![],
        };
        assert!(escape.validate().is_err());

        let ok = Execution::PythonScript {
            script: "app/main.py".to_string(),
            default_args: vec![],
        };
        assert!(ok.validate().is_ok());
    }
}
