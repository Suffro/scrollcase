//! The mirror, proved against the shared fixtures.
//!
//! These are the cases that define what "the implementations agree" means. They are language-neutral
//! on purpose: the Node builder and the Python consumer drive the same files, so a divergence here is
//! a divergence in the format, not a difference of opinion between test suites.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use scrollcase_consumer::contract::payload_digest::{
    payload_digest_stream, PayloadDigestEntry, PayloadDigestKind,
};
use scrollcase_consumer::contract::targets::{box_target_id, BoxTarget};

const TARGET_ID_CONTRACT: &str = include_str!("../fixtures/target-id-contract.json");
const PAYLOAD_DIGEST_CONTRACT: &str = include_str!("../fixtures/payload-digest-contract.json");

fn sha256_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    Sha256::digest(bytes).iter().fold(
        String::with_capacity(64),
        |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        },
    )
}

#[derive(Deserialize)]
struct TargetIdContract {
    valid: Vec<ValidTargetCase>,
    invalid: Vec<InvalidTargetCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidTargetCase {
    name: String,
    target: BoxTarget,
    target_id: String,
}

#[derive(Deserialize)]
struct InvalidTargetCase {
    name: String,
    target: serde_json::Value,
}

#[test]
fn matches_the_shared_target_id_contract() {
    let contract: TargetIdContract = serde_json::from_str(TARGET_ID_CONTRACT).unwrap();
    assert!(!contract.valid.is_empty() && !contract.invalid.is_empty());

    for case in &contract.valid {
        let produced = box_target_id(&case.target)
            .unwrap_or_else(|error| panic!("{} was refused: {error}", case.name));
        assert_eq!(produced, case.target_id, "{}", case.name);
    }

    for case in &contract.invalid {
        // An invalid target may fail either by shape — a field the target schema forbids — or by
        // rule. Both are refusals, and the contract only asserts that no slug is produced.
        let refused = match serde_json::from_value::<BoxTarget>(case.target.clone()) {
            Ok(target) => box_target_id(&target).is_err(),
            Err(_) => true,
        };
        assert!(refused, "{} produced a target id", case.name);
    }
}

#[derive(Deserialize)]
struct PayloadDigestContract {
    format: String,
    cases: Vec<PayloadDigestCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PayloadDigestCase {
    name: String,
    entries: Vec<PayloadDigestFixtureEntry>,
    stream_base64: String,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PayloadDigestFixtureEntry {
    path: String,
    kind: String,
    #[serde(default)]
    content_base64: Option<String>,
    #[serde(default)]
    link_target: Option<String>,
}

#[test]
fn matches_the_shared_payload_digest_contract() {
    let contract: PayloadDigestContract = serde_json::from_str(PAYLOAD_DIGEST_CONTRACT).unwrap();
    assert_eq!(
        contract.format,
        scrollcase_consumer::contract::payload_digest::PAYLOAD_DIGEST_FORMAT
    );

    for case in &contract.cases {
        let entries: Vec<PayloadDigestEntry> = case
            .entries
            .iter()
            .map(|entry| {
                // A link is hashed over the UTF-8 bytes of its target and never opened: hashing what
                // it points at would make a link indistinguishable from a copy.
                let (kind, content) = match entry.kind.as_str() {
                    "file" => (
                        PayloadDigestKind::File,
                        BASE64
                            .decode(entry.content_base64.as_deref().unwrap())
                            .unwrap(),
                    ),
                    "link" => (
                        PayloadDigestKind::Link,
                        entry.link_target.as_deref().unwrap().as_bytes().to_vec(),
                    ),
                    other => panic!("unknown fixture entry kind {other}"),
                };
                PayloadDigestEntry {
                    path: entry.path.clone(),
                    kind,
                    content_sha256: sha256_hex(&content),
                }
            })
            .collect();

        let stream = payload_digest_stream(&entries).unwrap();
        assert_eq!(BASE64.encode(&stream), case.stream_base64, "{}", case.name);
        assert_eq!(sha256_hex(&stream), case.sha256, "{}", case.name);
    }
}

/// The bundled copies are what `include_str!` reads and what ships in the published crate. They are
/// only trustworthy while they match the canonical files, so drift is a test failure rather than
/// something a reviewer has to notice.
#[test]
fn bundled_assets_match_the_canonical_sources() {
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let canonical_root = repo_root.join("src/contract");
    if !canonical_root.is_dir() {
        // The crate was consumed outside this repository; there is nothing to compare against.
        return;
    }

    let assets = [
        ("fixtures/target-id-contract.json", "fixtures/target-id-contract.json"),
        ("fixtures/payload-digest-contract.json", "fixtures/payload-digest-contract.json"),
        ("fixtures/consumer-conformance.json", "fixtures/consumer-conformance.json"),
        ("schema/signed-document.schema.json", "src/contract/schema/signed-document.schema.json"),
        ("schema/release-manifest.schema.json", "src/contract/schema/release-manifest.schema.json"),
        ("schema/box-manifest.schema.json", "src/contract/schema/box-manifest.schema.json"),
        ("schema/target.schema.json", "src/contract/schema/target.schema.json"),
        ("schema/execution.schema.json", "src/contract/schema/execution.schema.json"),
        ("fixtures/examples/release-manifest.example.json", "fixtures/examples/release-manifest.example.json"),
        ("fixtures/examples/box-manifest.example.json", "fixtures/examples/box-manifest.example.json"),
        ("fixtures/examples/signed-release.example.json", "fixtures/examples/signed-release.example.json"),
    ];
    let crate_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    for (canonical, bundled) in assets {
        let canonical_bytes = std::fs::read(canonical_root.join(canonical)).unwrap();
        let bundled_bytes = std::fs::read(crate_root.join(bundled)).unwrap();
        assert_eq!(
            canonical_bytes, bundled_bytes,
            "{bundled} is stale; run node rust/scripts/sync-assets.mjs"
        );
    }
}
