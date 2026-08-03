from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import signal
import stat
from pathlib import Path
from typing import IO, Any, cast

from scrollcase_consumer import (
    BoxRunResult,
    attach_extracted_box,
    run_box,
    run_extracted_box,
    verify_and_extract_box,
    verify_extracted_payload,
)
from scrollcase_consumer._contract import (
    PAYLOAD_DIGEST_FILE,
    PAYLOAD_DIGEST_FORMAT,
    PayloadDigestEntry,
    payload_digest_stream,
)

from .support import ArchiveEntry, ConsumerFixture, create_fixture, native_target

ASSET_BYTES = b"trusted on-demand bytes"
TARGETS: dict[str, dict[str, str]] = {
    "macos-aarch64-cpu": {
        "platform": "macos",
        "arch": "aarch64",
        "accelerator": "cpu",
    },
    "linux-x86_64-cpu": {
        "platform": "linux",
        "arch": "x86_64",
        "accelerator": "cpu",
    },
    "windows-x86_64-cpu": {
        "platform": "windows",
        "arch": "x86_64",
        "accelerator": "cpu",
    },
}

POST_EXTRACTION_MUTATIONS = {
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
}


class FakeProcess:
    def __init__(
        self,
        return_code: int,
        signal_to_raise: signal.Signals | None,
    ) -> None:
        self.returncode = return_code
        self.signal_to_raise = signal_to_raise
        self.forwarded_signal: str | None = None

    def wait(self) -> int:
        if self.signal_to_raise is not None:
            handler = signal.getsignal(self.signal_to_raise)
            if callable(handler):
                handler(self.signal_to_raise, None)
            self.returncode = -int(self.signal_to_raise)
        return self.returncode

    def send_signal(self, signal_number: int) -> None:
        self.forwarded_signal = signal.Signals(signal_number).name


class FakePopen:
    def __init__(self, runtime: dict[str, Any]) -> None:
        self.runtime = runtime
        self.calls: list[tuple[list[str], dict[str, Any]]] = []
        self.children: list[FakeProcess] = []

    def __call__(self, argv: list[str], **options: Any) -> FakeProcess:
        if self.runtime.get("spawnError"):
            raise OSError("fixture spawn failed")
        signal_name = self.runtime.get("signal")
        child = FakeProcess(
            int(self.runtime.get("exitCode", 0)),
            signal.Signals[signal_name] if isinstance(signal_name, str) else None,
        )
        self.calls.append((argv, options))
        self.children.append(child)
        return child


def load_consumer_conformance_suite() -> dict[str, Any]:
    path = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "contract"
        / "fixtures"
        / "consumer-conformance.json"
    )
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


def _fixture_options(spec: dict[str, Any]) -> dict[str, Any]:
    target_name = spec.get("target")
    if target_name == "foreign":
        native = native_target()
        native_id = "-".join(
            (native["platform"], native["arch"], native["accelerator"])
        )
        target = next(target for name, target in TARGETS.items() if name != native_id)
    elif isinstance(target_name, str):
        target = TARGETS[target_name]
    else:
        target = native_target()
    options: dict[str, Any] = {
        "target": target,
        "payload_digest": spec.get("payloadDigest", True),
    }
    if spec.get("execution") == "module":
        options["execution"] = {
            "kind": "python-module",
            "module": "example.application",
            "defaultArgs": ["--default"],
        }
    if spec.get("requiredAsset"):
        options["required_asset"] = {
            "url": "https://assets.example.org/weights.bin",
            "relativePath": "model-cache/consumer-fixture/weights.bin",
            "sizeBytes": len(ASSET_BYTES),
            "sha256": hashlib.sha256(ASSET_BYTES).hexdigest(),
        }
    # A consumer cannot observe key custody. The external-signer case therefore uses the same
    # signed-envelope wire contract with an independently generated caller trust anchor.
    return options


def _refresh_payload_digest(
    fixture: ConsumerFixture,
    entries: list[ArchiveEntry],
) -> list[ArchiveEntry]:
    payload_entries = [
        entry for entry in entries if entry.path != PAYLOAD_DIGEST_FILE
    ]
    stream = payload_digest_stream(
        PayloadDigestEntry(
            path=entry.path,
            kind="link" if entry.file_type == stat.S_IFLNK else "file",
            content_sha256=hashlib.sha256(entry.data).hexdigest(),
        )
        for entry in payload_entries
    )
    fixture.release["payloadDigest"] = {
        "format": PAYLOAD_DIGEST_FORMAT,
        "sha256": hashlib.sha256(stream).hexdigest(),
    }
    return [*payload_entries, ArchiveEntry(PAYLOAD_DIGEST_FILE, stream)]


def _mutate_fixture(
    fixture: ConsumerFixture,
    mutation: str | None,
    destination: Path,
) -> None:
    if mutation is None:
        return
    if mutation in ("alter-signature", "alter-payload"):
        signed = json.loads(fixture.release_path.read_text(encoding="utf-8"))
        if mutation == "alter-signature":
            signed["signatures"][0]["signatureBase64"] = "AA=="
        else:
            import base64

            signed["payloadBase64"] = base64.b64encode(b"altered payload").decode()
        fixture.release_path.write_text(
            json.dumps(signed, indent=2) + "\n",
            encoding="utf-8",
        )
        return
    if mutation == "alter-archive-bytes":
        data = bytearray(fixture.archive_path.read_bytes())
        data[-1] ^= 0x01
        fixture.archive_path.write_bytes(data)
        return
    if mutation == "alter-archive-size":
        fixture.release["archive"]["sizeBytes"] += 1
        fixture.sign()
        return
    if mutation == "alter-release-model":
        fixture.release["modelId"] = "altered-model"
        fixture.sign()
        return
    if mutation == "alter-release-execution":
        fixture.release["execution"] = {
            **fixture.release["execution"],
            "defaultArgs": ["--altered"],
        }
        fixture.sign()
        return
    if mutation == "create-destination":
        destination.mkdir()
        return
    remove_path = {
        "remove-interpreter": fixture.release["pythonEntryPoint"],
        "remove-script": fixture.release.get("execution", {}).get("script"),
        "remove-module": (
            fixture.release.get("execution", {}).get("module", "").replace(".", "/")
            + ".py"
        ),
    }.get(mutation)
    if remove_path:
        fixture.write_archive(
            [entry for entry in fixture.entries if entry.path != remove_path]
        )
        return
    # The other side of the link rule. A real box reaches its interpreter through exactly this
    # shape — `venv/bin/python` is a link to the versioned binary beside it — so a consumer that
    # only accepts regular files here rejects every box the builder produces on macOS and Linux.
    if mutation == "link-interpreter":
        entry_point = cast(str, fixture.release["pythonEntryPoint"])
        directory, _, name = entry_point.rpartition("/")
        link_target = f"{name}-real"
        renamed = f"{directory}/{link_target}" if directory else link_target
        entries = [
            ArchiveEntry(renamed, entry.data, entry.mode, entry.file_type)
            if entry.path == entry_point
            else entry
            for entry in fixture.entries
        ]
        entries.append(
            ArchiveEntry(
                entry_point,
                link_target.encode(),
                file_type=stat.S_IFLNK,
            )
        )
        entries = _refresh_payload_digest(fixture, entries)
        # A link is sized by its target string once extracted, which is exactly the entry's own
        # bytes here. Stated rather than copied from the result, so the signed size is still earned.
        fixture.release["installedSizeBytes"] = sum(
            len(entry.data) for entry in entries
        )
        fixture.entries = entries
        fixture.write_archive(entries)
        return
    hostile: dict[str, ArchiveEntry] = {
        "add-traversal-entry": ArchiveEntry("../x", b"hostile"),
        "add-absolute-entry": ArchiveEntry("/abs", b"hostile"),
        # A link whose target climbs out of the payload: the escape the rule exists to stop.
        "add-link-entry": ArchiveEntry(
            "link",
            b"../../../../etc/passwd",
            file_type=stat.S_IFLNK,
        ),
        "add-special-entry": ArchiveEntry(
            "fifo",
            b"",
            file_type=stat.S_IFIFO,
        ),
        "duplicate-entry": ArchiveEntry("box.json", b"{}"),
        "file-directory-collision": ArchiveEntry("venv", b"collision"),
    }
    if mutation in hostile:
        fixture.write_archive([*fixture.entries, hostile[mutation]])
        return
    if mutation == "encrypt-entry":
        fixture.write_archive(encrypted=True)
        return
    raise AssertionError(f"Unknown conformance mutation: {mutation}")


def _mutate_extracted_root(
    fixture: ConsumerFixture,
    mutation: str | None,
    root: Path,
) -> Path:
    if mutation is None:
        return root
    if mutation == "attach-missing-root":
        return fixture.root / "missing-root"
    if mutation == "attach-file-root":
        return fixture.archive_path
    if mutation == "attach-symlink-root":
        linked_root = fixture.root / "linked-root"
        linked_root.symlink_to(root, target_is_directory=True)
        return linked_root
    if mutation == "add-root-files":
        (root / "output.log").write_bytes(b"application output")
        (root / "__pycache__").mkdir()
        (root / "__pycache__" / "cached.pyc").write_bytes(b"compiled")
        return root
    script = root / "app" / "main.py"
    if mutation == "chmod-script":
        script.chmod(0o600)
        return root
    if mutation == "touch-script":
        os.utime(script, (0, 0))
        return root
    if mutation == "tamper-script":
        script.write_bytes(script.read_bytes() + b" ")
        return root
    if mutation == "remove-interpreter":
        (root / fixture.release["pythonEntryPoint"]).unlink()
        return root
    if mutation == "remove-script":
        (root / fixture.release["execution"]["script"]).unlink()
        return root
    if mutation == "retarget-interpreter-link":
        interpreter = root / fixture.release["pythonEntryPoint"]
        target = os.readlink(interpreter)
        interpreter.unlink()
        interpreter.symlink_to(f"{target}-retargeted")
        return root
    list_path = root / PAYLOAD_DIGEST_FILE
    if mutation == "remove-payload-digest-list":
        list_path.unlink()
        return root
    if mutation == "tamper-payload-digest-list":
        data = bytearray(list_path.read_bytes())
        data[-2] ^= 0x01
        list_path.write_bytes(data)
        return root
    raise AssertionError(f"Unknown extracted-root mutation: {mutation}")


def _replace_tokens(value: Any, root: str | None = None) -> Any:
    if isinstance(value, str):
        target = native_target()
        native_python = (
            "venv/python.exe"
            if target["platform"] == "windows"
            else "venv/bin/python"
        )
        native_id = "-".join(
            (target["platform"], target["arch"], target["accelerator"])
        )
        return (
            value.replace("$NATIVE_PYTHON", native_python)
            .replace("$NATIVE_TARGET", native_id)
            .replace("$BOX", root or "$BOX")
        )
    if isinstance(value, list):
        return [_replace_tokens(item, root) for item in value]
    if isinstance(value, dict):
        return {key: _replace_tokens(item, root) for key, item in value.items()}
    return value


def _classify_error(message: str, patterns: dict[str, str]) -> str:
    import re

    for code, pattern in patterns.items():
        if re.search(pattern, message, re.IGNORECASE):
            return code
    return f"unclassified: {message}"


def _normalize_path(root: Path, value: str) -> str:
    path = Path(value)
    if not path.is_absolute() or not path.is_relative_to(root):
        return value
    relative = path.relative_to(root).as_posix()
    return f"$BOX/{relative}" if relative not in ("", ".") else "$BOX"


def _materialize_asset(prepared: Any, state: str | None) -> None:
    if state in (None, "missing"):
        return
    asset = prepared.required_assets[0]
    path = Path(prepared.root) / asset.relative_path
    path.parent.mkdir(parents=True)
    if state == "wrong-size":
        path.write_bytes(ASSET_BYTES[1:])
    elif state == "wrong-hash":
        path.write_bytes(b"x" * len(ASSET_BYTES))
    else:
        path.write_bytes(ASSET_BYTES)


def run_python_conformance_case(
    test_case: dict[str, Any],
    suite: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], Path]:
    fixture = create_fixture(**_fixture_options(test_case.get("fixture", {})))
    destination = fixture.root / "prepared"
    temporary_directory = fixture.root / "temporary"
    expected = _replace_tokens(test_case["expected"])
    fake: FakePopen | None = None
    prepared: Any = None
    streams: dict[str, IO[Any]] | None = None
    actual: dict[str, Any]
    try:
        action = test_case["action"]
        mutation = test_case.get("mutation")
        if test_case.get("fixture", {}).get("linkedInterpreter"):
            _mutate_fixture(fixture, "link-interpreter", destination)
        post_extraction_mutation = (
            action in ("attach", "verify-payload")
            and mutation in POST_EXTRACTION_MUTATIONS
        )
        if not post_extraction_mutation:
            _mutate_fixture(fixture, mutation, destination)
        if test_case["action"] == "prepare":
            prepared = verify_and_extract_box(
                fixture.release_path,
                public_key_path=fixture.public_key_path,
                archive=fixture.archive_path,
                destination=destination,
            )
            execution = prepared.execution
            actual = {
                "outcome": "prepared",
                "receipt": {
                    "status": prepared.status,
                    "boxId": prepared.box_id,
                    "executionKind": execution.kind if execution is not None else None,
                    "requiredAssetCount": len(prepared.required_assets),
                    "pythonEntryPoint": prepared.python_entry_point,
                    "targetId": prepared.target_id,
                },
            }
            return actual, expected, fixture.root

        if action in ("attach", "verify-payload"):
            prepared = verify_and_extract_box(
                fixture.release_path,
                public_key_path=fixture.public_key_path,
                archive=fixture.archive_path,
                destination=destination,
            )
            runtime = test_case.get("runtime", {})
            _materialize_asset(prepared, runtime.get("assetState"))
            root = _mutate_extracted_root(
                fixture,
                mutation if post_extraction_mutation else None,
                Path(prepared.root),
            )
            if action == "attach":
                attached = attach_extracted_box(
                    fixture.release_path,
                    public_key_path=fixture.public_key_path,
                    root=root,
                )
                execution = attached.execution
                actual = {
                    "outcome": "attached",
                    "receipt": {
                        "status": attached.status,
                        "boxId": attached.box_id,
                        "executionKind": (
                            execution.kind if execution is not None else None
                        ),
                        "requiredAssetCount": len(attached.required_assets),
                        "pythonEntryPoint": attached.python_entry_point,
                        "targetId": attached.target_id,
                    },
                }
                return actual, expected, fixture.root
            verified = verify_extracted_payload(
                fixture.release_path,
                public_key_path=fixture.public_key_path,
                root=root,
            )
            actual = {
                "outcome": "verified",
                "result": {
                    "status": verified.status,
                    "boxId": verified.box_id,
                    "targetId": verified.target_id,
                    "entryCount": verified.entry_count,
                },
            }
            return actual, expected, fixture.root

        runtime = test_case.get("runtime", {})
        fake = FakePopen(runtime)
        if runtime.get("streams"):
            streams = {
                "stdin": io.BytesIO(),
                "stdout": io.BytesIO(),
                "stderr": io.BytesIO(),
            }
        stdin = streams["stdin"] if streams is not None else None
        stdout = streams["stdout"] if streams is not None else None
        stderr = streams["stderr"] if streams is not None else None
        if action == "run-prepared":
            prepared = verify_and_extract_box(
                fixture.release_path,
                public_key_path=fixture.public_key_path,
                archive=fixture.archive_path,
                destination=destination,
            )
            _materialize_asset(prepared, runtime.get("assetState"))
            if runtime.get("attach"):
                prepared = attach_extracted_box(
                    fixture.release_path,
                    public_key_path=fixture.public_key_path,
                    root=prepared.root,
                )
            result = run_extracted_box(
                prepared,
                args=runtime.get("args", ()),
                stdin=stdin,
                stdout=stdout,
                stderr=stderr,
                popen_factory=cast(Any, fake),
            )
        elif action == "run-box":
            temporary_directory.mkdir()
            result = run_box(
                fixture.release_path,
                public_key_path=fixture.public_key_path,
                archive=fixture.archive_path,
                temporary_directory=temporary_directory,
                args=runtime.get("args", ()),
                stdin=stdin,
                stdout=stdout,
                stderr=stderr,
                popen_factory=cast(Any, fake),
            )
        else:
            raise AssertionError(f"Unknown conformance action: {action}")
        actual = {
            "outcome": "completed",
            "result": {
                "exitCode": result.exit_code,
                "signal": result.signal,
            },
        }
        if "persistentRootExists" in expected:
            actual["persistentRootExists"] = Path(prepared.root).exists()
        if "spawned" in expected:
            actual["spawned"] = bool(fake.calls)
        if "temporaryDirectoryEmpty" in expected:
            actual["temporaryDirectoryEmpty"] = not any(
                temporary_directory.iterdir()
            )
        if "forwardedSignal" in expected:
            actual["forwardedSignal"] = fake.children[0].forwarded_signal
        if "streamsPreserved" in expected:
            options = fake.calls[0][1]
            assert streams is not None
            actual["streamsPreserved"] = all(
                options[name] is streams[name]
                for name in ("stdin", "stdout", "stderr")
            )
        if "argv" in expected:
            argv, options = fake.calls[0]
            root = Path(prepared.root)
            actual["argv"] = [_normalize_path(root, value) for value in argv]
            actual["cwd"] = _normalize_path(root, options["cwd"])
            actual["shell"] = options["shell"]
        return actual, expected, fixture.root
    except Exception as error:
        actual = {
            "outcome": "rejected",
            "error": _classify_error(str(error), suite["errorPatterns"]),
        }
        if "destinationExists" in expected:
            actual["destinationExists"] = destination.exists()
        if "spawned" in expected:
            actual["spawned"] = bool(fake and fake.calls)
        if "temporaryDirectoryEmpty" in expected:
            actual["temporaryDirectoryEmpty"] = (
                temporary_directory.exists()
                and not any(temporary_directory.iterdir())
            )
        return actual, expected, fixture.root


def remove_conformance_root(root: Path) -> None:
    shutil.rmtree(root, ignore_errors=True)
