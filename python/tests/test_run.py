from __future__ import annotations

import hashlib
import os
import shlex
import shutil
import signal
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from scrollcase_consumer import (
    EnvironmentReport,
    PreparedBox,
    ScrollcaseConsumerError,
    attach_extracted_box,
    run_box,
    run_extracted_box,
    verify_and_extract_box,
    verify_extracted_payload,
)

from .support import ConsumerFixture, create_fixture


class FakeProcess:
    def __init__(
        self,
        returncode: int = 0,
        *,
        signal_to_raise: signal.Signals | None = None,
    ) -> None:
        self.returncode: int | None = returncode
        self.signal_to_raise = signal_to_raise
        self.sent_signals: list[int] = []

    def wait(self) -> int:
        if self.signal_to_raise is not None:
            handler = signal.getsignal(self.signal_to_raise)
            if callable(handler):
                handler(self.signal_to_raise, None)
            self.returncode = -int(self.signal_to_raise)
        assert self.returncode is not None
        return self.returncode

    def send_signal(self, signal_number: int) -> None:
        self.sent_signals.append(signal_number)


class FakePopen:
    def __init__(
        self,
        returncode: int = 0,
        *,
        error: OSError | None = None,
        signal_to_raise: signal.Signals | None = None,
    ) -> None:
        self.returncode = returncode
        self.error = error
        self.signal_to_raise = signal_to_raise
        self.calls: list[tuple[list[str], dict[str, Any]]] = []
        self.children: list[FakeProcess] = []

    def __call__(self, argv: Any, **options: Any) -> FakeProcess:
        if self.error is not None:
            raise self.error
        child = FakeProcess(
            self.returncode,
            signal_to_raise=self.signal_to_raise,
        )
        self.calls.append((list(argv), options))
        self.children.append(child)
        return child


class ExecutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixtures: list[ConsumerFixture] = []

    def tearDown(self) -> None:
        for fixture in self.fixtures:
            shutil.rmtree(fixture.root, ignore_errors=True)

    def fixture(self, **options: Any) -> ConsumerFixture:
        fixture = create_fixture(**options)
        self.fixtures.append(fixture)
        return fixture

    def prepare(
        self,
        fixture: ConsumerFixture,
        name: str = "prepared",
    ) -> PreparedBox:
        return verify_and_extract_box(
            fixture.release_path,
            public_key_path=fixture.public_key_path,
            archive=fixture.archive_path,
            destination=fixture.root / name,
        )

    def test_preserves_signed_and_caller_arguments_without_a_shell(self) -> None:
        fixture = self.fixture()
        prepared = self.prepare(fixture)
        fake = FakePopen(returncode=23)
        result = run_extracted_box(
            prepared,
            args=("--caller", "$(touch never)", "semi;colon"),
            env={"CONSUMER_FIXTURE": "yes"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            popen_factory=fake,
        )
        self.assertEqual((result.exit_code, result.signal), (23, None))
        argv, options = fake.calls[0]
        self.assertEqual(argv[0], str(Path(prepared.root) / prepared.python_entry_point))
        self.assertEqual(
            argv[1:],
            [
                str(Path(prepared.root) / "app" / "main.py"),
                "--default",
                "value with spaces",
                "--caller",
                "$(touch never)",
                "semi;colon",
            ],
        )
        self.assertFalse(options["shell"])
        self.assertEqual(options["cwd"], prepared.root)
        self.assertEqual(options["env"]["CONSUMER_FIXTURE"], "yes")

    def test_reports_environment_from_verify_attach_and_execution(self) -> None:
        name = "SCROLLCASE_ENV_REPORT_TEST"
        fixture = self.fixture(
            environment={
                name: "release-value",
                "SCROLLCASE_RELEASE_ONLY": "public-value",
            }
        )
        with patch.dict(
            os.environ,
            {name: "host-secret", "PYTHONPATH": "/host/code"},
        ):
            prepared = self.prepare(fixture, "prepared-environment")
            self.assertEqual(prepared.environment_report.mode, "summary")
            self.assertEqual(prepared.environment_report.release_variable_count, 2)
            self.assertIn(
                "PYTHONPATH",
                prepared.environment_report.dangerous_host_variables,
            )
            prepared_variable = next(
                variable
                for variable in prepared.environment_report.variables
                if variable.name == name
            )
            self.assertEqual(prepared_variable.source, "release")
            self.assertEqual(prepared_variable.sources[0].value, "<masked>")

            attached = attach_extracted_box(
                fixture.release_path,
                public_key_path=fixture.public_key_path,
                root=prepared.root,
                env_report=True,
            )
            self.assertEqual(attached.environment_report.mode, "full")
            verified = verify_extracted_payload(
                fixture.release_path,
                public_key_path=fixture.public_key_path,
                root=prepared.root,
                env_report=True,
            )
            self.assertEqual(verified.environment_report.mode, "full")

            reports: list[EnvironmentReport] = []
            fake = FakePopen()
            result = run_extracted_box(
                attached,
                env={name: "caller-value"},
                env_report_values=True,
                on_environment_report=reports.append,
                popen_factory=fake,
            )
            self.assertEqual(fake.calls[0][1]["env"][name], "release-value")
            resolved = next(
                variable
                for variable in result.environment_report.variables
                if variable.name == name
            )
            self.assertEqual(resolved.source, "release")
            self.assertEqual(
                tuple(source.source for source in resolved.sources),
                ("host", "caller", "release"),
            )
            self.assertEqual(resolved.sources[0].value, "host-secret")
            self.assertEqual(reports, [result.environment_report])

    def test_invokes_a_module_with_dash_m_and_preserves_order(self) -> None:
        fixture = self.fixture(
            execution={
                "kind": "python-module",
                "module": "example.application",
                "defaultArgs": ["--signed-default"],
            }
        )
        prepared = self.prepare(fixture)
        fake = FakePopen()
        run_extracted_box(
            prepared,
            args=("--caller",),
            popen_factory=fake,
        )
        self.assertEqual(
            fake.calls[0][0][1:],
            ["-m", "example.application", "--signed-default", "--caller"],
        )

    @unittest.skipIf(os.name == "nt", "POSIX wrapper test")
    def test_executes_the_real_child_and_preserves_metacharacters(self) -> None:
        marker = "actual-run.json"
        interpreter = (
            "#!/bin/sh\n"
            f"exec {shlex.quote(sys.executable)} \"$@\"\n"
        ).encode()
        script = (
            "import json, pathlib, sys\n"
            f"pathlib.Path({marker!r}).write_text(json.dumps(sys.argv[1:]))\n"
            "raise SystemExit(7)\n"
        ).encode()
        fixture = self.fixture(interpreter=interpreter, script=script)
        prepared = self.prepare(fixture)
        result = run_extracted_box(
            prepared,
            args=("--caller", "$(touch never)"),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.assertEqual((result.exit_code, result.signal), (7, None))
        self.assertEqual(
            (Path(prepared.root) / marker).read_text(),
            '["--default", "value with spaces", "--caller", "$(touch never)"]',
        )
        self.assertFalse((Path(prepared.root) / "never").exists())

    def test_verifies_materialized_on_demand_assets_before_spawn(self) -> None:
        data = b"trusted on-demand bytes"
        asset: dict[str, Any] = {
            "url": "https://assets.example.org/weights.bin",
            "relativePath": "model-cache/consumer-fixture/weights.bin",
            "sizeBytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        fixture = self.fixture(required_asset=asset)
        prepared = self.prepare(fixture)
        fake = FakePopen()
        with self.assertRaisesRegex(ScrollcaseConsumerError, "asset is missing"):
            run_extracted_box(prepared, popen_factory=fake)
        asset_path = Path(prepared.root) / str(asset["relativePath"])
        asset_path.parent.mkdir(parents=True)
        asset_path.write_bytes(data[1:])
        with self.assertRaisesRegex(ScrollcaseConsumerError, "asset size mismatch"):
            run_extracted_box(prepared, popen_factory=fake)
        asset_path.write_bytes(b"x" * len(data))
        with self.assertRaisesRegex(ScrollcaseConsumerError, "asset SHA-256 mismatch"):
            run_extracted_box(prepared, popen_factory=fake)
        asset_path.write_bytes(data)
        result = run_extracted_box(prepared, popen_factory=fake)
        self.assertEqual((result.exit_code, result.signal), (0, None))
        self.assertEqual(len(fake.calls), 1)

    def test_rejects_replaced_roots_forged_receipts_and_library_boxes(self) -> None:
        fixture = self.fixture()
        prepared = self.prepare(fixture)
        original = Path(prepared.root).with_name("original")
        Path(prepared.root).rename(original)
        Path(prepared.root).mkdir()
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "no longer matches",
        ):
            run_extracted_box(prepared, popen_factory=FakePopen())

        library_fixture = self.fixture(execution=None)
        library = self.prepare(library_fixture)
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "does not declare an execution",
        ):
            run_extracted_box(library)

    def test_rejects_a_non_native_target_before_spawning(self) -> None:
        if sys.platform == "darwin":
            target = {"platform": "linux", "arch": "x86_64", "accelerator": "cpu"}
        else:
            target = {"platform": "macos", "arch": "aarch64", "accelerator": "cpu"}
        fixture = self.fixture(target=target)
        prepared = self.prepare(fixture)
        fake = FakePopen()
        with self.assertRaisesRegex(ScrollcaseConsumerError, "cannot run on"):
            run_extracted_box(prepared, popen_factory=fake)
        self.assertEqual(fake.calls, [])

    def test_forwards_signals_and_restores_parent_handlers(self) -> None:
        fixture = self.fixture()
        prepared = self.prepare(fixture)
        previous = signal.getsignal(signal.SIGTERM)
        fake = FakePopen(signal_to_raise=signal.SIGTERM)
        result = run_extracted_box(prepared, popen_factory=fake)
        self.assertEqual((result.exit_code, result.signal), (None, "SIGTERM"))
        self.assertEqual(fake.children[0].sent_signals, [signal.SIGTERM])
        self.assertIs(signal.getsignal(signal.SIGTERM), previous)

    def test_one_shot_execution_removes_temporary_bytes_on_all_terminal_paths(self) -> None:
        fixture = self.fixture()
        temporary_parent = fixture.root / "temporary"
        temporary_parent.mkdir()
        prepared_roots: list[str] = []
        result = run_box(
            fixture.release_path,
            public_key_path=fixture.public_key_path,
            archive=fixture.archive_path,
            temporary_directory=temporary_parent,
            on_prepared=lambda prepared: prepared_roots.append(prepared.root),
            popen_factory=FakePopen(returncode=19),
        )
        self.assertEqual((result.exit_code, result.signal), (19, None))
        self.assertFalse(Path(prepared_roots[0]).exists())
        self.assertEqual(list(temporary_parent.iterdir()), [])

        with self.assertRaisesRegex(ScrollcaseConsumerError, "failed to start"):
            run_box(
                fixture.release_path,
                public_key_path=fixture.public_key_path,
                archive=fixture.archive_path,
                temporary_directory=temporary_parent,
                popen_factory=FakePopen(error=OSError("spawn failed")),
            )
        self.assertEqual(list(temporary_parent.iterdir()), [])

        signal_roots: list[str] = []
        result = run_box(
            fixture.release_path,
            public_key_path=fixture.public_key_path,
            archive=fixture.archive_path,
            temporary_directory=temporary_parent,
            on_prepared=lambda prepared: signal_roots.append(prepared.root),
            popen_factory=FakePopen(signal_to_raise=signal.SIGTERM),
        )
        self.assertEqual((result.exit_code, result.signal), (None, "SIGTERM"))
        self.assertFalse(Path(signal_roots[0]).exists())
        self.assertEqual(list(temporary_parent.iterdir()), [])

    @unittest.skipIf(os.name == "nt", "POSIX wrapper test")
    def test_routes_real_standard_streams_through_the_box_interpreter_path(self) -> None:
        interpreter = (
            "#!/bin/sh\n"
            f"exec {shlex.quote(sys.executable)} \"$@\"\n"
        ).encode()
        script = (
            "import sys\n"
            "value = sys.stdin.read()\n"
            "sys.stdout.write('out:' + value)\n"
            "sys.stderr.write('err:' + value)\n"
        ).encode()
        fixture = self.fixture(interpreter=interpreter, script=script)
        prepared = self.prepare(fixture)
        input_path = fixture.root / "stdin.txt"
        output_path = fixture.root / "stdout.txt"
        error_path = fixture.root / "stderr.txt"
        input_path.write_text("payload")
        with (
            input_path.open("rb") as stdin,
            output_path.open("wb") as stdout,
            error_path.open("wb") as stderr,
        ):
            result = run_extracted_box(
                prepared,
                stdin=stdin,
                stdout=stdout,
                stderr=stderr,
            )
        self.assertEqual((result.exit_code, result.signal), (0, None))
        self.assertEqual(output_path.read_text(), "out:payload")
        self.assertEqual(error_path.read_text(), "err:payload")


if __name__ == "__main__":
    unittest.main()
