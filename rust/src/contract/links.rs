//! Mirror of the rule deciding which symbolic links a box payload may carry.
//!
//! A conda prefix is dense with links: the shared-library soname convention alone stores every large
//! library two or three times, and `bin` carries interpreter aliases. Preserving them costs nothing
//! to store and everything to get wrong, because a link is the classic way an archive writes outside
//! the directory it was extracted into.
//!
//! So the rule is deliberately narrow and purely lexical, which is what makes it provable:
//!
//! 1. a target is relative — never absolute, never a drive letter, never a backslash;
//! 2. resolved against the link's own directory it stays inside the payload, so `..` is allowed
//!    exactly as far as it cannot escape;
//! 3. a link resolves to a *regular file*, never to a directory;
//! 4. no entry may have a link as a path prefix, so nothing is ever written *through* a link;
//! 5. chains terminate, within a small bound, without a cycle.
//!
//! Nothing here consults the filesystem, which is what lets the builder and every consumer apply one
//! rule rather than three approximations of it. A consumer applies it to the archive **as received**:
//! a box assembled by hand gets no benefit of the doubt.

use std::collections::{HashMap, HashSet};

/// How many links a single resolution may traverse before it is treated as hostile.
///
/// Real prefixes use one or two hops; a longer chain has no legitimate source and is the cheap way
/// to make resolution expensive.
pub const MAX_PAYLOAD_LINK_DEPTH: usize = 8;

/// What an entry in a payload or archive is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EntryKind {
    /// A regular file.
    File,
    /// A symbolic link, whose content is its target string.
    Link,
    /// A directory.
    Directory,
}

/// One entry as the link rules see it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadEntry {
    /// Payload-relative path, forward slashes.
    pub path: String,
    /// What the entry is.
    pub kind: EntryKind,
    /// The raw link body, present only on a link.
    pub link_target: Option<String>,
}

impl PayloadEntry {
    /// A regular file entry.
    #[must_use]
    pub fn file(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            kind: EntryKind::File,
            link_target: None,
        }
    }

    /// A link entry carrying its raw target.
    #[must_use]
    pub fn link(path: impl Into<String>, target: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            kind: EntryKind::Link,
            link_target: Some(target.into()),
        }
    }

    /// A directory entry.
    #[must_use]
    pub fn directory(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            kind: EntryKind::Directory,
            link_target: None,
        }
    }
}

/// Whether a raw link target is shaped like one a payload may carry, before resolving it.
#[must_use]
pub fn is_relative_link_target(target: &str) -> bool {
    if target.is_empty() || target.contains('\0') || target.contains('\\') {
        return false;
    }
    if target.starts_with('/') {
        return false;
    }
    let mut characters = target.chars();
    !matches!(
        (characters.next(), characters.next()),
        (Some(letter), Some(':')) if letter.is_ascii_alphabetic()
    )
}

/// Resolves a link target against the link's own location, staying inside the payload.
///
/// Returns the resolved payload-relative path, or `None` when the link may not be carried — an
/// absolute target, an escape through `..`, or a link onto itself.
#[must_use]
pub fn resolve_payload_link_target(link_path: &str, target: &str) -> Option<String> {
    if !is_relative_link_target(target) {
        return None;
    }
    let segments: Vec<&str> = link_path.split('/').collect();
    // The link's own name is not part of the directory its target resolves against.
    let mut stack: Vec<&str> = segments[..segments.len() - 1].to_vec();
    if segments.last().is_none_or(|last| last.is_empty()) {
        return None;
    }
    for part in target.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            // Underflow means the target climbed past the payload root: exactly the escape being
            // guarded against, and the reason this is checked per segment rather than on the result.
            if stack.is_empty() {
                return None;
            }
            stack.pop();
            continue;
        }
        stack.push(part);
    }
    if stack.is_empty() {
        return None;
    }
    let resolved = stack.join("/");
    if resolved == link_path {
        return None;
    }
    Some(resolved)
}

/// Rejects an entry set in which anything could be written through a link.
///
/// Returns the offending entry path, or `None` when the set is safe.
#[must_use]
pub fn find_entry_through_link(entries: &[PayloadEntry]) -> Option<&str> {
    let links: HashSet<&str> = entries
        .iter()
        .filter(|entry| entry.kind == EntryKind::Link)
        .map(|entry| entry.path.as_str())
        .collect();
    if links.is_empty() {
        return None;
    }
    for entry in entries {
        for (index, _) in entry.path.match_indices('/') {
            if links.contains(&entry.path[..index]) {
                return Some(&entry.path);
            }
        }
    }
    None
}

/// Follows every link in an entry set until it reaches a regular file.
///
/// A chain that ends anywhere else is refused: at a directory (rule 3), at nothing at all, at
/// itself, or at more hops than a real prefix ever needs. Returns the offending link path, or `None`
/// when every chain ends at a file.
#[must_use]
pub fn find_unresolvable_link(entries: &[PayloadEntry]) -> Option<&str> {
    let by_path: HashMap<&str, &PayloadEntry> = entries
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    let mut directories: HashSet<&str> = HashSet::new();
    for entry in entries {
        if entry.kind == EntryKind::Directory {
            directories.insert(&entry.path);
        }
        for (index, _) in entry.path.match_indices('/') {
            directories.insert(&entry.path[..index]);
        }
    }

    for entry in entries {
        if entry.kind != EntryKind::Link {
            continue;
        }
        let mut seen: HashSet<&str> = HashSet::from([entry.path.as_str()]);
        let mut current = entry;
        let mut depth = 0usize;
        loop {
            if depth >= MAX_PAYLOAD_LINK_DEPTH {
                return Some(&entry.path);
            }
            let target = current.link_target.as_deref().unwrap_or("");
            let Some(resolved) = resolve_payload_link_target(&current.path, target) else {
                return Some(&entry.path);
            };
            // A directory may exist implicitly, through its children, without an entry of its own —
            // so this has to be asked before looking the path up as an entry.
            if directories.contains(resolved.as_str()) {
                return Some(&entry.path);
            }
            let Some(next) = by_path.get(resolved.as_str()) else {
                return Some(&entry.path);
            };
            match next.kind {
                EntryKind::File => break,
                EntryKind::Link => {
                    if !seen.insert(next.path.as_str()) {
                        return Some(&entry.path);
                    }
                    current = next;
                }
                EntryKind::Directory => return Some(&entry.path),
            }
            depth += 1;
        }
    }
    None
}

/// Whether a target platform can extract a payload containing links.
///
/// Creating a symbolic link on Windows needs Developer Mode or elevation, so a Windows box keeps
/// materialising every link rather than producing an archive that fails to extract on an ordinary
/// machine.
#[must_use]
pub fn target_carries_links(platform: &str) -> bool {
    platform != "windows"
}

#[cfg(test)]
mod tests {
    use super::{
        find_entry_through_link, find_unresolvable_link, is_relative_link_target,
        resolve_payload_link_target, target_carries_links, PayloadEntry, MAX_PAYLOAD_LINK_DEPTH,
    };

    #[test]
    fn only_relative_targets_are_shaped_like_a_payload_link() {
        assert!(is_relative_link_target("python3.11"));
        assert!(is_relative_link_target("../lib/libfoo.so.1"));
        for invalid in ["", "/usr/bin/python", "C:/windows/system32", "a\\b", "a\0b"] {
            assert!(!is_relative_link_target(invalid), "{invalid} was accepted");
        }
    }

    #[test]
    fn a_target_resolves_against_the_links_own_directory() {
        assert_eq!(
            resolve_payload_link_target("venv/bin/python", "python3.11").as_deref(),
            Some("venv/bin/python3.11")
        );
        assert_eq!(
            resolve_payload_link_target("venv/lib/libfoo.so", "../lib64/libfoo.so.1").as_deref(),
            Some("venv/lib64/libfoo.so.1")
        );
    }

    #[test]
    fn a_target_may_never_climb_past_the_payload_root() {
        assert_eq!(resolve_payload_link_target("venv/bin/python", "../../../etc/passwd"), None);
        assert_eq!(resolve_payload_link_target("python", "../escape"), None);
        // A link onto itself resolves nowhere.
        assert_eq!(resolve_payload_link_target("venv/bin/python", "python"), None);
    }

    #[test]
    fn a_chain_that_ends_at_a_file_is_carryable() {
        let entries = vec![
            PayloadEntry::link("venv/bin/python", "python3"),
            PayloadEntry::link("venv/bin/python3", "python3.11"),
            PayloadEntry::file("venv/bin/python3.11"),
        ];
        assert_eq!(find_unresolvable_link(&entries), None);
        assert_eq!(find_entry_through_link(&entries), None);
    }

    #[test]
    fn a_chain_that_ends_anywhere_else_is_refused() {
        // At nothing.
        let dangling = vec![PayloadEntry::link("venv/bin/python", "python3.11")];
        assert_eq!(find_unresolvable_link(&dangling), Some("venv/bin/python"));

        // At a directory — rule 3, the one that keeps the rest small. A directory reaches this
        // function in two shapes, and both are refused: named by an entry of its own, and existing
        // only implicitly through its children. The two are asserted separately because the checks
        // that catch them are different lines, and a single case would leave one of them unproven.
        let explicit_directory = vec![
            PayloadEntry::link("venv/lib/python3.1", "python3.11"),
            PayloadEntry::directory("venv/lib/python3.11"),
            PayloadEntry::file("venv/lib/python3.11/os.py"),
        ];
        assert_eq!(
            find_unresolvable_link(&explicit_directory),
            Some("venv/lib/python3.1")
        );

        let implicit_directory = vec![
            PayloadEntry::link("venv/lib/python3.1", "python3.11"),
            PayloadEntry::file("venv/lib/python3.11/os.py"),
        ];
        assert_eq!(
            find_unresolvable_link(&implicit_directory),
            Some("venv/lib/python3.1")
        );

        // At itself, through a cycle.
        let cycle = vec![
            PayloadEntry::link("a", "b"),
            PayloadEntry::link("b", "a"),
        ];
        assert!(find_unresolvable_link(&cycle).is_some());

        // At more hops than a real prefix ever needs.
        let mut long: Vec<PayloadEntry> = (0..=MAX_PAYLOAD_LINK_DEPTH)
            .map(|index| PayloadEntry::link(format!("l{index}"), format!("l{}", index + 1)))
            .collect();
        long.push(PayloadEntry::file(format!("l{}", MAX_PAYLOAD_LINK_DEPTH + 1)));
        assert_eq!(find_unresolvable_link(&long), Some("l0"));
    }

    #[test]
    fn nothing_may_be_written_through_a_link() {
        let entries = vec![
            PayloadEntry::link("venv/lib/python3.1", "python3.11"),
            PayloadEntry::file("venv/lib/python3.11/os.py"),
            PayloadEntry::file("venv/lib/python3.1/evil.py"),
        ];
        assert_eq!(
            find_entry_through_link(&entries),
            Some("venv/lib/python3.1/evil.py")
        );
    }

    #[test]
    fn windows_boxes_carry_no_links() {
        assert!(target_carries_links("macos"));
        assert!(target_carries_links("linux"));
        assert!(!target_carries_links("windows"));
    }
}
