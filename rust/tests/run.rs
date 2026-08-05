//! Execution, against a box that really is spawned.
//!
//! The fixture interpreter is a real executable placed where the target adapter fixes, so these
//! cases exercise the argument vector, the environment and the process lifecycle rather than a stand
//! in for them. They are unix-gated because the stand-in is a shell script; the code under test is
//! not, and its Windows branches are read against the same expectations.

#![cfg(unix)]

mod support;

use std::path::Path;
use std::sync::mpsc::channel;

use scrollcase_consumer::prepare::{
    verify_and_extract_box, EnvironmentReportOptions, PrepareOptions, PreparedBox,
};
use scrollcase_consumer::run::{
    run_box, run_extracted_box, ForwardedSignal, RunBoxOptions, RunOptions, StdioMode,
};
use serde_json::json;

fn prepare(fixture: &support::BoxFixture, destination: &Path) -> PreparedBox {
    verify_and_extract_box(
        &fixture.release_path,
        &PrepareOptions {
            public_key_path: &fixture.key_path,
            archive: Some(&fixture.archive_path),
            destination,
            environment: EnvironmentReportOptions::default(),
        },
    )
    .expect("the fixture box must prepare")
}

fn quiet() -> RunOptions<'static> {
    RunOptions {
        stdout: StdioMode::Null,
        stderr: StdioMode::Null,
        ..RunOptions::default()
    }
}

fn invocation(root: &Path) -> Vec<String> {
    std::fs::read_to_string(root.join("invocation.txt"))
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect()
}

#[test]
fn a_prepared_box_runs_with_its_own_interpreter() {
    let fixture = support::valid("run-valid");
    let destination = fixture.directory.join("installed");
    let prepared = prepare(&fixture, &destination);

    let result = run_extracted_box(&prepared, &quiet()).expect("the box must run");
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(result.signal, None);

    // The interpreter ran with the box root as its working directory, so its record landed there.
    let arguments = invocation(&destination);
    assert_eq!(
        arguments,
        [destination.join("app/main.py").to_string_lossy().to_string()]
    );
}

#[test]
fn the_release_arguments_always_precede_the_callers() {
    let fixture = support::build(
        "run-arguments",
        |manifest| {
            manifest["execution"] = json!({
                "kind": "python-script",
                "script": "app/main.py",
                "defaultArgs": ["--from-the-release", "first"],
            });
        },
        |_| {},
        |release| {
            release["execution"] = json!({
                "kind": "python-script",
                "script": "app/main.py",
                "defaultArgs": ["--from-the-release", "first"],
            });
        },
    );
    let destination = fixture.directory.join("installed");
    let prepared = prepare(&fixture, &destination);

    let result = run_extracted_box(
        &prepared,
        &RunOptions {
            args: vec!["--from-the-caller".to_string(), "second".to_string()],
            ..quiet()
        },
    )
    .unwrap();
    assert_eq!(result.exit_code, Some(0));

    let arguments = invocation(&destination);
    assert_eq!(
        &arguments[1..],
        ["--from-the-release", "first", "--from-the-caller", "second"]
    );
}

#[test]
fn a_non_zero_exit_is_reported_rather_than_treated_as_a_failure() {
    // A box that runs and fails is not a verification failure: the caller decides what a non-zero
    // exit means for its own workflow.
    let fixture = support::valid("run-exit-code");
    let destination = fixture.directory.join("installed");
    let prepared = prepare(&fixture, &destination);

    let result = run_extracted_box(
        &prepared,
        &RunOptions {
            env: vec![("SCROLLCASE_TEST_EXIT".to_string(), "3".to_string())],
            ..quiet()
        },
    )
    .unwrap();
    assert_eq!(result.exit_code, Some(3));
    assert_eq!(result.signal, None);
}

#[test]
fn the_signed_environment_beats_the_caller_and_the_host() {
    // Deliberately not touching the host environment: `set_var` mutates process-wide state that
    // every other test in this binary shares. Host precedence is proved without a spawn, in the
    // `environment` unit tests; what needs a real child is that the release beats the caller.
    let fixture = support::build(
        "run-environment",
        |manifest| manifest["environment"] = json!({ "SCROLLCASE_TEST_ENV": "from-the-release" }),
        |_| {},
        |release| release["environment"] = json!({ "SCROLLCASE_TEST_ENV": "from-the-release" }),
    );
    let destination = fixture.directory.join("installed");
    let prepared = prepare(&fixture, &destination);

    let result = run_extracted_box(
        &prepared,
        &RunOptions {
            env: vec![(
                "SCROLLCASE_TEST_ENV".to_string(),
                "from-the-caller".to_string(),
            )],
            ..quiet()
        },
    )
    .unwrap();
    assert_eq!(result.exit_code, Some(0));

    // What the child actually received, not what the report claims it received.
    assert_eq!(
        std::fs::read_to_string(destination.join("environment.txt")).unwrap(),
        "from-the-release"
    );
    let variable = result
        .environment_report
        .variables
        .iter()
        .find(|entry| entry.name == "SCROLLCASE_TEST_ENV")
        .unwrap();
    assert!(variable.conflict);
    assert_eq!(variable.sources.len(), 2);
    assert_eq!(variable.sources[0].source.as_str(), "caller");
    assert_eq!(variable.sources[1].source.as_str(), "release");
}

#[test]
fn a_library_only_box_has_nothing_to_run() {
    let fixture = support::build(
        "run-no-execution",
        |manifest| {
            manifest.as_object_mut().unwrap().remove("execution");
        },
        |entries| entries.retain(|entry| !matches!(entry, support::Entry::File("app/main.py", _, _))),
        |release| {
            release.as_object_mut().unwrap().remove("execution");
        },
    );
    let destination = fixture.directory.join("installed");
    let prepared = prepare(&fixture, &destination);

    let error = run_extracted_box(&prepared, &quiet()).unwrap_err();
    assert!(
        error.message().contains("does not declare an execution entry point"),
        "{error}"
    );
}

#[test]
fn a_root_that_changed_since_the_receipt_is_refused_before_anything_is_spawned() {
    let fixture = support::valid("run-swapped-root");
    let destination = fixture.directory.join("installed");
    let prepared = prepare(&fixture, &destination);

    // The receipt names this path; a different directory now answers to it. Preparation cannot have
    // known, and execution is the only place left to notice.
    std::fs::rename(&destination, fixture.directory.join("moved-away")).unwrap();
    std::fs::create_dir_all(&destination).unwrap();

    let error = run_extracted_box(&prepared, &quiet()).unwrap_err();
    assert!(
        error.message().contains("no longer matches the prepared box"),
        "{error}"
    );
    // Nothing was executed from the impostor: no record was written into it.
    assert!(!destination.join("invocation.txt").exists());
}

#[test]
fn a_missing_interpreter_is_refused_rather_than_spawned() {
    let fixture = support::valid("run-no-interpreter");
    let destination = fixture.directory.join("installed");
    let prepared = prepare(&fixture, &destination);
    std::fs::remove_file(destination.join(support::native_python_entry_point())).unwrap();

    let error = run_extracted_box(&prepared, &quiet()).unwrap_err();
    assert!(error.message().contains("Prepared box is missing venv/"), "{error}");
}

#[test]
fn a_signal_the_caller_forwards_ends_the_child_and_is_reported() {
    let fixture = support::valid("run-signal");
    let destination = fixture.directory.join("installed");
    let prepared = prepare(&fixture, &destination);

    let (sender, receiver) = channel();
    // Sent before the run starts: the loop picks it up on its first pass, while the child sleeps.
    sender.send(ForwardedSignal::Terminate).unwrap();

    let result = run_extracted_box(
        &prepared,
        &RunOptions {
            env: vec![("SCROLLCASE_TEST_SLEEP".to_string(), "5".to_string())],
            signals: Some(&receiver),
            ..quiet()
        },
    )
    .unwrap();

    assert_eq!(result.exit_code, None);
    assert_eq!(result.signal.as_deref(), Some("SIGTERM"));
}

#[test]
fn a_one_shot_run_removes_the_box_it_created() {
    let fixture = support::valid("run-box");
    let temporary_root = fixture.directory.join("scratch");

    let result = run_box(
        &fixture.release_path,
        &RunBoxOptions {
            public_key_path: &fixture.key_path,
            archive: Some(&fixture.archive_path),
            temporary_root: &temporary_root,
            run: quiet(),
        },
    )
    .expect("a one-shot run must succeed");
    assert_eq!(result.exit_code, Some(0));

    // The box existed long enough to run and is gone now.
    let leftovers: Vec<_> = std::fs::read_dir(&temporary_root)
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    assert!(leftovers.is_empty(), "a temporary box was left behind");
}

#[test]
fn a_one_shot_run_cleans_up_even_when_the_child_is_signalled() {
    let fixture = support::valid("run-box-signal");
    let temporary_root = fixture.directory.join("scratch");

    let (sender, receiver) = channel();
    sender.send(ForwardedSignal::Terminate).unwrap();

    let result = run_box(
        &fixture.release_path,
        &RunBoxOptions {
            public_key_path: &fixture.key_path,
            archive: Some(&fixture.archive_path),
            temporary_root: &temporary_root,
            run: RunOptions {
                env: vec![("SCROLLCASE_TEST_SLEEP".to_string(), "5".to_string())],
                signals: Some(&receiver),
                ..quiet()
            },
        },
    )
    .unwrap();

    assert_eq!(result.signal.as_deref(), Some("SIGTERM"));
    let leftovers: Vec<_> = std::fs::read_dir(&temporary_root)
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    assert!(leftovers.is_empty(), "a signalled run left its box behind");
}

#[test]
fn the_environment_report_is_delivered_before_the_child_starts() {
    let fixture = support::valid("run-report-order");
    let destination = fixture.directory.join("installed");
    let prepared = prepare(&fixture, &destination);

    let seen = std::cell::RefCell::new(false);
    let record = |_report: &scrollcase_consumer::environment::EnvironmentReport| {
        // The child writes its record into the box root; if this ran after the spawn had completed,
        // that file would already exist.
        *seen.borrow_mut() = !destination.join("invocation.txt").exists();
    };
    run_extracted_box(
        &prepared,
        &RunOptions {
            on_environment_report: Some(&record),
            ..quiet()
        },
    )
    .unwrap();

    assert!(*seen.borrow(), "the report arrived after the child had run");
}
