//! Mirror of the Scrollcase box-format target model.
//!
//! A target is the `(platform, arch, accelerator)` triple a box is built for, plus a CUDA ABI
//! version when the accelerator is CUDA. [`box_target_id`] turns it into the canonical slug that
//! appears in archive names, object keys and registry routes, so every implementation of the format
//! must agree character for character. The golden cases in `fixtures/target-id-contract.json` are
//! what "agree" means, and `tests/contract.rs` proves this mirror against them.
//!
//! The adapter describes what a target implies for the extracted tree. Only the parts a consumer
//! relies on are carried here: the interpreter layout it must find, the inherited variables that can
//! change which code that interpreter loads, and the platform assertion a self-test opens with. The
//! builder's own adapter additionally names the archive backend, the conda subdir and the native
//! library inspector — all of them decisions taken while a box is produced, none of them observable
//! by something that only unpacks and runs one.
//!
//! The native host is expressed in Rust's own `OS`/`ARCH` vocabulary rather than Node's
//! `darwin`/`arm64`. Those strings never appear in a signed document; they only answer "may this
//! host run this box", and each implementation answers it in the terms its own runtime reports.

use serde::{Deserialize, Serialize};

use crate::error::{fail, Result};

/// The `(platform, arch, accelerator)` triple a box is built for.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoxTarget {
    /// Operating system the box runs on.
    pub platform: String,
    /// CPU architecture the box runs on.
    pub arch: String,
    /// Compute backend the box was built against.
    pub accelerator: String,
    /// CUDA ABI version, required on a CUDA target and forbidden on every other.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cuda_version: Option<String>,
}

/// Layout of the interpreter inside an extracted box.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PythonLayout {
    /// Directory the packed prefix was relocated into.
    pub payload_root: &'static str,
    /// Interpreter path, relative to the box root.
    pub entry_point: &'static str,
    /// Directory holding console scripts.
    pub scripts_directory: &'static str,
    /// Suffix an executable carries on this platform.
    pub executable_suffix: &'static str,
    /// Frozen wire string naming how launchers were repaired.
    pub launcher_kind: &'static str,
}

/// What a target implies for the extracted tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoxTargetAdapter {
    /// Canonical adapter id, for example `macos-aarch64`.
    pub id: &'static str,
    /// Operating system, as a scroll declares it.
    pub platform: &'static str,
    /// CPU architecture, as a scroll declares it.
    pub arch: &'static str,
    /// `std::env::consts::OS` value a host must report to run this box.
    pub host_os: &'static str,
    /// `std::env::consts::ARCH` value a host must report to run this box.
    pub host_arch: &'static str,
    /// Interpreter layout inside the box.
    pub python: PythonLayout,
    /// Inherited variables whose presence can change which code the interpreter loads.
    pub execution_affecting_environment_variables: &'static [&'static str],
    /// The platform assertion prepended to every self-test.
    pub self_test_python: &'static str,
}

const PYTHON_EXECUTION_ENVIRONMENT: &[&str] = &[
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONSTARTUP",
    "PYTHONBREAKPOINT",
];

const MACOS_EXECUTION_ENVIRONMENT: &[&str] = &[
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONSTARTUP",
    "PYTHONBREAKPOINT",
    "DYLD_INSERT_LIBRARIES",
];

const LINUX_EXECUTION_ENVIRONMENT: &[&str] = &[
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONSTARTUP",
    "PYTHONBREAKPOINT",
    "LD_PRELOAD",
];

const POSIX_PYTHON: PythonLayout = PythonLayout {
    payload_root: "venv",
    entry_point: "venv/bin/python",
    scripts_directory: "venv/bin",
    executable_suffix: "",
    launcher_kind: "posix-polyglot",
};

const TARGET_ADAPTERS: &[BoxTargetAdapter] = &[
    BoxTargetAdapter {
        id: "macos-aarch64",
        platform: "macos",
        arch: "aarch64",
        host_os: "macos",
        host_arch: "aarch64",
        python: POSIX_PYTHON,
        execution_affecting_environment_variables: MACOS_EXECUTION_ENVIRONMENT,
        self_test_python: "import sys; assert sys.platform == 'darwin'",
    },
    BoxTargetAdapter {
        id: "linux-x86_64",
        platform: "linux",
        arch: "x86_64",
        host_os: "linux",
        host_arch: "x86_64",
        python: POSIX_PYTHON,
        execution_affecting_environment_variables: LINUX_EXECUTION_ENVIRONMENT,
        self_test_python: "import sys; assert sys.platform.startswith('linux')",
    },
    BoxTargetAdapter {
        id: "windows-x86_64",
        platform: "windows",
        arch: "x86_64",
        host_os: "windows",
        host_arch: "x86_64",
        python: PythonLayout {
            payload_root: "venv",
            entry_point: "venv/python.exe",
            scripts_directory: "venv/Scripts",
            executable_suffix: ".exe",
            // Reads like a stale reference to a tool this project does not use. It is a frozen wire
            // string under the published format; it is not a typo and must not be "cleaned".
            launcher_kind: "uv-windows-pe",
        },
        execution_affecting_environment_variables: PYTHON_EXECUTION_ENVIRONMENT,
        self_test_python: "import sys; assert sys.platform == 'win32'",
    },
];

/// The accelerators each `(platform, arch)` pair supports, in the order the format defines them.
fn supported_accelerators(platform: &str, arch: &str) -> Option<&'static [&'static str]> {
    match (platform, arch) {
        ("macos", "aarch64") => Some(&["metal", "cpu"]),
        ("linux" | "windows", "x86_64") => Some(&["cpu", "cuda"]),
        _ => None,
    }
}

/// Whether a CUDA version is the `major.minor` shape the format requires.
///
/// Hand-written rather than delegated to a regex engine: the pattern is
/// `^[1-9][0-9]*\.[0-9]+$`, and carrying a regex dependency to answer it would be the whole cost of
/// the crate's smallest question.
fn is_cuda_version(value: &str) -> bool {
    let Some((major, minor)) = value.split_once('.') else {
        return false;
    };
    let major_valid = !major.is_empty()
        && !major.starts_with('0')
        && major.bytes().all(|byte| byte.is_ascii_digit());
    let minor_valid = !minor.is_empty() && minor.bytes().all(|byte| byte.is_ascii_digit());
    major_valid && minor_valid
}

/// Returns the canonical target slug used in box filenames, object keys and routes.
///
/// # Errors
///
/// When the target is outside the supported matrix, or its CUDA version is missing on a CUDA target
/// or present on any other.
pub fn box_target_id(target: &BoxTarget) -> Result<String> {
    let accelerators = supported_accelerators(&target.platform, &target.arch);
    if !accelerators.is_some_and(|values| values.contains(&target.accelerator.as_str())) {
        fail!(
            "Unsupported box target: {}/{}/{}",
            target.platform,
            target.arch,
            target.accelerator
        );
    }
    if target.accelerator == "cuda" {
        let Some(version) = target.cuda_version.as_deref().filter(|v| is_cuda_version(v)) else {
            fail!("A CUDA box target requires a numeric major.minor CUDA version");
        };
        return Ok(format!(
            "{}-{}-cuda{version}",
            target.platform, target.arch
        ));
    }
    if target.cuda_version.is_some() {
        fail!("Only CUDA box targets may declare a CUDA version");
    }
    Ok(format!(
        "{}-{}-{}",
        target.platform, target.arch, target.accelerator
    ))
}

/// Returns the adapter for a validated box target.
///
/// # Errors
///
/// When the target is unsupported.
pub fn box_target_adapter(target: &BoxTarget) -> Result<&'static BoxTargetAdapter> {
    box_target_id(target)?;
    let Some(adapter) = TARGET_ADAPTERS
        .iter()
        .find(|candidate| candidate.platform == target.platform && candidate.arch == target.arch)
    else {
        fail!(
            "No box target adapter exists for {}/{}",
            target.platform,
            target.arch
        );
    };
    Ok(adapter)
}

/// Lists every adapter, for contract tests and for callers enumerating supported targets.
#[must_use]
pub fn box_target_adapters() -> &'static [BoxTargetAdapter] {
    TARGET_ADAPTERS
}

/// Ensures this host is the operating system and architecture the box ships for.
///
/// # Errors
///
/// When the current host is not the one the adapter requires.
pub fn assert_native_host(adapter: &BoxTargetAdapter) -> Result<()> {
    assert_host(adapter, std::env::consts::OS, std::env::consts::ARCH)
}

/// The host check with the host injected, so every target can be exercised on one machine.
///
/// # Errors
///
/// When the supplied host is not the one the adapter requires.
pub fn assert_host(adapter: &BoxTargetAdapter, os: &str, arch: &str) -> Result<()> {
    if os != adapter.host_os || arch != adapter.host_arch {
        fail!(
            "{} boxes cannot run on {os}/{arch}; they require {}/{}",
            adapter.id,
            adapter.host_os,
            adapter.host_arch
        );
    }
    Ok(())
}

/// Ensures a release's entry point agrees with the adapter's standalone Python layout.
///
/// # Errors
///
/// When the entry point is not the one the adapter defines.
pub fn assert_python_entry_point(adapter: &BoxTargetAdapter, entry_point: &str) -> Result<()> {
    if entry_point != adapter.python.entry_point {
        fail!(
            "{} boxes must use Python entry point {}",
            adapter.id,
            adapter.python.entry_point
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        assert_host, assert_python_entry_point, box_target_adapter, box_target_adapters,
        box_target_id, is_cuda_version, BoxTarget,
    };

    fn target(platform: &str, arch: &str, accelerator: &str, cuda: Option<&str>) -> BoxTarget {
        BoxTarget {
            platform: platform.to_string(),
            arch: arch.to_string(),
            accelerator: accelerator.to_string(),
            cuda_version: cuda.map(str::to_string),
        }
    }

    #[test]
    fn cuda_versions_follow_the_major_minor_rule() {
        assert!(is_cuda_version("12.4"));
        assert!(is_cuda_version("9.0"));
        for invalid in ["", "12", "12.", ".4", "0.1", "01.2", "12.4.1", "12.x", " 12.4"] {
            assert!(!is_cuda_version(invalid), "{invalid} was accepted");
        }
    }

    #[test]
    fn every_adapter_is_reachable_from_a_target() {
        for adapter in box_target_adapters() {
            let accelerator = if adapter.platform == "macos" {
                "metal"
            } else {
                "cpu"
            };
            let resolved =
                box_target_adapter(&target(adapter.platform, adapter.arch, accelerator, None))
                    .unwrap();
            assert_eq!(resolved.id, adapter.id);
        }
    }

    #[test]
    fn a_foreign_host_is_refused_with_the_shared_wording() {
        let adapter = box_target_adapter(&target("linux", "x86_64", "cpu", None)).unwrap();
        assert!(assert_host(adapter, "linux", "x86_64").is_ok());
        let error = assert_host(adapter, "macos", "aarch64").unwrap_err();
        assert!(error.message().contains("cannot run on"), "{error}");
    }

    #[test]
    fn an_entry_point_from_another_platform_is_refused() {
        let windows = box_target_adapter(&target("windows", "x86_64", "cpu", None)).unwrap();
        assert!(assert_python_entry_point(windows, "venv/python.exe").is_ok());
        assert!(assert_python_entry_point(windows, "venv/bin/python").is_err());
    }

    #[test]
    fn a_target_id_is_never_produced_for_an_unsupported_triple() {
        assert!(box_target_id(&target("macos", "x86_64", "cpu", None)).is_err());
        assert!(box_target_id(&target("linux", "x86_64", "metal", None)).is_err());
    }
}
