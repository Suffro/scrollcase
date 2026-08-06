//! The path rule every payload-supplied name is screened by.
//!
//! Manifest and archive paths are joined onto a caller's directory, so a name that escapes it writes
//! wherever it likes. The check is purely lexical and consults no filesystem, which is what lets the
//! builder and every consumer apply one rule rather than three approximations: a backslash is folded
//! to a separator first so a Windows-shaped name cannot smuggle a segment past the segment checks,
//! and then nothing absolute, nothing with a drive letter, no `..`, no empty segment and no NUL
//! survives.

use crate::error::{fail, Result};

/// Normalises a payload-relative path and refuses anything that could escape its root.
///
/// Returns the forward-slash form used everywhere in the format.
///
/// # Errors
///
/// When the value is empty, absolute, drive-qualified, contains a NUL, or holds a `..` or empty
/// segment.
pub fn safe_relative_path(value: &str) -> Result<String> {
    let normalized = value.replace('\\', "/");
    if normalized.is_empty() || normalized.starts_with('/') || normalized.contains('\0') {
        fail!("Unsafe relative path: {value}");
    }
    if has_drive_prefix(&normalized) {
        fail!("Unsafe relative path: {value}");
    }
    if normalized
        .split('/')
        .any(|segment| segment == ".." || segment.is_empty())
    {
        fail!("Unsafe relative path: {value}");
    }
    Ok(normalized)
}

/// Whether a normalised path starts with a `C:/`-style drive qualifier.
fn has_drive_prefix(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(
        (characters.next(), characters.next(), characters.next()),
        (Some(letter), Some(':'), Some('/')) if letter.is_ascii_alphabetic()
    )
}

/// Joins a validated payload-relative path onto a root using the host separator.
#[must_use]
pub fn join_relative(root: &std::path::Path, relative: &str) -> std::path::PathBuf {
    let mut path = root.to_path_buf();
    for segment in relative.split('/') {
        path.push(segment);
    }
    path
}

#[cfg(test)]
mod tests {
    use super::safe_relative_path;

    #[test]
    fn accepts_ordinary_payload_paths() {
        assert_eq!(safe_relative_path("box.json").unwrap(), "box.json");
        assert_eq!(
            safe_relative_path("venv/bin/python").unwrap(),
            "venv/bin/python"
        );
        // A backslash is a separator, not a name character: the segments behind it are still checked.
        assert_eq!(
            safe_relative_path("venv\\python.exe").unwrap(),
            "venv/python.exe"
        );
    }

    #[test]
    fn refuses_every_way_out_of_the_root() {
        for value in [
            "",
            "/etc/passwd",
            "C:/windows",
            "..",
            "../escape",
            "venv/../../escape",
            "venv\\..\\escape",
            "venv//python",
            "venv/\0/python",
        ] {
            let error = safe_relative_path(value).unwrap_err();
            assert!(
                error.message().contains("Unsafe relative path"),
                "{value} was accepted or misreported: {error}"
            );
        }
    }
}
