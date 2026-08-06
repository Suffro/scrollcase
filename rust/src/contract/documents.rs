//! Mirror of the Scrollcase signed-document envelope.
//!
//! Signed documents carry their payload as exact base64-encoded JSON rather than canonicalized JSON.
//! That choice is what makes a third implementation possible at all: verifying a signature means
//! hashing bytes that were transmitted verbatim, so Node, Python and this crate agree without each
//! maintaining a canonical-JSON implementation — historically the richest source of cross-language
//! signature bugs.
//!
//! Decoding is deliberately separate from verifying. This module unwraps an envelope and proves the
//! payload bytes are the ones the envelope names; it never decides that they are authentic. Nothing
//! here reads a key, and the decoded bytes stay bytes: a caller that deserialises them before a
//! signature has verified has skipped the only step that matters.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{fail, Result};

/// Format version carried by every document this contract describes.
pub const BOX_SCHEMA_VERSION: u32 = 2;

/// The only payload encoding the format defines.
pub const PAYLOAD_ENCODING: &str = "base64-json-utf8";

/// The only signature algorithm the format defines.
pub const SIGNATURE_ALGORITHM: &str = "ed25519";

/// Namespace prefixing every document's `kind` discriminator.
///
/// A project that already publishes boxes owns its own namespace and must keep emitting it, or its
/// installed clients stop recognising the documents they are handed. The namespace is therefore the
/// publishing project's to declare, not the tool's to impose; this is only the default used by a
/// project with no published history to preserve.
pub const DEFAULT_DOCUMENT_NAMESPACE: &str = "scrollcase.box";

/// The three document types the format defines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentType {
    /// The immutable description of one built box.
    Release,
    /// The releases a channel currently offers.
    Channel,
    /// The kill-list withdrawing a published release.
    Revocations,
}

impl DocumentType {
    /// The suffix this type carries in a `kind` string.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Release => "release",
            Self::Channel => "channel",
            Self::Revocations => "revocations",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "release" => Some(Self::Release),
            "channel" => Some(Self::Channel),
            "revocations" => Some(Self::Revocations),
            _ => None,
        }
    }
}

/// A `kind` split back into the namespace that published it and the type it names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDocumentKind {
    /// The publishing project's namespace.
    pub namespace: String,
    /// The document type.
    pub document_type: DocumentType,
}

/// Whether a namespace is the dotted lowercase identifier the format allows.
///
/// The pattern is `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`, checked by hand so the crate does not carry a
/// regex engine to answer one question.
fn is_document_namespace(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let mut group_is_empty = true;
    for character in value.chars() {
        match character {
            'a'..='z' | '0'..='9' => group_is_empty = false,
            '.' | '-' if !group_is_empty => group_is_empty = true,
            _ => return false,
        }
    }
    !group_is_empty
}

/// Returns the `kind` discriminator for one document type under a namespace.
///
/// # Errors
///
/// When the namespace is not a dotted lowercase identifier.
pub fn document_kind(namespace: &str, document_type: DocumentType) -> Result<String> {
    if !is_document_namespace(namespace) {
        fail!("Invalid document namespace: {namespace}");
    }
    Ok(format!("{namespace}.{}", document_type.as_str()))
}

/// Splits a `kind` back into its namespace and document type.
///
/// Returns `None` when the value is not a document kind at all.
#[must_use]
pub fn parse_document_kind(kind: &str) -> Option<ParsedDocumentKind> {
    let separator = kind.rfind('.')?;
    if separator == 0 {
        return None;
    }
    let namespace = &kind[..separator];
    let document_type = DocumentType::parse(&kind[separator + 1..])?;
    if !is_document_namespace(namespace) {
        return None;
    }
    Some(ParsedDocumentKind {
        namespace: namespace.to_string(),
        document_type,
    })
}

/// One signature over a document's payload bytes.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentSignature {
    /// Signature algorithm; the format defines only `ed25519`.
    pub algorithm: String,
    /// Identifier of the key that produced this signature.
    pub key_id: String,
    /// The signature itself.
    pub signature_base64: String,
}

/// The signing envelope shared by every control document.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedDocument {
    /// Format version of the envelope.
    pub schema_version: u32,
    /// How the payload is encoded.
    pub payload_encoding: String,
    /// The payload, exactly as it was signed and published.
    pub payload_base64: String,
    /// SHA-256 of the decoded payload bytes.
    pub payload_sha256: String,
    /// Every signature offered; the document is accepted when any one of them verifies.
    pub signatures: Vec<DocumentSignature>,
}

/// Lowercase hex SHA-256, matching the encoding the manifests use.
pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

impl SignedDocument {
    /// Parses an envelope without verifying anything about it.
    ///
    /// # Errors
    ///
    /// When the bytes are not a structurally valid envelope.
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        // Read the version before the typed parse, so a v1 document is refused by name instead of
        // producing a shape complaint that hides why it was rejected.
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) {
            if value.get("schemaVersion").and_then(serde_json::Value::as_u64) == Some(1) {
                fail!("Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.");
            }
        }
        serde_json::from_slice(bytes)
            .map_err(|error| crate::error::Error::new(format!("Invalid signed document: {error}.")))
    }

    /// Unwraps the envelope and checks its checksum. Does **not** check any signature.
    ///
    /// # Errors
    ///
    /// When the envelope is unsupported, or the payload bytes do not hash to the value it names.
    pub fn decode_payload(&self) -> Result<Vec<u8>> {
        if self.schema_version == 1 {
            fail!("Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.");
        }
        if self.schema_version != BOX_SCHEMA_VERSION || self.payload_encoding != PAYLOAD_ENCODING {
            fail!("Unsupported signed document.");
        }
        let Ok(bytes) = BASE64.decode(&self.payload_base64) else {
            fail!("Signed payload SHA-256 mismatch.");
        };
        if sha256_hex(&bytes) != self.payload_sha256 {
            fail!("Signed payload SHA-256 mismatch.");
        }
        Ok(bytes)
    }

    /// Whether the envelope is well formed enough to be worth verifying.
    ///
    /// A shape check, never a verification: it says the document deserves an attempt, not that its
    /// signature is good.
    #[must_use]
    pub fn is_well_formed(&self) -> bool {
        self.schema_version == BOX_SCHEMA_VERSION
            && self.payload_encoding == PAYLOAD_ENCODING
            && !self.signatures.is_empty()
            && self
                .signatures
                .iter()
                .all(|signature| signature.algorithm == SIGNATURE_ALGORITHM)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        document_kind, is_document_namespace, parse_document_kind, DocumentType, SignedDocument,
        DEFAULT_DOCUMENT_NAMESPACE,
    };
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine as _;

    fn envelope(payload: &[u8], sha256: &str) -> SignedDocument {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 2,
            "payloadEncoding": "base64-json-utf8",
            "payloadBase64": BASE64.encode(payload),
            "payloadSha256": sha256,
            "signatures": [{
                "algorithm": "ed25519",
                "keyId": "fixture",
                "signatureBase64": BASE64.encode([0u8; 64]),
            }],
        }))
        .unwrap()
    }

    #[test]
    fn the_default_namespace_round_trips() {
        let kind = document_kind(DEFAULT_DOCUMENT_NAMESPACE, DocumentType::Release).unwrap();
        assert_eq!(kind, "scrollcase.box.release");
        let parsed = parse_document_kind(&kind).unwrap();
        assert_eq!(parsed.namespace, DEFAULT_DOCUMENT_NAMESPACE);
        assert_eq!(parsed.document_type, DocumentType::Release);
    }

    #[test]
    fn a_publishers_own_namespace_is_preserved_verbatim() {
        // The whole point of the namespace rule: a project with boxes in the field keeps emitting
        // the kind its installed clients recognise, and this crate never substitutes its own.
        let parsed = parse_document_kind("acme.runtime-box.release").unwrap();
        assert_eq!(parsed.namespace, "acme.runtime-box");
        assert_eq!(parsed.document_type, DocumentType::Release);
    }

    #[test]
    fn namespaces_outside_the_pattern_are_refused() {
        for invalid in ["", ".", "a.", ".a", "a..b", "A.b", "a_b", "a b", "a-", "-a"] {
            assert!(!is_document_namespace(invalid), "{invalid} was accepted");
            assert!(document_kind(invalid, DocumentType::Release).is_err());
        }
        for invalid in ["release", "scrollcase.box", "scrollcase.box.unknown", ".release"] {
            assert!(parse_document_kind(invalid).is_none(), "{invalid} parsed");
        }
    }

    #[test]
    fn a_v1_envelope_is_refused_by_name() {
        let error = SignedDocument::parse(br#"{"schemaVersion":1}"#).unwrap_err();
        assert!(error.message().contains("Unsupported schemaVersion 1"), "{error}");
    }

    #[test]
    fn an_edited_payload_fails_its_own_checksum() {
        let payload = br#"{"schemaVersion":2}"#;
        let good = super::sha256_hex(payload);
        assert_eq!(envelope(payload, &good).decode_payload().unwrap(), payload);

        let error = envelope(b"tampered", &good).decode_payload().unwrap_err();
        assert!(error.message().contains("Signed payload SHA-256 mismatch"), "{error}");
    }

    #[test]
    fn an_unknown_field_is_not_silently_ignored() {
        // serde's default is to skip unknown fields. The signed-document schema sets
        // additionalProperties:false, so accepting one here would make this crate agree to
        // documents Node and Python reject.
        let raw = br#"{"schemaVersion":2,"payloadEncoding":"base64-json-utf8",
            "payloadBase64":"","payloadSha256":"","signatures":[],"extra":1}"#;
        assert!(SignedDocument::parse(raw).is_err());
    }
}
