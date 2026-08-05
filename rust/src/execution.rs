//! Static execution prerequisites.
//!
//! Execution metadata is not a command string: it names either one regular payload file or one
//! dotted Python module. Checking the file set proves those names can resolve without importing a
//! package, running an `__init__.py`, or starting the application — so the check itself cannot be
//! the thing that executes box code before the trust chain has finished.

use std::collections::BTreeSet;

use crate::contract::targets::BoxTargetAdapter;
use crate::error::{fail, Result};
use crate::path::safe_relative_path;
use crate::release::Execution;

/// The `major.minor` prefix used to locate a standard library directory.
fn python_major_minor(version: &str) -> Result<String> {
    let mut parts = version.split('.');
    let (Some(major), Some(minor)) = (parts.next(), parts.next()) else {
        fail!("Invalid Python version for execution discovery: {version}.");
    };
    if major.is_empty()
        || minor.is_empty()
        || !major.bytes().all(|byte| byte.is_ascii_digit())
        || !minor.bytes().all(|byte| byte.is_ascii_digit())
    {
        fail!("Invalid Python version for execution discovery: {version}.");
    }
    Ok(format!("{major}.{minor}"))
}

/// Every path a dotted module could legitimately resolve to inside a box.
fn module_entry_points(
    adapter: &BoxTargetAdapter,
    module: &str,
    python_version: &str,
) -> Result<Vec<String>> {
    let module_path = module.replace('.', "/");
    let relative = [
        format!("{module_path}.py"),
        format!("{module_path}/__main__.py"),
    ];
    let standard_library = if adapter.platform == "windows" {
        "venv/Lib".to_string()
    } else {
        format!("venv/lib/python{}", python_major_minor(python_version)?)
    };
    let roots = [
        String::new(),
        standard_library.clone(),
        format!("{standard_library}/site-packages"),
    ];
    Ok(roots
        .iter()
        .flat_map(|root| {
            relative.iter().map(move |candidate| {
                if root.is_empty() {
                    candidate.clone()
                } else {
                    format!("{root}/{candidate}")
                }
            })
        })
        .collect())
}

/// Confirms optional execution metadata names something runnable in a payload or archive.
///
/// `files` must hold only regular entries: a link resolves, but the thing that finally runs has to
/// be a file, and the caller decides which of the two questions it is asking.
///
/// # Errors
///
/// When the script is missing, or the module resolves to nothing.
pub fn assert_execution_files(
    execution: Option<&Execution>,
    adapter: &BoxTargetAdapter,
    python_version: &str,
    files: &BTreeSet<String>,
) -> Result<()> {
    let Some(execution) = execution else {
        return Ok(());
    };
    match execution {
        Execution::PythonScript { script, .. } => {
            let safe = safe_relative_path(script)?;
            if !files.contains(&safe) {
                fail!("Execution script is missing from the box: {safe}.");
            }
        }
        Execution::PythonModule { module, .. } => {
            let candidates = module_entry_points(adapter, module, python_version)?;
            if !candidates.iter().any(|path| files.contains(path)) {
                fail!("Execution module is not discoverable in the box: {module}.");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{assert_execution_files, python_major_minor};
    use crate::contract::targets::{box_target_adapter, BoxTarget};
    use crate::release::Execution;
    use std::collections::BTreeSet;

    fn adapter(platform: &str, arch: &str, accelerator: &str) -> &'static crate::contract::targets::BoxTargetAdapter {
        box_target_adapter(&BoxTarget {
            platform: platform.to_string(),
            arch: arch.to_string(),
            accelerator: accelerator.to_string(),
            cuda_version: None,
        })
        .unwrap()
    }

    fn files(paths: &[&str]) -> BTreeSet<String> {
        paths.iter().map(|path| (*path).to_string()).collect()
    }

    #[test]
    fn a_script_must_exist_as_a_regular_entry() {
        let adapter = adapter("linux", "x86_64", "cpu");
        let execution = Execution::PythonScript {
            script: "app/main.py".to_string(),
            default_args: vec![],
        };
        assert!(
            assert_execution_files(Some(&execution), adapter, "3.11.9", &files(&["app/main.py"]))
                .is_ok()
        );
        let error =
            assert_execution_files(Some(&execution), adapter, "3.11.9", &files(&["app/other.py"]))
                .unwrap_err();
        assert!(error.message().contains("Execution script is missing"), "{error}");
    }

    #[test]
    fn a_module_resolves_through_any_of_its_legitimate_locations() {
        let adapter = adapter("linux", "x86_64", "cpu");
        let execution = Execution::PythonModule {
            module: "example_model.main".to_string(),
            default_args: vec![],
        };
        for location in [
            "example_model/main.py",
            "example_model/main/__main__.py",
            "venv/lib/python3.11/example_model/main.py",
            "venv/lib/python3.11/site-packages/example_model/main.py",
            "venv/lib/python3.11/site-packages/example_model/main/__main__.py",
        ] {
            assert!(
                assert_execution_files(Some(&execution), adapter, "3.11.9", &files(&[location]))
                    .is_ok(),
                "{location} did not resolve"
            );
        }
        let error =
            assert_execution_files(Some(&execution), adapter, "3.11.9", &files(&["elsewhere.py"]))
                .unwrap_err();
        assert!(
            error.message().contains("Execution module is not discoverable"),
            "{error}"
        );
    }

    #[test]
    fn windows_looks_in_its_own_standard_library() {
        let windows = adapter("windows", "x86_64", "cpu");
        let execution = Execution::PythonModule {
            module: "pkg".to_string(),
            default_args: vec![],
        };
        assert!(assert_execution_files(
            Some(&execution),
            windows,
            "3.11.9",
            &files(&["venv/Lib/site-packages/pkg/__main__.py"])
        )
        .is_ok());
        // The POSIX layout must not resolve on a Windows target.
        assert!(assert_execution_files(
            Some(&execution),
            windows,
            "3.11.9",
            &files(&["venv/lib/python3.11/site-packages/pkg/__main__.py"])
        )
        .is_err());
    }

    #[test]
    fn a_python_version_that_cannot_locate_a_standard_library_is_refused() {
        assert_eq!(python_major_minor("3.11.9").unwrap(), "3.11");
        assert_eq!(python_major_minor("3.12").unwrap(), "3.12");
        for invalid in ["", "3", "3.x", "x.1", "3."] {
            assert!(python_major_minor(invalid).is_err(), "{invalid} was accepted");
        }
    }

    #[test]
    fn a_library_only_box_declares_no_execution() {
        let adapter = adapter("macos", "aarch64", "metal");
        assert!(assert_execution_files(None, adapter, "3.11.9", &files(&[])).is_ok());
    }
}
