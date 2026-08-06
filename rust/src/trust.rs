//! Trusted keys, and the signature check every consumer path begins with.
//!
//! The *caller* decides which public keys it accepts, and that decision is the whole basis of every
//! guarantee below it. This crate never discovers a key, never fetches one, and never treats a key
//! shipped beside an archive as trusted because it arrived.
//!
//! Where those keys come from is the caller's business rather than this crate's, and the difference
//! is a security property, not an ergonomic one. A trust file on disk suits a command line, whose
//! operator is also its administrator. An application shipped to someone else's machine usually
//! wants the opposite: anchors compiled into the binary with `include_str!`, so that editing a file
//! cannot substitute a key, sign a box with it, and have the application accept the result. Both
//! reach verification as [`TrustAnchors`], and everything past this module sees the same resolved
//! slice — there is one verification path, not one per source.
//!
//! A document is accepted when **any one** of its signatures verifies against a trusted key. That is
//! what lets a document signed by both an outgoing and an incoming key stay valid across a rotation,
//! and it is why a signature naming an unknown key is skipped rather than treated as an attack — a
//! build that carries only one of the two keys must still be able to verify. Compiled-in anchors do
//! not change that rule, but they do change who pays for it: rotating a key an application carries
//! means releasing the application, so an application that may ever rotate should compile in the
//! bundle shape and not the single key.

use std::borrow::Cow;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::pkcs8::DecodePublicKey as _;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;

use crate::contract::documents::{sha256_hex, SignedDocument, SIGNATURE_ALGORITHM};
use crate::error::{fail, Error, Result};

/// One public key a caller is willing to accept signatures from.
///
/// Deserialised leniently on purpose: a trust file is the caller's own artefact, not a document the
/// box format governs, and `keygen` writes a `publicKeyBase64` beside the PEM that this crate — like
/// the Node and Python consumers — does not read.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedKey {
    /// Identifier a signature names to select this key.
    pub key_id: String,
    /// The key itself, SPKI PEM. A key without one is skipped rather than rejected.
    #[serde(default)]
    pub public_key_pem: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum TrustFile {
    Bundle { keys: Vec<TrustedKey> },
    Single(TrustedKey),
}

/// The payload of a document whose signature has verified.
#[derive(Debug, Clone)]
pub struct VerifiedPayload {
    /// The exact bytes that were signed, which are also the bytes that were published.
    pub bytes: Vec<u8>,
    /// Those bytes parsed as JSON — only ever produced after a signature has verified.
    pub value: serde_json::Value,
}

/// Reads a trust file holding either a single key or a `{ "keys": [...] }` bundle.
///
/// # Errors
///
/// When the file cannot be read or is not one of the two shapes.
pub fn load_trusted_keys(path: &Path) -> Result<Vec<TrustedKey>> {
    let raw = std::fs::read(path).map_err(|error| {
        Error::new(format!(
            "Invalid trusted ed25519 key file {}: {error}",
            path.display()
        ))
    })?;
    parse_trusted_keys(&raw)
}

/// The same two shapes, from bytes the caller already holds.
///
/// This is the half an application compiling its anchors in needs: `include_str!` produces the
/// bytes, and they go through the parser the file path uses rather than a second reading of the
/// same format written at the call site. A second reading is how the single-key and bundle shapes
/// come to disagree between a CLI and an application that are supposed to trust identically.
///
/// # Errors
///
/// When the bytes are neither a single key nor a bundle.
pub fn parse_trusted_keys(raw: &[u8]) -> Result<Vec<TrustedKey>> {
    match serde_json::from_slice::<TrustFile>(raw) {
        Ok(TrustFile::Bundle { keys }) => Ok(keys),
        Ok(TrustFile::Single(key)) => Ok(vec![key]),
        Err(_) => Err(Error::new("Invalid trusted ed25519 key file.")),
    }
}

/// Where the keys a caller accepts come from.
///
/// Every entry point in this crate takes one of these rather than a path, because a library cannot
/// know whether its caller's trust decision is administrative or compiled in, and choosing for them
/// would decide their threat model. Resolution happens once, at the entry point, and the rest of the
/// crate only ever sees `&[TrustedKey]`.
#[derive(Debug, Clone, Copy)]
pub enum TrustAnchors<'a> {
    /// A trust file, read at the moment of verification. Whoever can write it decides what verifies.
    KeyFile(&'a Path),
    /// Keys the caller already holds — parsed from a compiled-in bundle, a keychain, wherever.
    Keys(&'a [TrustedKey]),
}

impl<'a> TrustAnchors<'a> {
    /// Produces the keys to verify against, reading the trust file only when there is one.
    ///
    /// # Errors
    ///
    /// See [`load_trusted_keys`].
    pub fn resolve(&self) -> Result<Cow<'a, [TrustedKey]>> {
        match *self {
            Self::KeyFile(path) => Ok(Cow::Owned(load_trusted_keys(path)?)),
            Self::Keys(keys) => Ok(Cow::Borrowed(keys)),
        }
    }
}

/// Verifies a signed document against a set of trusted keys and returns its payload.
///
/// The payload is checksummed first — cheap, and it catches truncation — and is parsed only once a
/// signature has verified, so no attacker-controlled JSON ever reaches a typed deserialiser on the
/// strength of the envelope alone.
///
/// # Errors
///
/// When the payload does not match its checksum, when no signature verifies against a trusted key,
/// or when the verified bytes are not a JSON object.
pub fn verify_signed_document(
    document: &SignedDocument,
    trusted: &[TrustedKey],
) -> Result<VerifiedPayload> {
    let bytes = document.decode_payload()?;
    if sha256_hex(&bytes) != document.payload_sha256 {
        fail!("Signed payload SHA-256 mismatch.");
    }

    let verified = document.signatures.iter().any(|signature| {
        // The signed-document schema pins the algorithm to ed25519, so a document naming another one
        // is already refused by name upstream. Skipping here as well costs nothing and keeps this
        // function correct on its own.
        if signature.algorithm != SIGNATURE_ALGORITHM {
            return false;
        }
        // An unknown key id is not necessarily an attack: it is a key this caller does not carry.
        let Some(key) = trusted
            .iter()
            .find(|candidate| candidate.key_id == signature.key_id)
        else {
            return false;
        };
        let Some(pem) = key.public_key_pem.as_deref() else {
            return false;
        };
        let Ok(verifying_key) = VerifyingKey::from_public_key_pem(pem) else {
            return false;
        };
        let Ok(raw_signature) = BASE64.decode(&signature.signature_base64) else {
            return false;
        };
        let Ok(parsed) = Signature::from_slice(&raw_signature) else {
            return false;
        };
        // `verify_strict` rather than `verify`: it additionally refuses a small-order public key and
        // a non-canonical signature component. No compliant signer can produce either, so this can
        // only diverge from the Node and Python consumers on inputs an honest signer never emits —
        // and on those, refusing is the correct answer.
        verifying_key.verify_strict(&bytes, &parsed).is_ok()
    });
    if !verified {
        fail!("Document has no valid signature from a trusted ed25519 key.");
    }

    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| Error::new(format!("Invalid signed JSON payload: {error}")))?;
    if !value.is_object() {
        fail!("Invalid signed JSON payload: expected an object.");
    }
    Ok(VerifiedPayload { bytes, value })
}

/// Verifies a signed document against anchors from either source.
///
/// The one to reach for when the document is not a release — a channel or a revocations document
/// has no consumer entry point of its own, and this keeps it on the same trust resolution.
///
/// # Errors
///
/// See [`TrustAnchors::resolve`] and [`verify_signed_document`].
pub fn verify_signed_document_with_anchors(
    document: &SignedDocument,
    trust: TrustAnchors<'_>,
) -> Result<VerifiedPayload> {
    verify_signed_document(document, &trust.resolve()?)
}

#[cfg(test)]
mod tests {
    use super::{
        load_trusted_keys, parse_trusted_keys, verify_signed_document,
        verify_signed_document_with_anchors, TrustAnchors, TrustedKey,
    };
    use crate::contract::documents::SignedDocument;

    // A real signature, not a mock. The pair was generated with the same `node:crypto` calls
    // `scrollcase keygen` uses, the payload was signed with `sign(null, bytes, privateKey)` exactly
    // as `signWithLocalKey` does, and the private half was discarded with that process. Verifying a
    // hand-built fixture would only prove this crate agrees with itself; this proves it agrees with
    // the signer whose documents it exists to read.
    const PUBLIC_PEM: &str = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA08Lm8cd7zGmEO16cmcblXzdpWYq6KMrg1yZ/Nfzj1VI=\n-----END PUBLIC KEY-----\n";
    const PAYLOAD: &[u8] = br#"{"schemaVersion":2,"kind":"scrollcase.box.release"}"#;
    const SIGNATURE_BASE64: &str =
        "UjyCeFBV9egneyDRuUL/7HcUjQrgcbknsjeUW5inXM1/gynilfzdi7O/YoMQxrqC0FDgPkGpXeK56j0rosTBCQ==";

    fn trusted() -> Vec<TrustedKey> {
        vec![TrustedKey {
            key_id: "fixture-key".to_string(),
            public_key_pem: Some(PUBLIC_PEM.to_string()),
        }]
    }

    fn document(signature_base64: &str, key_id: &str) -> SignedDocument {
        use base64::engine::general_purpose::STANDARD as BASE64;
        use base64::Engine as _;
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 2,
            "payloadEncoding": "base64-json-utf8",
            "payloadBase64": BASE64.encode(PAYLOAD),
            "payloadSha256": crate::contract::documents::sha256_hex(PAYLOAD),
            "signatures": [{
                "algorithm": "ed25519",
                "keyId": key_id,
                "signatureBase64": signature_base64,
            }],
        }))
        .unwrap()
    }

    #[test]
    fn a_genuine_signature_verifies() {
        let payload = verify_signed_document(&document(SIGNATURE_BASE64, "fixture-key"), &trusted())
            .expect("the pinned signature must verify");
        assert_eq!(payload.bytes, PAYLOAD);
        assert_eq!(payload.value["kind"], "scrollcase.box.release");
    }

    #[test]
    fn a_signature_from_an_untrusted_key_is_refused() {
        let error = verify_signed_document(&document(SIGNATURE_BASE64, "someone-else"), &trusted())
            .unwrap_err();
        assert!(error.message().contains("no valid signature"), "{error}");
    }

    #[test]
    fn a_tampered_signature_is_refused() {
        use base64::engine::general_purpose::STANDARD as BASE64;
        use base64::Engine as _;
        let mut raw = BASE64.decode(SIGNATURE_BASE64).unwrap();
        raw[0] ^= 0x01;
        let error =
            verify_signed_document(&document(&BASE64.encode(raw), "fixture-key"), &trusted())
                .unwrap_err();
        assert!(error.message().contains("no valid signature"), "{error}");
    }

    #[test]
    fn a_document_verifies_identically_from_a_file_and_from_compiled_in_bytes() {
        // The bytes an application would reach `include_str!` for. Both anchors are built from this
        // one value, so the test can only pass if the two sources agree on how to read it.
        let embedded = format!(
            r#"{{"keys":[{{"keyId":"fixture-key","publicKeyPem":{}}}]}}"#,
            serde_json::to_string(PUBLIC_PEM).unwrap()
        );
        let signed = document(SIGNATURE_BASE64, "fixture-key");

        let keys = parse_trusted_keys(embedded.as_bytes()).expect("a bundle must parse");
        let in_memory = verify_signed_document_with_anchors(&signed, TrustAnchors::Keys(&keys))
            .expect("compiled-in anchors must verify");

        let directory = std::env::temp_dir().join(format!(
            "scrollcase-anchors-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("trusted-keys.json");
        std::fs::write(&path, embedded.as_bytes()).unwrap();

        let from_file = verify_signed_document_with_anchors(&signed, TrustAnchors::KeyFile(&path))
            .expect("the same bytes as a file must verify");
        assert_eq!(in_memory.bytes, from_file.bytes);

        // And the in-memory source is genuinely checking: an anchor set without the signing key
        // refuses the document a moment after the same call accepted it.
        let stranger = parse_trusted_keys(
            format!(
                r#"{{"keys":[{{"keyId":"someone-else","publicKeyPem":{}}}]}}"#,
                serde_json::to_string(PUBLIC_PEM).unwrap()
            )
            .as_bytes(),
        )
        .unwrap();
        let error = verify_signed_document_with_anchors(&signed, TrustAnchors::Keys(&stranger))
            .unwrap_err();
        assert!(error.message().contains("no valid signature"), "{error}");

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn both_trust_file_shapes_load() {
        let directory = std::env::temp_dir().join(format!(
            "scrollcase-trust-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();

        let single = directory.join("single.json");
        std::fs::write(
            &single,
            serde_json::to_vec(&serde_json::json!({
                "algorithm": "ed25519",
                "keyId": "one",
                "publicKeyBase64": "ignored-by-every-consumer",
                "publicKeyPem": PUBLIC_PEM,
            }))
            .unwrap(),
        )
        .unwrap();
        let keys = load_trusted_keys(&single).unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key_id, "one");

        let bundle = directory.join("bundle.json");
        std::fs::write(
            &bundle,
            serde_json::to_vec(&serde_json::json!({
                "keys": [
                    { "keyId": "outgoing", "publicKeyPem": PUBLIC_PEM },
                    { "keyId": "incoming", "publicKeyPem": PUBLIC_PEM },
                ],
            }))
            .unwrap(),
        )
        .unwrap();
        // A bundle is what makes rotation possible: both keys are trusted at once.
        assert_eq!(load_trusted_keys(&bundle).unwrap().len(), 2);

        let malformed = directory.join("malformed.json");
        std::fs::write(&malformed, b"[]").unwrap();
        assert!(load_trusted_keys(&malformed).is_err());

        std::fs::remove_dir_all(directory).unwrap();
    }
}
