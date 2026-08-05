//! Preparation, attachment, and payload verification, over real boxes on disk.
//!
//! These three produce the only objects the execution surface accepts, so what they refuse matters
//! as much as what they return. Each case breaks one thing and asserts which check fired.

mod support;

use scrollcase_consumer::prepare::{
    attach_extracted_box, verify_and_extract_box, verify_extracted_payload, AttachOptions,
    EnvironmentReportOptions, PrepareOptions, PreparedStatus,
};
use serde_json::json;
// Only the link case needs it, and that case is unix-gated.
#[cfg(unix)]
use support::Entry;

fn prepare_options<'a>(
    fixture: &'a support::BoxFixture,
    destination: &'a std::path::Path,
) -> PrepareOptions<'a> {
    PrepareOptions {
        public_key_path: &fixture.key_path,
        archive: Some(&fixture.archive_path),
        destination,
        environment: EnvironmentReportOptions::default(),
    }
}

fn attach_options<'a>(
    fixture: &'a support::BoxFixture,
    root: &'a std::path::Path,
) -> AttachOptions<'a> {
    AttachOptions {
        public_key_path: &fixture.key_path,
        root,
        environment: EnvironmentReportOptions::default(),
    }
}

#[test]
fn preparing_a_box_yields_a_receipt_describing_what_was_verified() {
    let fixture = support::valid("prepare-valid");
    let destination = fixture.directory.join("installed");
    let prepared =
        verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination))
            .expect("a valid box must prepare");

    assert_eq!(prepared.status(), PreparedStatus::Prepared);
    assert_eq!(prepared.root(), destination);
    assert_eq!(prepared.box_id(), "fixture-box");
    assert_eq!(prepared.model_id(), "fixture-model");
    assert_eq!(prepared.signing_key_ids(), [support::KEY_ID]);
    assert!(prepared.required_assets().is_empty());
    assert!(prepared.execution().is_some());
    // The receipt reports what was measured, and the tree is really there.
    assert!(destination.join("box.json").is_file());
    assert!(prepared.installed_size_bytes() > 0);
}

#[test]
fn a_destination_that_already_exists_is_never_written_into() {
    let fixture = support::valid("prepare-existing");
    let destination = fixture.directory.join("installed");
    std::fs::create_dir_all(&destination).unwrap();
    std::fs::write(destination.join("mine.txt"), b"do not touch\n").unwrap();

    let error =
        verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination))
            .unwrap_err();
    assert!(error.message().contains("Destination already exists"), "{error}");
    // Nothing of the box reached it.
    assert!(!destination.join("box.json").exists());
    assert_eq!(
        std::fs::read(destination.join("mine.txt")).unwrap(),
        b"do not touch\n"
    );
}

#[test]
fn an_extracted_size_that_disagrees_with_the_release_leaves_nothing_behind() {
    let fixture = support::build(
        "prepare-size",
        |_| {},
        |_| {},
        |release| release["installedSizeBytes"] = json!(999_999),
    );
    let destination = fixture.directory.join("installed");
    let error =
        verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination))
            .unwrap_err();
    assert!(
        error
            .message()
            .contains("Extracted payload size does not match the signed release"),
        "{error}"
    );

    // The failure happened in staging, so the destination was never created and no staging directory
    // survives beside it.
    assert!(!destination.exists());
    let leftovers: Vec<_> = std::fs::read_dir(&fixture.directory)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(".scrollcase-prepare-"))
        .collect();
    assert!(leftovers.is_empty(), "staging directory was left behind");
}

#[test]
fn a_release_that_declares_the_true_extracted_size_prepares() {
    // The same guard from the other side: the check passes when the figure is right, which is what
    // makes the failing case above meaningful.
    let fixture = support::valid("prepare-size-ok");
    let staging = fixture.directory.join("probe");
    verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &staging)).unwrap();
    let measured = scrollcase_consumer::filesystem::payload_size(&staging).unwrap();

    let sized = support::build(
        "prepare-size-declared",
        |_| {},
        |_| {},
        move |release| release["installedSizeBytes"] = json!(measured),
    );
    let destination = sized.directory.join("installed");
    let prepared =
        verify_and_extract_box(&sized.release_path, &prepare_options(&sized, &destination)).unwrap();
    assert_eq!(prepared.installed_size_bytes(), measured);
}

#[test]
fn attaching_re_identifies_an_extracted_box_without_its_archive() {
    let fixture = support::valid("attach-valid");
    let destination = fixture.directory.join("installed");
    verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination)).unwrap();

    // The archive is gone; the release and the tree are all that is left.
    std::fs::remove_file(&fixture.archive_path).unwrap();

    let attached =
        attach_extracted_box(&fixture.release_path, &attach_options(&fixture, &destination))
            .expect("an extracted box must attach");
    assert_eq!(attached.status(), PreparedStatus::Attached);
    assert_eq!(attached.box_id(), "fixture-box");
    assert_eq!(attached.root(), destination);
}

#[test]
fn attaching_refuses_anything_that_is_not_an_extracted_box() {
    let fixture = support::valid("attach-not-a-box");

    // A path that does not exist.
    let missing = fixture.directory.join("nowhere");
    let error =
        attach_extracted_box(&fixture.release_path, &attach_options(&fixture, &missing)).unwrap_err();
    assert!(error.message().contains("is not an extracted box directory"), "{error}");

    // A file where a directory was claimed.
    let file = fixture.directory.join("a-file");
    std::fs::write(&file, b"not a box\n").unwrap();
    let error =
        attach_extracted_box(&fixture.release_path, &attach_options(&fixture, &file)).unwrap_err();
    assert!(error.message().contains("is not an extracted box directory"), "{error}");

    // A directory that exists but holds no interpreter.
    let empty = fixture.directory.join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    let error =
        attach_extracted_box(&fixture.release_path, &attach_options(&fixture, &empty)).unwrap_err();
    assert!(error.message().contains("Attached box is missing venv/"), "{error}");
}

#[cfg(unix)]
#[test]
fn attaching_refuses_a_link_standing_in_for_the_box_root() {
    let fixture = support::valid("attach-link-root");
    let destination = fixture.directory.join("installed");
    verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination)).unwrap();

    // A link would mint a receipt for a root that execution then refuses, so it is refused here.
    let link = fixture.directory.join("linked");
    std::os::unix::fs::symlink(&destination, &link).unwrap();
    let error =
        attach_extracted_box(&fixture.release_path, &attach_options(&fixture, &link)).unwrap_err();
    assert!(error.message().contains("is not an extracted box directory"), "{error}");
}

#[test]
fn an_on_demand_asset_must_match_its_signed_descriptor_before_a_receipt_exists() {
    const ASSET: &[u8] = b"trusted on-demand bytes";

    // The asset policy has to appear in both documents, or `box.json` would disagree with the
    // release before the assets themselves are ever looked at.
    let policy = || {
        json!([{
            "url": "https://example.invalid/weights.bin",
            "relativePath": "weights/model.bin",
            "sizeBytes": ASSET.len(),
            "sha256": support::sha256_hex(ASSET),
        }])
    };
    let fixture = support::build(
        "attach-assets",
        |manifest| {
            manifest["weights"] = json!("on-demand");
            manifest["assets"] = policy();
        },
        |_| {},
        |release| {
            release["weights"] = json!("on-demand");
            release["assets"] = policy();
        },
    );

    let destination = fixture.directory.join("installed");
    let prepared =
        verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination))
            .expect("preparing does not require the assets to be present yet");
    assert_eq!(prepared.required_assets().len(), 1);

    // Attaching does, because a receipt minted there exists to be executed.
    let error =
        attach_extracted_box(&fixture.release_path, &attach_options(&fixture, &destination))
            .unwrap_err();
    assert!(error.message().contains("asset is missing"), "{error}");

    // Placed, but truncated.
    std::fs::create_dir_all(destination.join("weights")).unwrap();
    std::fs::write(destination.join("weights/model.bin"), b"short").unwrap();
    let error =
        attach_extracted_box(&fixture.release_path, &attach_options(&fixture, &destination))
            .unwrap_err();
    assert!(error.message().contains("asset size mismatch"), "{error}");

    // Right size, wrong bytes — the case a size check alone waves through.
    std::fs::write(destination.join("weights/model.bin"), vec![b'x'; ASSET.len()]).unwrap();
    let error =
        attach_extracted_box(&fixture.release_path, &attach_options(&fixture, &destination))
            .unwrap_err();
    assert!(error.message().contains("asset SHA-256 mismatch"), "{error}");

    // The real bytes.
    std::fs::write(destination.join("weights/model.bin"), ASSET).unwrap();
    let attached =
        attach_extracted_box(&fixture.release_path, &attach_options(&fixture, &destination))
            .expect("the signed asset must be accepted");
    assert_eq!(attached.required_assets().len(), 1);
}

#[test]
fn payload_verification_proves_the_tree_is_the_one_the_release_describes() {
    let fixture = support::build_with_payload_digest("payload-valid", |_| {});
    let destination = fixture.directory.join("installed");
    verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination)).unwrap();

    let verified =
        verify_extracted_payload(&fixture.release_path, &attach_options(&fixture, &destination))
            .expect("an untouched tree must verify");
    assert_eq!(verified.box_id, "fixture-box");
    assert_eq!(verified.entry_count, 3);

    // A file the list does not name is invisible by construction: this is what lets __pycache__ and
    // a caller's model cache appear without failing an honest box.
    std::fs::write(destination.join("appeared-later.txt"), b"written by the app\n").unwrap();
    assert!(
        verify_extracted_payload(&fixture.release_path, &attach_options(&fixture, &destination))
            .is_ok()
    );
}

#[test]
fn payload_verification_catches_every_way_the_tree_can_stop_matching() {
    let fixture = support::build_with_payload_digest("payload-tamper", |_| {});
    let destination = fixture.directory.join("installed");
    verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination)).unwrap();

    // Content changed.
    std::fs::write(destination.join("app/main.py"), b"print('replaced')\n").unwrap();
    let error =
        verify_extracted_payload(&fixture.release_path, &attach_options(&fixture, &destination))
            .unwrap_err();
    assert!(
        error.message().starts_with("Payload does not match the signed release:"),
        "{error}"
    );

    // A named entry removed.
    std::fs::remove_file(destination.join("app/main.py")).unwrap();
    let error =
        verify_extracted_payload(&fixture.release_path, &attach_options(&fixture, &destination))
            .unwrap_err();
    assert!(error.message().contains("is missing"), "{error}");

    // The list itself edited: caught by its signed hash, before it is ever parsed.
    let fresh = support::build_with_payload_digest("payload-list", |_| {});
    let root = fresh.directory.join("installed");
    verify_and_extract_box(&fresh.release_path, &prepare_options(&fresh, &root)).unwrap();
    std::fs::write(root.join("payload-digest.v1"), b"sha256-path-list-v1\n").unwrap();
    let error =
        verify_extracted_payload(&fresh.release_path, &attach_options(&fresh, &root)).unwrap_err();
    assert!(
        error
            .message()
            .contains("Payload digest list does not match the signed release"),
        "{error}"
    );

    // The list missing entirely.
    std::fs::remove_file(root.join("payload-digest.v1")).unwrap();
    let error =
        verify_extracted_payload(&fresh.release_path, &attach_options(&fresh, &root)).unwrap_err();
    assert!(error.message().contains("missing its payload digest list"), "{error}");
}

#[test]
fn a_release_without_a_commitment_cannot_have_its_payload_verified() {
    let fixture = support::valid("payload-absent");
    let destination = fixture.directory.join("installed");
    verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination)).unwrap();

    let error =
        verify_extracted_payload(&fixture.release_path, &attach_options(&fixture, &destination))
            .unwrap_err();
    assert!(
        error.message().contains("does not commit to a payload digest"),
        "{error}"
    );
}

#[cfg(unix)]
#[test]
fn a_link_is_verified_by_its_target_string_not_by_what_it_points_at() {
    let fixture = support::build_with_payload_digest("payload-link", |entries| {
        entries.push(Entry::File("venv/bin/python3.11", b"#!/bin/sh\n".to_vec(), 0o755));
        entries.push(Entry::Link("venv/bin/python3", "python3.11"));
    });
    let destination = fixture.directory.join("installed");
    verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination)).unwrap();
    assert!(
        verify_extracted_payload(&fixture.release_path, &attach_options(&fixture, &destination))
            .is_ok()
    );

    // Repointed at another real file in the payload. The bytes it now resolves to are legitimate
    // payload bytes, so only comparing the target *string* notices.
    let link = destination.join("venv/bin/python3");
    std::fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink("python", &link).unwrap();
    let error =
        verify_extracted_payload(&fixture.release_path, &attach_options(&fixture, &destination))
            .unwrap_err();
    assert!(
        error.message().starts_with("Payload does not match the signed release:"),
        "{error}"
    );

    // Replaced by a copy of what it pointed at: same content, different kind.
    std::fs::remove_file(&link).unwrap();
    std::fs::write(&link, b"#!/bin/sh\n").unwrap();
    let error =
        verify_extracted_payload(&fixture.release_path, &attach_options(&fixture, &destination))
            .unwrap_err();
    assert!(error.message().contains("is not a link"), "{error}");
}

#[test]
fn a_receipt_carries_the_environment_the_release_declares() {
    let fixture = support::build(
        "prepare-environment",
        |manifest| {
            manifest["environment"] = json!({ "SCROLLCASE_DECLARED": "from-the-release" });
        },
        |_| {},
        |release| {
            release["environment"] = json!({ "SCROLLCASE_DECLARED": "from-the-release" });
        },
    );
    let destination = fixture.directory.join("installed");
    let prepared =
        verify_and_extract_box(&fixture.release_path, &prepare_options(&fixture, &destination))
            .unwrap();

    let report = prepared.environment_report();
    assert_eq!(report.release_variable_count, 1);
    let declared = report
        .variables
        .iter()
        .find(|variable| variable.name == "SCROLLCASE_DECLARED")
        .expect("a declared variable is always actionable enough to list");
    assert_eq!(declared.value, "from-the-release");
}
