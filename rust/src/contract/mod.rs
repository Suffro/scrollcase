//! The box format, mirrored.
//!
//! `src/contract/` in this repository is the single source of truth for the format. This module does
//! not import it — it cannot, across languages — so it *mirrors* the rules and proves the mirror
//! against the shared fixtures. That is how a Rust client, the Node builder and the Python consumer
//! stay in agreement without sharing a runtime.
//!
//! Nothing here touches a filesystem, a key, or a process. Every function is a pure statement about
//! bytes or names, which is what makes the mirror provable in the first place.

pub mod documents;
pub mod links;
pub mod payload_digest;
pub mod targets;
