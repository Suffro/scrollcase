//! Verify, prepare, and run caller-supplied local Scrollcase boxes.
//!
//! A **box** is a portable, locked, self-contained Python environment built for one operating system
//! and accelerator, signed so whoever receives it can prove what they received. This crate is the
//! consuming half of that story, and only that half: it verifies a signed release a caller already
//! holds, extracts or re-identifies the box on local disk, and runs the entry point the release
//! declares.
//!
//! It is deliberately **not** a distribution system. It selects no channel, downloads nothing,
//! updates nothing, and knows about no registry. Every path, trust key, archive and destination comes
//! from the caller, because those lifecycle choices belong to the application, not to the format.
//!
//! # Verification precedes execution
//!
//! No interpreter, script, module or import from a box runs before the signature, the payload shape,
//! the archive size and hash, the entry safety and the manifest agreement have all passed. The type
//! system carries that rule: the receipt proving those checks succeeded has private fields and no
//! public constructor, so it can only be obtained from a function that performed them.
//!
//! # Relationship to the other implementations
//!
//! The Node consumer at `scrollcase/consumer` and the Python `scrollcase_consumer` package implement
//! the same semantics. All three prove themselves against shared language-neutral fixtures rather
//! than maintaining separate definitions of the format.

#![doc(html_root_url = "https://docs.rs/scrollcase-consumer")]

pub mod archive;
pub mod contract;
pub mod environment;
pub mod error;
pub mod execution;
pub mod filesystem;
pub mod path;
pub mod prepare;
pub mod release;
pub mod run;
pub mod trust;
pub mod verify;

pub use error::{Error, Result};
