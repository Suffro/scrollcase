//! End to end over the half of the trust chain that needs no archive.
//!
//! The fixture is a real signed release: the canonical release example, signed with `node:crypto`
//! exactly as `signWithLocalKey` signs, by a key generated for this suite and then discarded. So this
//! proves the crate verifies documents produced by the signer it exists to read, not documents it
//! produced itself.

use std::path::{Path, PathBuf};

use scrollcase_consumer::verify::inspect_release_document;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

/// Writes a mutated copy of the signed document and returns its path.
fn mutated(directory: &Path, mutate: impl Fn(&mut serde_json::Value)) -> PathBuf {
    let mut document: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fixture("signed-release.json")).unwrap()).unwrap();
    mutate(&mut document);
    let path = directory.join(format!("release-{}.json", uuid_like()));
    std::fs::write(&path, serde_json::to_vec_pretty(&document).unwrap()).unwrap();
    path
}

fn uuid_like() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

fn scratch() -> PathBuf {
    let directory = std::env::temp_dir().join(format!("scrollcase-release-{}", uuid_like()));
    std::fs::create_dir_all(&directory).unwrap();
    directory
}

#[test]
fn a_genuine_signed_release_is_accepted_and_fully_interpreted() {
    let inspected =
        inspect_release_document(&fixture("signed-release.json"), &fixture("trusted-key.json"))
            .expect("the fixture release must verify");

    assert_eq!(inspected.release.schema_version, 2);
    assert!(inspected.release.kind.ends_with(".release"));
    // The adapter is resolved from the signed target, and the entry point agreed with it.
    assert_eq!(
        inspected.release.python_entry_point,
        inspected.adapter.python.entry_point
    );
    assert_eq!(inspected.signed.signatures.len(), 1);
}

#[test]
fn nothing_survives_an_edit_to_the_signed_bytes() {
    let directory = scratch();

    // The payload no longer hashes to what the envelope claims.
    let altered_payload = mutated(&directory, |document| {
        document["payloadBase64"] = serde_json::json!("eyJzY2hlbWFWZXJzaW9uIjoyfQ==");
    });
    let error = inspect_release_document(&altered_payload, &fixture("trusted-key.json")).unwrap_err();
    assert!(
        error.message().contains("Signed payload SHA-256 mismatch"),
        "{error}"
    );

    // The payload and its checksum agree, but the signature no longer covers them: this is the case
    // a checksum alone would wave through, and the only thing that catches it is the signature.
    let restated = mutated(&directory, |document| {
        use base64::engine::general_purpose::STANDARD as BASE64;
        use base64::Engine as _;
        let payload = br#"{"schemaVersion":2,"kind":"scrollcase.box.release"}"#;
        document["payloadBase64"] = serde_json::json!(BASE64.encode(payload));
        document["payloadSha256"] = serde_json::json!(sha256_hex(payload));
    });
    let error = inspect_release_document(&restated, &fixture("trusted-key.json")).unwrap_err();
    assert!(error.message().contains("no valid signature"), "{error}");

    // A signature naming a key this caller does not trust.
    let foreign_key = mutated(&directory, |document| {
        document["signatures"][0]["keyId"] = serde_json::json!("someone-elses-key");
    });
    let error = inspect_release_document(&foreign_key, &fixture("trusted-key.json")).unwrap_err();
    assert!(error.message().contains("no valid signature"), "{error}");

    // A v1 envelope is refused by name rather than reinterpreted.
    let legacy = mutated(&directory, |document| {
        document["schemaVersion"] = serde_json::json!(1);
    });
    let error = inspect_release_document(&legacy, &fixture("trusted-key.json")).unwrap_err();
    assert!(
        error.message().contains("Unsupported schemaVersion 1"),
        "{error}"
    );

    std::fs::remove_dir_all(directory).unwrap();
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    use std::fmt::Write as _;
    Sha256::digest(bytes)
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}
