//! The complete read-only trust chain, over real archives on disk.
//!
//! Every case here builds a box, signs a release over the archive's actual bytes, and then breaks
//! exactly one thing. What is asserted is not that an error occurred but *which* — a check that fires
//! for the wrong reason is a check that has stopped working.

mod support;

use scrollcase_consumer::archive::{extract_zip_archive, list_zip_entries};
use scrollcase_consumer::verify::inspect_box_archive;
use serde_json::json;
use support::Entry;

#[test]
fn a_valid_box_passes_the_whole_chain() {
    let fixture = support::valid("archive-valid");
    let inspected = inspect_box_archive(
        &fixture.release_path,
        &fixture.key_path,
        Some(&fixture.archive_path),
    )
    .expect("a valid fixture box must pass");

    assert_eq!(inspected.release.release.box_id, "fixture-box");
    assert_eq!(inspected.box_manifest.box_id, "fixture-box");
    assert_eq!(inspected.entries.len(), 3);
}

#[test]
fn the_archive_must_be_the_one_the_release_signed() {
    // Size and hash come from the signed release and are checked before any entry is read.
    let fixture = support::build(
        "archive-size",
        |_| {},
        |_| {},
        |release| release["archive"]["sizeBytes"] = json!(999_999),
    );
    let error = inspect_box_archive(
        &fixture.release_path,
        &fixture.key_path,
        Some(&fixture.archive_path),
    )
    .unwrap_err();
    assert!(error.message().contains("Archive size mismatch"), "{error}");

    let fixture = support::build(
        "archive-hash",
        |_| {},
        |_| {},
        |release| release["archive"]["sha256"] = json!("a".repeat(64)),
    );
    let error = inspect_box_archive(
        &fixture.release_path,
        &fixture.key_path,
        Some(&fixture.archive_path),
    )
    .unwrap_err();
    assert!(error.message().contains("Archive SHA-256 mismatch"), "{error}");
}

#[test]
fn box_json_must_agree_with_the_signed_release_field_by_field() {
    // The gap this closes: an archive whose hash matches its release perfectly, but which describes
    // a different box. Only comparing the two manifests catches it.
    for (field, mutate) in [
        (
            "modelId",
            Box::new(|manifest: &mut serde_json::Value| {
                manifest["modelId"] = json!("another-model");
            }) as Box<dyn Fn(&mut serde_json::Value)>,
        ),
        (
            "execution",
            Box::new(|manifest: &mut serde_json::Value| {
                manifest["execution"] =
                    json!({ "kind": "python-script", "script": "app/other.py", "defaultArgs": [] });
            }),
        ),
        (
            "environment",
            Box::new(|manifest: &mut serde_json::Value| {
                manifest["environment"] = json!({ "SCROLLCASE_SMUGGLED": "1" });
            }),
        ),
        (
            "provenance",
            Box::new(|manifest: &mut serde_json::Value| {
                manifest["provenance"]["sourceTreeDirty"] = json!(true);
            }),
        ),
    ] {
        // Mutate box.json only: the release keeps describing the original box.
        let fixture = support::build(
            &format!("archive-disagree-{field}"),
            |_| {},
            move |entries| {
                let mut manifest = support::box_manifest();
                mutate(&mut manifest);
                entries[0] = Entry::File(
                    "box.json",
                    serde_json::to_vec_pretty(&manifest).unwrap(),
                    0o644,
                );
            },
            |_| {},
        );
        let error = inspect_box_archive(
            &fixture.release_path,
            &fixture.key_path,
            Some(&fixture.archive_path),
        )
        .unwrap_err();
        assert!(
            error.message() == format!("box.json mismatch: {field}"),
            "expected a {field} mismatch, got: {error}"
        );
    }
}

#[test]
fn an_archive_without_its_declared_interpreter_is_refused() {
    let fixture = support::build(
        "archive-no-interpreter",
        |_| {},
        |entries| {
            entries.retain(|entry| !matches!(entry, Entry::File("venv/bin/python", _, _)));
        },
        |_| {},
    );
    let error = inspect_box_archive(
        &fixture.release_path,
        &fixture.key_path,
        Some(&fixture.archive_path),
    )
    .unwrap_err();
    assert!(error.message().contains("Archive is missing venv/"), "{error}");
}

#[test]
fn an_archive_without_its_declared_script_is_refused() {
    let fixture = support::build(
        "archive-no-script",
        |_| {},
        |entries| {
            entries.retain(|entry| !matches!(entry, Entry::File("app/main.py", _, _)));
        },
        |_| {},
    );
    let error = inspect_box_archive(
        &fixture.release_path,
        &fixture.key_path,
        Some(&fixture.archive_path),
    )
    .unwrap_err();
    assert!(error.message().contains("Execution script is missing"), "{error}");
}

#[test]
fn box_json_must_be_an_entry_with_its_own_bytes() {
    // A link resolves, but metadata is read out of the archive, so `box.json` has to be a file.
    let fixture = support::build(
        "archive-box-json-link",
        |_| {},
        |entries| {
            entries[0] = Entry::File("real-box.json", b"{}".to_vec(), 0o644);
            entries.push(Entry::Link("box.json", "real-box.json"));
        },
        |_| {},
    );
    let error = inspect_box_archive(
        &fixture.release_path,
        &fixture.key_path,
        Some(&fixture.archive_path),
    )
    .unwrap_err();
    assert!(error.message().contains("missing box.json"), "{error}");
}

#[test]
fn a_link_the_contract_permits_survives_listing_and_extraction() {
    let fixture = support::build(
        "archive-good-link",
        |_| {},
        |entries| {
            entries.push(Entry::File("venv/bin/python3.11", b"#!/bin/sh\n".to_vec(), 0o755));
            entries.push(Entry::Link("venv/bin/python3", "python3.11"));
        },
        |_| {},
    );
    let entries = list_zip_entries(&fixture.archive_path).expect("the link must be carryable");
    assert_eq!(entries.len(), 5);

    let destination = fixture.directory.join("extracted");
    extract_zip_archive(&fixture.archive_path, &destination).expect("extraction must succeed");
    let link = destination.join("venv/bin/python3");
    assert!(std::fs::symlink_metadata(&link).unwrap().is_symlink());
    // Written as the relative string it was validated as, so it means the same thing wherever the
    // box lands.
    assert_eq!(std::fs::read_link(&link).unwrap().to_str().unwrap(), "python3.11");
}

#[test]
fn a_link_out_of_the_payload_is_refused_before_anything_is_written() {
    let fixture = support::build(
        "archive-escaping-link",
        |_| {},
        |entries| entries.push(Entry::Link("venv/bin/escape", "../../../../etc/passwd")),
        |_| {},
    );
    let error = list_zip_entries(&fixture.archive_path).unwrap_err();
    assert!(
        error
            .message()
            .contains("link does not resolve to a file inside the payload"),
        "{error}"
    );

    // And nothing reaches disk: extraction refuses on the same listing, before it writes.
    let destination = fixture.directory.join("extracted");
    assert!(extract_zip_archive(&fixture.archive_path, &destination).is_err());
    assert!(!destination.exists());
}

#[test]
fn nothing_may_be_written_through_a_link() {
    let fixture = support::build(
        "archive-through-link",
        |_| {},
        |entries| {
            entries.push(Entry::File("venv/lib/python3.11/os.py", b"real\n".to_vec(), 0o644));
            entries.push(Entry::Link("venv/lib/python3.1", "python3.11"));
            entries.push(Entry::File(
                "venv/lib/python3.1/evil.py",
                b"planted\n".to_vec(),
                0o644,
            ));
        },
        |_| {},
    );
    let error = list_zip_entries(&fixture.archive_path).unwrap_err();
    // A directory link is refused first, which is exactly why rule 4 is only a second lock.
    assert!(
        error.message().contains("link does not resolve to a file inside the payload")
            || error.message().contains("would be written through a link"),
        "{error}"
    );
}

#[test]
fn extraction_reproduces_the_payload_and_its_modes() {
    let fixture = support::valid("archive-extract");
    let destination = fixture.directory.join("extracted");
    extract_zip_archive(&fixture.archive_path, &destination).unwrap();

    assert!(destination.join("box.json").is_file());
    assert_eq!(
        std::fs::read(destination.join("app/main.py")).unwrap(),
        b"print('fixture')\n"
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = std::fs::metadata(destination.join("venv/bin/python"))
            .unwrap()
            .permissions()
            .mode();
        // The interpreter has to come out executable, or the box cannot run itself.
        assert_eq!(mode & 0o777, 0o755);
    }

    assert_eq!(
        scrollcase_consumer::filesystem::payload_size(&destination).unwrap(),
        std::fs::metadata(destination.join("box.json")).unwrap().len()
            + std::fs::metadata(destination.join("venv/bin/python")).unwrap().len()
            + std::fs::metadata(destination.join("app/main.py")).unwrap().len()
    );
}

#[test]
fn extraction_refuses_to_write_over_an_existing_file() {
    let fixture = support::valid("archive-existing");
    let destination = fixture.directory.join("extracted");
    std::fs::create_dir_all(destination.join("app")).unwrap();
    std::fs::write(destination.join("app/main.py"), b"already here\n").unwrap();

    let error = extract_zip_archive(&fixture.archive_path, &destination).unwrap_err();
    assert!(error.message().contains("cannot write"), "{error}");
    // The file that was already there is untouched.
    assert_eq!(
        std::fs::read(destination.join("app/main.py")).unwrap(),
        b"already here\n"
    );
}

#[test]
fn a_special_entry_is_refused_by_the_real_reader() {
    // The classifier is covered by unit tests; this proves the same refusal through the production
    // reading path, on an archive whose bytes really do declare a fifo.
    let fixture = support::valid("archive-special-entry");
    support::set_entry_file_type(&fixture.archive_path, "app/main.py", 0o010_000);

    let error = list_zip_entries(&fixture.archive_path).unwrap_err();
    assert!(error.message().contains("special entries"), "{error}");

    let destination = fixture.directory.join("extracted");
    assert!(extract_zip_archive(&fixture.archive_path, &destination).is_err());
    assert!(!destination.exists(), "a hostile archive reached the filesystem");
}

#[test]
fn an_encrypted_entry_is_refused_by_the_real_reader() {
    let fixture = support::valid("archive-encrypted-entry");
    support::mark_entry_encrypted(&fixture.archive_path, "app/main.py");

    let error = list_zip_entries(&fixture.archive_path).unwrap_err();
    assert!(error.message().contains("Encrypted ZIP entries"), "{error}");

    let destination = fixture.directory.join("extracted");
    assert!(extract_zip_archive(&fixture.archive_path, &destination).is_err());
    assert!(!destination.exists(), "a hostile archive reached the filesystem");
}
