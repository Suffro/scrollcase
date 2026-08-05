//! The shared consumer conformance suite.
//!
//! These are the same cases the Node and Python consumers run, from the same file. They are the
//! definition of "the three implementations agree": each one builds a box, breaks at most one thing,
//! and states the outcome in language-neutral terms — a receipt shape, an error class, whether a
//! destination exists, what argument vector would have been spawned.
//!
//! The spawn is faked, exactly as it is in the other two harnesses. That is not a shortcut: it is
//! what lets a case assert the argument vector, the working directory, the absence of a shell and the
//! forwarding of a signal without depending on a real interpreter being present.

#![allow(clippy::too_many_lines)]

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use scrollcase_consumer::environment::EnvironmentReport;
use scrollcase_consumer::prepare::{
    attach_extracted_box, verify_and_extract_box, verify_extracted_payload, AttachOptions,
    EnvironmentReportOptions, PrepareOptions, PreparedBox, PreparedStatus,
};
use scrollcase_consumer::release::Execution;
use scrollcase_consumer::run::{
    run_box, run_extracted_box, BoxInvocation, ForwardedSignal, RunBoxOptions, RunOptions,
    RunningBox, SpawnBox, StdioMode,
};
use serde_json::{json, Map, Value};

const SUITE: &str = include_str!("../fixtures/consumer-conformance.json");
const ASSET_BYTES: &[u8] = b"trusted on-demand bytes";

// ---------------------------------------------------------------------------------------------
// The fixture the suite describes
// ---------------------------------------------------------------------------------------------

/// The conformance profile always uses the CPU accelerator, so `$NATIVE_TARGET` names one of the
/// three targets the suite knows about on every host it runs on.
fn native_target() -> Value {
    let (platform, arch) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", _) => ("macos", "aarch64"),
        ("windows", _) => ("windows", "x86_64"),
        _ => ("linux", "x86_64"),
    };
    json!({ "platform": platform, "arch": arch, "accelerator": "cpu" })
}

fn target_id_of(target: &Value) -> String {
    format!(
        "{}-{}-{}",
        target["platform"].as_str().unwrap(),
        target["arch"].as_str().unwrap(),
        target["accelerator"].as_str().unwrap()
    )
}

fn named_targets() -> BTreeMap<String, Value> {
    ["macos-aarch64-cpu", "linux-x86_64-cpu", "windows-x86_64-cpu"]
        .into_iter()
        .map(|id| {
            let mut parts = id.split('-');
            let platform = parts.next().unwrap();
            let arch = parts.next().unwrap();
            (
                id.to_string(),
                json!({ "platform": platform, "arch": arch, "accelerator": "cpu" }),
            )
        })
        .collect()
}

fn python_entry_point(target: &Value) -> &'static str {
    if target["platform"] == "windows" {
        "venv/python.exe"
    } else {
        "venv/bin/python"
    }
}

/// One archive entry as the fixture builds it.
#[derive(Clone)]
struct Entry {
    path: String,
    data: Vec<u8>,
    mode: u32,
    is_link: bool,
}

impl Entry {
    fn file(path: &str, data: &[u8], mode: u32) -> Self {
        Self {
            path: path.to_string(),
            data: data.to_vec(),
            mode,
            is_link: false,
        }
    }

    fn link(path: &str, target: &str) -> Self {
        Self {
            path: path.to_string(),
            data: target.as_bytes().to_vec(),
            mode: 0o777,
            is_link: true,
        }
    }
}

struct Fixture {
    root: PathBuf,
    archive_path: PathBuf,
    release_path: PathBuf,
    key_path: PathBuf,
    release: Value,
    entries: Vec<Entry>,
    payload_digest: bool,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn scratch(id: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let root = std::env::temp_dir().join(format!("scrollcase-conformance-{safe}-{unique}"));
    std::fs::create_dir_all(&root).unwrap();
    root
}

impl Fixture {
    fn create(id: &str, spec: &Value) -> Self {
        let root = scratch(id);
        let target = match spec.get("target").and_then(Value::as_str) {
            Some("foreign") => {
                let native = target_id_of(&native_target());
                named_targets()
                    .into_iter()
                    .find(|(name, _)| *name != native)
                    .map(|(_, target)| target)
                    .unwrap()
            }
            Some(name) => named_targets().get(name).cloned().unwrap(),
            None => native_target(),
        };
        let entry_point = python_entry_point(&target);

        let execution = if spec.get("execution").and_then(Value::as_str) == Some("module") {
            json!({
                "kind": "python-module",
                "module": "example.application",
                "defaultArgs": ["--default"],
            })
        } else {
            json!({ "kind": "python-script", "script": "app/main.py", "defaultArgs": ["--default", "value with spaces"] })
        };

        let mut manifest = json!({
            "schemaVersion": 2,
            "boxId": "consumer-fixture",
            "modelId": "consumer-fixture-model",
            "runtimeId": "consumer-fixture-runtime",
            "version": "1.0.0",
            "target": target,
            "pythonEntryPoint": entry_point,
            "modelCacheSubdir": "model-cache/consumer-fixture",
            "selfTest": { "pythonImports": ["json"], "timeoutSeconds": 30 },
            "execution": execution.clone(),
            "provenance": {
                "scrollId": "consumer-fixture",
                "scrollVersion": "1.0.0",
                "builderRevision": "b".repeat(40),
                "sourceTreeDirty": false,
                "sourceRevision": "c".repeat(40),
                "pythonVersion": "3.11.9",
                "dependencyLockSha256": "d".repeat(64),
                "builtAt": "2026-01-01T00:00:00.000Z",
                "pixiVersion": "0.50.0"
            }
        });
        if let Some(environment) = spec.get("environment") {
            manifest["environment"] = environment.clone();
        }
        if spec.get("requiredAsset").is_some() {
            manifest["weights"] = json!("on-demand");
            manifest["assets"] = json!([{
                "url": "https://assets.example.org/weights.bin",
                "relativePath": "model-cache/consumer-fixture/weights.bin",
                "sizeBytes": ASSET_BYTES.len(),
                "sha256": support::sha256_hex(ASSET_BYTES),
            }]);
        }

        // Three payload entries besides the digest list, which is what `entryCount: 3` names.
        let mut entries = vec![
            Entry::file("box.json", &serde_json::to_vec_pretty(&manifest).unwrap(), 0o644),
            Entry::file(entry_point, b"#!/bin/sh\nexit 0\n", 0o755),
        ];
        if execution["kind"] == "python-module" {
            entries.push(Entry::file("example/application.py", b"print('module')\n", 0o644));
        } else {
            entries.push(Entry::file("app/main.py", b"print('script')\n", 0o644));
        }

        let mut release = manifest;
        release["kind"] = json!("scrollcase.box.release");
        release["compatibility"] = json!({});

        let mut fixture = Self {
            archive_path: root.join("box.zip"),
            release_path: root.join("release.json"),
            key_path: root.join("trusted-key.json"),
            root,
            release,
            entries,
            payload_digest: spec
                .get("payloadDigest")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        };
        support::write_key(&fixture.key_path);
        fixture.commit();
        fixture
    }

    /// Writes the archive, refreshes the size and digest the release commits to, and signs it.
    ///
    /// Returns the payload's logical size, counting the digest list the commitment adds and a link by
    /// its target string — the same measurement a consumer takes of the extracted tree.
    fn commit(&mut self) -> usize {
        let mut entries = self.entries.clone();
        // A hostile mutation can make the entry set unserialisable — two entries with one name, for
        // instance. Those cases are refused long before a digest is consulted, so the commitment is
        // simply omitted rather than the fixture failing to build.
        if self.payload_digest {
            if let Some(stream) = Self::digest_stream(&entries) {
                self.release["payloadDigest"] = json!({
                    "format": "sha256-path-list-v1",
                    "sha256": support::sha256_hex(&stream),
                });
                entries.push(Entry::file("payload-digest.v1", &stream, 0o644));
            }
        }
        self.write_archive_entries(&entries);
        let bytes = std::fs::read(&self.archive_path).unwrap();
        self.release["archive"] = json!({
            "format": "zip",
            "url": "https://assets.example.org/consumer-fixture.zip",
            "sha256": support::sha256_hex(&bytes),
            "sizeBytes": bytes.len(),
        });
        self.sign();
        entries.iter().map(|entry| entry.data.len()).sum()
    }

    fn digest_stream(entries: &[Entry]) -> Option<Vec<u8>> {
        use scrollcase_consumer::contract::payload_digest::{
            payload_digest_stream, PayloadDigestEntry, PayloadDigestKind,
        };
        let records: Vec<PayloadDigestEntry> = entries
            .iter()
            .filter(|entry| entry.path != "payload-digest.v1")
            .map(|entry| PayloadDigestEntry {
                path: entry.path.clone(),
                kind: if entry.is_link {
                    PayloadDigestKind::Link
                } else {
                    PayloadDigestKind::File
                },
                content_sha256: support::sha256_hex(&entry.data),
            })
            .collect();
        payload_digest_stream(&records).ok()
    }

    fn write_archive_entries(&self, entries: &[Entry]) {
        use std::io::Write as _;
        use zip::write::SimpleFileOptions;
        let file = std::fs::File::create(&self.archive_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for entry in entries {
            if entry.is_link {
                writer
                    .add_symlink(
                        &entry.path,
                        String::from_utf8(entry.data.clone()).unwrap(),
                        SimpleFileOptions::default(),
                    )
                    .unwrap();
                continue;
            }
            writer
                .start_file(
                    &entry.path,
                    SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated)
                        .unix_permissions(entry.mode),
                )
                .unwrap();
            writer.write_all(&entry.data).unwrap();
        }
        writer.finish().unwrap();
    }

    /// Re-signs the release without touching the archive, for mutations that edit signed metadata.
    fn sign(&mut self) {
        let signed = support::sign(&self.release);
        std::fs::write(
            &self.release_path,
            serde_json::to_vec_pretty(&signed).unwrap(),
        )
        .unwrap();
    }
}

// ---------------------------------------------------------------------------------------------
// The fake spawn
// ---------------------------------------------------------------------------------------------

#[derive(Default)]
struct Invocation {
    argv: Vec<String>,
    cwd: PathBuf,
    environment: BTreeMap<String, String>,
    stdio: [StdioMode; 3],
}

#[derive(Default)]
struct FakeSpawnState {
    calls: Vec<Invocation>,
    forwarded: Option<String>,
}

struct FakeSpawner {
    exit_code: i32,
    signal: Option<String>,
    fails: bool,
    state: Arc<Mutex<FakeSpawnState>>,
}

/// The child shares the spawner's state through an `Arc` rather than a borrow, because the trait
/// hands ownership of the child to the run loop while the harness keeps reading what was recorded.
struct FakeChild {
    exit_code: i32,
    signal: Option<String>,
    state: Arc<Mutex<FakeSpawnState>>,
}

impl SpawnBox for FakeSpawner {
    fn spawn(&self, invocation: &BoxInvocation<'_>) -> std::io::Result<Box<dyn RunningBox>> {
        if self.fails {
            return Err(std::io::Error::other("fixture spawn failed"));
        }
        self.state.lock().unwrap().calls.push(Invocation {
            argv: std::iter::once(invocation.program.to_string_lossy().into_owned())
                .chain(invocation.args.iter().cloned())
                .collect(),
            cwd: invocation.cwd.to_path_buf(),
            environment: invocation.environment.clone(),
            stdio: [invocation.stdin, invocation.stdout, invocation.stderr],
        });
        Ok(Box::new(FakeChild {
            exit_code: self.exit_code,
            signal: self.signal.clone(),
            state: Arc::clone(&self.state),
        }))
    }
}

impl RunningBox for FakeChild {
    fn try_wait(&mut self) -> std::io::Result<Option<(Option<i32>, Option<String>)>> {
        // A child a signal is meant to end stays alive until the run loop forwards one, which is the
        // only way the forwarding path is exercised at all.
        if let Some(signal) = self.signal.clone() {
            let forwarded = self.state.lock().unwrap().forwarded.clone();
            return Ok(forwarded.map(|_| (None, Some(signal))));
        }
        Ok(Some((Some(self.exit_code), None)))
    }

    fn forward(&mut self, signal: ForwardedSignal) {
        self.state.lock().unwrap().forwarded = Some(signal.as_str().to_string());
    }
}

// ---------------------------------------------------------------------------------------------
// Case execution
// ---------------------------------------------------------------------------------------------

fn replace_tokens(value: &Value, root: Option<&Path>) -> Value {
    match value {
        Value::String(text) => {
            let target = native_target();
            let replaced = text
                .replace("$NATIVE_PYTHON", python_entry_point(&target))
                .replace("$NATIVE_TARGET", &target_id_of(&target));
            Value::String(match root {
                Some(root) => replaced.replace("$BOX", &root.to_string_lossy()),
                None => replaced,
            })
        }
        Value::Array(items) => Value::Array(items.iter().map(|i| replace_tokens(i, root)).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, item)| (key.clone(), replace_tokens(item, root)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// Turns an absolute path under the box root back into the `$BOX/...` form the suite states.
fn normalize_path(root: &Path, value: &str) -> String {
    let path = Path::new(value);
    let Ok(relative) = path.strip_prefix(root) else {
        return value.to_string();
    };
    let relative = relative
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    if relative.is_empty() {
        "$BOX".to_string()
    } else {
        format!("$BOX/{relative}")
    }
}

/// Matches a failure message against the suite's error classes, in the order the fixture lists them.
fn classify_error(message: &str, patterns: &Map<String, Value>) -> String {
    let lowered = message.to_lowercase();
    for (code, pattern) in patterns {
        let pattern = pattern.as_str().unwrap();
        // The patterns are alternations of literals plus one anchor, which is all the suite uses.
        if pattern.split('|').any(|alternative| {
            let alternative = alternative.trim_start_matches('^').to_lowercase();
            if pattern.starts_with('^') {
                lowered.starts_with(&alternative)
            } else {
                lowered.contains(&alternative)
            }
        }) {
            return code.clone();
        }
    }
    format!("unclassified: {message}")
}

fn execution_kind(execution: Option<&Execution>) -> Value {
    match execution {
        Some(Execution::PythonScript { .. }) => json!("python-script"),
        Some(Execution::PythonModule { .. }) => json!("python-module"),
        None => Value::Null,
    }
}

fn report_value(report: &EnvironmentReport, names: &[String]) -> Value {
    json!({
        "mode": if report.mode == scrollcase_consumer::environment::ReportMode::Full { "full" } else { "summary" },
        "hostValuesRevealed": report.host_values_revealed,
        "releaseVariableCount": report.release_variable_count,
        "conflictCount": report.conflict_count,
        "variables": report.variables.iter()
            .filter(|variable| names.contains(&variable.name))
            .map(|variable| json!({
                "name": variable.name,
                "source": variable.source.as_str(),
                "value": variable.value,
                "executionAffecting": variable.execution_affecting,
                "conflict": variable.conflict,
                "sources": variable.sources.iter().map(|source| json!({
                    "source": source.source.as_str(),
                    "name": source.name,
                    "value": source.value,
                })).collect::<Vec<_>>(),
            }))
            .collect::<Vec<_>>(),
    })
}

fn receipt_value(prepared: &PreparedBox, expected: &Value, names: &[String]) -> Value {
    let mut receipt = json!({
        "status": if prepared.status() == PreparedStatus::Prepared { "prepared" } else { "attached" },
        "boxId": prepared.box_id(),
        "executionKind": execution_kind(prepared.execution()),
        "requiredAssetCount": prepared.required_assets().len(),
        "pythonEntryPoint": prepared.python_entry_point(),
        "targetId": prepared.target_id(),
    });
    if expected.get("environmentReport").is_some() {
        receipt["environmentReport"] = report_value(prepared.environment_report(), names);
    }
    receipt
}

fn materialize_asset(prepared: &PreparedBox, state: Option<&str>) {
    let Some(state) = state else { return };
    if state == "missing" {
        return;
    }
    let asset = &prepared.required_assets()[0];
    let path = prepared.root().join(&asset.relative_path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let bytes: Vec<u8> = match state {
        "wrong-size" => ASSET_BYTES[1..].to_vec(),
        "wrong-hash" => vec![b'x'; ASSET_BYTES.len()],
        _ => ASSET_BYTES.to_vec(),
    };
    std::fs::write(path, bytes).unwrap();
}

fn env_options(runtime: &Value) -> EnvironmentReportOptions {
    EnvironmentReportOptions {
        env_report: runtime.get("envReport").and_then(Value::as_bool).unwrap_or(false),
        env_report_values: runtime
            .get("envReportValues")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        // The case's host environment is stated rather than imposed on the process, so tests running
        // in parallel never see each other's.
        host_environment: Some(pairs(runtime.get("hostEnvironment"))),
    }
}

fn string_list(runtime: &Value, key: &str) -> Vec<String> {
    runtime
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn pairs(value: Option<&Value>) -> Vec<(String, String)> {
    value
        .and_then(Value::as_object)
        .map(|fields| {
            fields
                .iter()
                .filter_map(|(name, item)| {
                    item.as_str().map(|text| (name.clone(), text.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------------

/// Mutations applied to an already-extracted tree rather than to the archive.
const POST_EXTRACTION: &[&str] = &[
    "attach-missing-root",
    "attach-file-root",
    "attach-symlink-root",
    "add-root-files",
    "chmod-script",
    "touch-script",
    "tamper-script",
    "remove-interpreter",
    "remove-script",
    "retarget-interpreter-link",
    "remove-payload-digest-list",
    "tamper-payload-digest-list",
];

fn mutate_fixture(fixture: &mut Fixture, mutation: &str, destination: &Path) {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine as _;

    match mutation {
        "alter-signature" | "alter-payload" => {
            let mut signed: Value =
                serde_json::from_slice(&std::fs::read(&fixture.release_path).unwrap()).unwrap();
            if mutation == "alter-signature" {
                signed["signatures"][0]["signatureBase64"] = json!("AA==");
            } else {
                signed["payloadBase64"] = json!(BASE64.encode(b"altered payload"));
            }
            std::fs::write(
                &fixture.release_path,
                serde_json::to_vec_pretty(&signed).unwrap(),
            )
            .unwrap();
        }
        "alter-archive-bytes" => {
            let mut bytes = std::fs::read(&fixture.archive_path).unwrap();
            let last = bytes.len() - 1;
            bytes[last] ^= 0x01;
            std::fs::write(&fixture.archive_path, bytes).unwrap();
        }
        "alter-archive-size" => {
            let size = fixture.release["archive"]["sizeBytes"].as_u64().unwrap();
            fixture.release["archive"]["sizeBytes"] = json!(size + 1);
            fixture.sign();
        }
        "alter-release-model" => {
            fixture.release["modelId"] = json!("altered-model");
            fixture.sign();
        }
        "alter-release-execution" => {
            fixture.release["execution"]["defaultArgs"] = json!(["--altered"]);
            fixture.sign();
        }
        "alter-release-environment" => {
            fixture.release["environment"] = json!({ "SCROLLCASE_CHANGED_AFTER_BUILD": "1" });
            fixture.sign();
        }
        "create-destination" => std::fs::create_dir_all(destination).unwrap(),
        "remove-interpreter" | "remove-script" | "remove-module" => {
            let removed = match mutation {
                "remove-interpreter" => fixture.release["pythonEntryPoint"]
                    .as_str()
                    .unwrap()
                    .to_string(),
                "remove-script" => fixture.release["execution"]["script"]
                    .as_str()
                    .unwrap()
                    .to_string(),
                _ => format!(
                    "{}.py",
                    fixture.release["execution"]["module"]
                        .as_str()
                        .unwrap()
                        .replace('.', "/")
                ),
            };
            fixture.entries.retain(|entry| entry.path != removed);
            fixture.commit();
        }
        // The other side of the link rule. A real box reaches its interpreter through exactly this
        // shape — `venv/bin/python` is a link to the versioned binary beside it — so a consumer that
        // only accepts regular files here rejects every box the builder produces on macOS and Linux.
        "link-interpreter" => {
            let entry_point = fixture.release["pythonEntryPoint"]
                .as_str()
                .unwrap()
                .to_string();
            let (directory, name) = entry_point.rsplit_once('/').unwrap_or(("", &entry_point));
            let link_target = format!("{name}-real");
            let renamed = if directory.is_empty() {
                link_target.clone()
            } else {
                format!("{directory}/{link_target}")
            };
            for entry in &mut fixture.entries {
                if entry.path == entry_point {
                    entry.path.clone_from(&renamed);
                }
            }
            fixture.entries.push(Entry::link(&entry_point, &link_target));
            // Measured from what is actually written, digest list included, and then re-signed: the
            // signed figure is still earned rather than copied from the consumer's own result.
            let total = fixture.commit();
            fixture.release["installedSizeBytes"] = json!(total);
            fixture.sign();
        }
        "add-traversal-entry" | "add-absolute-entry" | "add-link-entry" | "duplicate-entry"
        | "file-directory-collision" => {
            // Three of these names the writer will not emit — a duplicate, a traversing one and an
            // absolute one — so they are written under a same-length placeholder and renamed in the
            // archive's bytes afterwards.
            let (extra, rename) = match mutation {
                "add-traversal-entry" => (Entry::file("zzzz", b"hostile", 0o644), Some(("zzzz", "../x"))),
                "add-absolute-entry" => (Entry::file("yyyy", b"hostile", 0o644), Some(("yyyy", "/abs"))),
                // A link whose target climbs out of the payload: the escape the rule exists to stop.
                "add-link-entry" => (Entry::link("link", "../../../../etc/passwd"), None),
                "duplicate-entry" => (
                    Entry::file("dupentry", b"{}", 0o644),
                    Some(("dupentry", "box.json")),
                ),
                _ => (Entry::file("venv", b"collision", 0o644), None),
            };
            fixture.entries.push(extra);
            fixture.commit();
            if let Some((from, to)) = rename {
                support::rename_entry_bytes(&fixture.archive_path, from, to);
                refresh_archive_commitment(fixture);
            }
        }
        "add-special-entry" => {
            fixture.entries.push(Entry::file("fifo", b"", 0o644));
            fixture.commit();
            support::set_entry_file_type(&fixture.archive_path, "fifo", 0o010_000);
            refresh_archive_commitment(fixture);
        }
        "encrypt-entry" => {
            support::mark_entry_encrypted(&fixture.archive_path, "box.json");
            refresh_archive_commitment(fixture);
        }
        other => panic!("unknown conformance mutation: {other}"),
    }
}

/// Re-states the archive's size and hash after its bytes were edited in place, so the case fails on
/// the shape it is about rather than on a digest that no longer matches.
fn refresh_archive_commitment(fixture: &mut Fixture) {
    let bytes = std::fs::read(&fixture.archive_path).unwrap();
    fixture.release["archive"]["sha256"] = json!(support::sha256_hex(&bytes));
    fixture.release["archive"]["sizeBytes"] = json!(bytes.len());
    fixture.sign();
}

fn mutate_extracted_root(fixture: &Fixture, mutation: &str, root: &Path) -> PathBuf {
    let script = root.join("app/main.py");
    match mutation {
        "attach-missing-root" => return fixture.root.join("missing-root"),
        "attach-file-root" => return fixture.archive_path.clone(),
        "attach-symlink-root" => {
            let linked = fixture.root.join("linked-root");
            #[cfg(unix)]
            std::os::unix::fs::symlink(root, &linked).unwrap();
            return linked;
        }
        "add-root-files" => {
            std::fs::write(root.join("output.log"), b"application output").unwrap();
            std::fs::create_dir_all(root.join("__pycache__")).unwrap();
            std::fs::write(root.join("__pycache__/cached.pyc"), b"compiled").unwrap();
        }
        "chmod-script" => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o600)).unwrap();
            }
        }
        "touch-script" => {
            // A modification time no extractor restores: the digest deliberately does not record one.
            let file = std::fs::OpenOptions::new().write(true).open(&script).unwrap();
            file.set_modified(std::time::UNIX_EPOCH).unwrap();
        }
        "tamper-script" => {
            let mut bytes = std::fs::read(&script).unwrap();
            bytes.push(b' ');
            std::fs::write(&script, bytes).unwrap();
        }
        "remove-interpreter" => {
            std::fs::remove_file(root.join(fixture.release["pythonEntryPoint"].as_str().unwrap()))
                .unwrap();
        }
        "remove-script" => std::fs::remove_file(&script).unwrap(),
        "retarget-interpreter-link" => {
            // A Windows box carries no links at all, so this case never reaches a Windows host.
            #[cfg(unix)]
            {
                let interpreter =
                    root.join(fixture.release["pythonEntryPoint"].as_str().unwrap());
                let target = std::fs::read_link(&interpreter).unwrap();
                std::fs::remove_file(&interpreter).unwrap();
                std::os::unix::fs::symlink(
                    format!("{}-retargeted", target.to_string_lossy()),
                    &interpreter,
                )
                .unwrap();
            }
        }
        "remove-payload-digest-list" => {
            std::fs::remove_file(root.join("payload-digest.v1")).unwrap();
        }
        "tamper-payload-digest-list" => {
            let list = root.join("payload-digest.v1");
            let mut bytes = std::fs::read(&list).unwrap();
            let index = bytes.len() - 2;
            bytes[index] ^= 0x01;
            std::fs::write(&list, bytes).unwrap();
        }
        other => panic!("unknown extracted-root mutation: {other}"),
    }
    root.to_path_buf()
}

// ---------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------

struct Outcome {
    actual: Value,
    expected: Value,
}

fn run_case(case: &Value, patterns: &Map<String, Value>) -> Outcome {
    let id = case["id"].as_str().unwrap();
    let action = case["action"].as_str().unwrap();
    let runtime = case.get("runtime").cloned().unwrap_or_else(|| json!({}));
    let mutation = case.get("mutation").and_then(Value::as_str);
    let spec = case.get("fixture").cloned().unwrap_or_else(|| json!({}));
    let expected_raw = &case["expected"];

    let mut fixture = Fixture::create(id, &spec);
    let destination = fixture.root.join("prepared");
    let temporary = fixture.root.join("temporary");
    let report_names = string_list(&runtime, "reportVariables");
    let environment = env_options(&runtime);

    if spec.get("linkedInterpreter").is_some() {
        mutate_fixture(&mut fixture, "link-interpreter", &destination);
    }
    let post_extraction = matches!(action, "attach" | "verify-payload")
        && mutation.is_some_and(|name| POST_EXTRACTION.contains(&name));
    if let Some(name) = mutation {
        if !post_extraction {
            mutate_fixture(&mut fixture, name, &destination);
        }
    }

    let state = Arc::new(Mutex::new(FakeSpawnState::default()));
    let spawner = FakeSpawner {
        exit_code: runtime
            .get("exitCode")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .try_into()
            .unwrap_or(0),
        signal: runtime
            .get("signal")
            .and_then(Value::as_str)
            .map(str::to_string),
        fails: runtime
            .get("spawnError")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        state: Arc::clone(&state),
    };

    let result = execute(
        action,
        &fixture,
        &destination,
        &temporary,
        &runtime,
        expected_raw,
        &report_names,
        &environment,
        &spawner,
        mutation.filter(|_| post_extraction),
    );

    // `$BOX` stays a token in the expectation; it is the observed argv and cwd that are normalised
    // onto it, so the comparison never depends on a temporary directory name.
    let expected = replace_tokens(expected_raw, None);

    let mut actual = match result {
        Ok(mut value) => {
            value.as_object_mut().unwrap().remove("$root");
            value
        }
        Err(error) => json!({
            "outcome": "rejected",
            "error": classify_error(&error, patterns),
        }),
    };

    // Structural observations the suite asks for on either outcome.
    let calls = state.lock().unwrap();
    if expected_raw.get("destinationExists").is_some() {
        actual["destinationExists"] = json!(destination.exists());
    }
    if expected_raw.get("spawned").is_some() {
        actual["spawned"] = json!(!calls.calls.is_empty());
    }
    if expected_raw.get("temporaryDirectoryEmpty").is_some() {
        actual["temporaryDirectoryEmpty"] = json!(temporary
            .read_dir()
            .is_ok_and(|mut entries| entries.next().is_none()));
    }
    if expected_raw.get("forwardedSignal").is_some() {
        actual["forwardedSignal"] = json!(calls.forwarded);
    }
    if expected_raw.get("streamsPreserved").is_some() {
        actual["streamsPreserved"] = json!(calls
            .calls
            .first()
            .is_some_and(|call| call.stdio == [StdioMode::Piped; 3]));
    }
    if expected_raw.get("argv").is_some() {
        // Reported as absent rather than asserted, so a case that failed before spawning shows the
        // error that stopped it instead of an opaque panic here.
        if let Some(call) = calls.calls.first() {
            let root = destination.as_path();
            actual["argv"] = json!(call
                .argv
                .iter()
                .map(|value| normalize_path(root, value))
                .collect::<Vec<_>>());
            actual["cwd"] = json!(normalize_path(root, &call.cwd.to_string_lossy()));
            // There is no shell option to report: the argument vector is passed as built, always.
            actual["shell"] = json!(false);
        }
    }
    if let Some(names) = expected_raw
        .get("effectiveEnvironment")
        .and_then(Value::as_object)
    {
        if let Some(call) = calls.calls.first() {
            actual["effectiveEnvironment"] = Value::Object(
                names
                    .keys()
                    .map(|name| {
                        (
                            name.clone(),
                            call.environment
                                .get(name)
                                .map_or(Value::Null, |value| json!(value)),
                        )
                    })
                    .collect(),
            );
        }
    }

    Outcome { actual, expected }
}

#[allow(clippy::too_many_arguments)]
fn execute(
    action: &str,
    fixture: &Fixture,
    destination: &Path,
    temporary: &Path,
    runtime: &Value,
    expected: &Value,
    report_names: &[String],
    environment: &EnvironmentReportOptions,
    spawner: &FakeSpawner,
    post_extraction: Option<&str>,
) -> Result<Value, String> {
    let prepare_options = |environment: EnvironmentReportOptions| PrepareOptions {
        public_key_path: &fixture.key_path,
        archive: Some(&fixture.archive_path),
        destination,
        environment,
    };

    if action == "prepare" {
        let prepared = verify_and_extract_box(&fixture.release_path, &prepare_options(environment.clone()))
            .map_err(|error| error.to_string())?;
        return Ok(json!({
            "outcome": "prepared",
            "receipt": receipt_value(&prepared, expected.get("receipt").unwrap_or(&Value::Null), report_names),
            "$root": prepared.root().to_string_lossy(),
        }));
    }

    if matches!(action, "attach" | "verify-payload") {
        let prepared = verify_and_extract_box(&fixture.release_path, &prepare_options(environment.clone()))
            .map_err(|error| error.to_string())?;
        materialize_asset(&prepared, runtime.get("assetState").and_then(Value::as_str));
        let root = match post_extraction {
            Some(name) => mutate_extracted_root(fixture, name, prepared.root()),
            None => prepared.root().to_path_buf(),
        };
        let attach_options = AttachOptions {
            public_key_path: &fixture.key_path,
            root: &root,
            environment: environment.clone(),
        };
        if action == "attach" {
            let attached = attach_extracted_box(&fixture.release_path, &attach_options)
                .map_err(|error| error.to_string())?;
            return Ok(json!({
                "outcome": "attached",
                "receipt": receipt_value(&attached, expected.get("receipt").unwrap_or(&Value::Null), report_names),
                "$root": attached.root().to_string_lossy(),
            }));
        }
        let verified = verify_extracted_payload(&fixture.release_path, &attach_options)
            .map_err(|error| error.to_string())?;
        let mut result = json!({
            // The Rust type says this structurally rather than in a field, so it is stated here.
            "status": "verified",
            "boxId": verified.box_id,
            "targetId": verified.target_id,
            "entryCount": verified.entry_count,
        });
        if expected
            .get("result")
            .and_then(|result| result.get("environmentReport"))
            .is_some()
        {
            result["environmentReport"] = report_value(&verified.environment_report, report_names);
        }
        return Ok(json!({
            "outcome": "verified",
            "result": result,
            "$root": verified.root.to_string_lossy(),
        }));
    }

    // A case that states a signal needs one delivered, or the fake child never ends: the run loop is
    // the only thing that can forward it, and forwarding is exactly what such a case is about.
    let (sender, receiver) = std::sync::mpsc::channel();
    if let Some(name) = runtime.get("signal").and_then(Value::as_str) {
        let signal = match name {
            "SIGINT" => ForwardedSignal::Interrupt,
            "SIGHUP" => ForwardedSignal::Hangup,
            _ => ForwardedSignal::Terminate,
        };
        sender.send(signal).unwrap();
    }
    let signals = runtime.get("signal").is_some().then_some(&receiver);

    let streams = runtime.get("streams").is_some();
    let stdio = if streams {
        StdioMode::Piped
    } else {
        StdioMode::Null
    };
    let run_options = || RunOptions {
        args: string_list(runtime, "args"),
        env: pairs(runtime.get("env")),
        stdin: stdio,
        stdout: stdio,
        stderr: stdio,
        signals,
        on_environment_report: None,
        environment: environment.clone(),
        host_environment: Some(pairs(runtime.get("hostEnvironment"))),
        spawn: Some(spawner),
    };

    let (result, root) = if action == "run-prepared" {
        let prepared = verify_and_extract_box(&fixture.release_path, &prepare_options(environment.clone()))
            .map_err(|error| error.to_string())?;
        materialize_asset(&prepared, runtime.get("assetState").and_then(Value::as_str));
        let prepared = if runtime.get("attach").is_some() {
            attach_extracted_box(
                &fixture.release_path,
                &AttachOptions {
                    public_key_path: &fixture.key_path,
                    root: prepared.root(),
                    environment: environment.clone(),
                },
            )
            .map_err(|error| error.to_string())?
        } else {
            prepared
        };
        let root = prepared.root().to_path_buf();
        (
            run_extracted_box(&prepared, &run_options()).map_err(|error| error.to_string()),
            root,
        )
    } else if action == "run-box" {
        std::fs::create_dir_all(temporary).map_err(|error| error.to_string())?;
        (
            run_box(
                &fixture.release_path,
                &RunBoxOptions {
                    public_key_path: &fixture.key_path,
                    archive: Some(&fixture.archive_path),
                    temporary_root: temporary,
                    run: run_options(),
                },
            )
            .map_err(|error| error.to_string()),
            temporary.to_path_buf(),
        )
    } else {
        panic!("unknown conformance action: {action}");
    };

    let result = result?;
    let mut value = json!({
        "exitCode": result.exit_code,
        "signal": result.signal,
    });
    if expected
        .get("result")
        .and_then(|result| result.get("environmentReport"))
        .is_some()
    {
        value["environmentReport"] = report_value(&result.environment_report, report_names);
    }
    let mut outcome = json!({ "outcome": "completed", "result": value, "$root": root.to_string_lossy() });
    if expected.get("persistentRootExists").is_some() {
        outcome["persistentRootExists"] = json!(root.exists());
    }
    Ok(outcome)
}

#[test]
fn the_shared_consumer_conformance_suite_passes() {
    let suite: Value = serde_json::from_str(SUITE).unwrap();
    let patterns = suite["errorPatterns"].as_object().unwrap();
    let cases = suite["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 65, "the suite changed size");

    let mut failures: Vec<String> = Vec::new();
    let mut ran = 0usize;
    for case in cases {
        let id = case["id"].as_str().unwrap();
        if case.get("requiresSymlinks").is_some() && cfg!(not(unix)) {
            continue;
        }
        ran += 1;
        let Outcome { actual, expected } = run_case(case, patterns);
        if actual != expected {
            failures.push(format!(
                "{id}\n     expected: {}\n     actual:   {}",
                serde_json::to_string(&expected).unwrap(),
                serde_json::to_string(&actual).unwrap()
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {ran} conformance cases disagree:\n  - {}",
        failures.len(),
        failures.join("\n  - ")
    );
}
