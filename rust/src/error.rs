//! The single error path.
//!
//! Scrollcase has one rule for validation failures across all its implementations: every one of them
//! produces one clear line, and there is no second error path to reason about. Node expresses that
//! with `fail()`, Python with a single exception type, and this crate with one opaque struct.
//!
//! Deliberately *not* an enum of failure kinds. A caller that matched on variants would be writing
//! its own interpretation of which rejections are equivalent, and every added variant would then be
//! a breaking change to a security-relevant API. The message is the contract, and the conformance
//! fixture pins the substrings that matter.

use std::fmt;

/// A validation or I/O failure, carrying the one line a caller should surface.
#[derive(Debug)]
pub struct Error {
    message: String,
}

impl Error {
    /// Builds an error from a message.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    /// The failure message.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::new(error.to_string())
    }
}

/// Result alias used throughout the crate.
pub type Result<T> = std::result::Result<T, Error>;

/// Builds an [`Error`] from a format string, mirroring Node's `fail()` call sites.
macro_rules! fail {
    ($($argument:tt)*) => {
        return Err($crate::error::Error::new(format!($($argument)*)))
    };
}

pub(crate) use fail;
