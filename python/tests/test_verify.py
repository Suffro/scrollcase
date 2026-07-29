from __future__ import annotations

import json
import shutil
import stat
import unittest
from pathlib import Path

from scrollcase_consumer import (
    PreparedBox,
    ScrollcaseConsumerError,
    verify_and_extract_box,
)

from .support import ArchiveEntry, create_fixture


class VerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = create_fixture()

    def tearDown(self) -> None:
        shutil.rmtree(self.fixture.root, ignore_errors=True)

    def prepare(self, name: str = "prepared") -> PreparedBox:
        return verify_and_extract_box(
            self.fixture.release_path,
            public_key_path=self.fixture.public_key_path,
            archive=self.fixture.archive_path,
            destination=self.fixture.root / name,
        )

    def test_verifies_extracts_and_returns_an_immutable_typed_receipt(self) -> None:
        prepared = self.prepare()
        self.assertEqual(prepared.status, "prepared")
        self.assertEqual(prepared.box_id, "consumer-fixture")
        self.assertEqual(prepared.target_id.split("-")[0], prepared.target.platform)
        self.assertEqual(prepared.required_assets, ())
        self.assertEqual(
            prepared.archive_sha256,
            self.fixture.release["archive"]["sha256"],
        )
        self.assertEqual(
            json.loads((Path(prepared.root) / "box.json").read_text())["boxId"],
            "consumer-fixture",
        )
        self.assertFalse(
            any(
                path.name.startswith(".scrollcase-prepare-")
                for path in self.fixture.root.iterdir()
            )
        )
        with self.assertRaisesRegex(Exception, "cannot assign"):
            prepared.box_id = "altered"  # type: ignore[misc]

    def test_refuses_an_existing_destination_without_altering_it(self) -> None:
        destination = self.fixture.root / "existing"
        destination.mkdir()
        marker = destination / "marker"
        marker.write_text("keep")
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "Destination already exists",
        ):
            self.prepare("existing")
        self.assertEqual(marker.read_text(), "keep")

    def test_rejects_v1_and_invalid_signatures_before_extraction(self) -> None:
        self.fixture.release_path.write_text('{"schemaVersion": 1}\n')
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "Unsupported schemaVersion 1",
        ):
            self.prepare("v1")
        self.fixture.sign()
        signed = json.loads(self.fixture.release_path.read_text())
        signed["signatures"][0]["signatureBase64"] = "AA=="
        self.fixture.release_path.write_text(json.dumps(signed))
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "no valid signature",
        ):
            self.prepare("bad-signature")
        self.assertFalse((self.fixture.root / "bad-signature").exists())

    def test_rejects_archive_identity_and_manifest_disagreement(self) -> None:
        data = bytearray(self.fixture.archive_path.read_bytes())
        data[-1] ^= 0x01
        self.fixture.archive_path.write_bytes(data)
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "SHA-256 mismatch",
        ):
            self.prepare("hash")

        self.fixture.write_archive()
        self.fixture.release["execution"]["script"] = "other.py"
        self.fixture.sign()
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "box.json mismatch: execution",
        ):
            self.prepare("agreement")

    def test_rejects_missing_interpreters_and_execution_files(self) -> None:
        without_interpreter = [
            entry
            for entry in self.fixture.entries
            if entry.path != self.fixture.release["pythonEntryPoint"]
        ]
        self.fixture.write_archive(without_interpreter)
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "Archive is missing venv/",
        ):
            self.prepare("interpreter")

        without_script = [
            entry
            for entry in self.fixture.entries
            if entry.path != self.fixture.release["execution"]["script"]
        ]
        self.fixture.write_archive(without_script)
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "Execution script is missing",
        ):
            self.prepare("script")

    def test_prepares_all_three_interpreter_layouts_without_executing_them(self) -> None:
        targets = (
            {"platform": "macos", "arch": "aarch64", "accelerator": "cpu"},
            {"platform": "linux", "arch": "x86_64", "accelerator": "cpu"},
            {"platform": "windows", "arch": "x86_64", "accelerator": "cpu"},
        )
        extra_fixtures = []
        try:
            for target in targets:
                fixture = create_fixture(target=target)
                extra_fixtures.append(fixture)
                prepared = verify_and_extract_box(
                    fixture.release_path,
                    public_key_path=fixture.public_key_path,
                    archive=fixture.archive_path,
                    destination=fixture.root / "prepared",
                )
                expected = (
                    "venv/python.exe"
                    if target["platform"] == "windows"
                    else "venv/bin/python"
                )
                self.assertEqual(prepared.python_entry_point, expected)
        finally:
            for fixture in extra_fixtures:
                shutil.rmtree(fixture.root, ignore_errors=True)

    def test_rejects_wrong_installed_size_and_removes_staging(self) -> None:
        self.fixture.release["installedSizeBytes"] += 1
        self.fixture.sign()
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "Extracted payload size",
        ):
            self.prepare("size")
        self.assertFalse((self.fixture.root / "size").exists())
        self.assertFalse(
            any(
                path.name.startswith(".scrollcase-prepare-")
                for path in self.fixture.root.iterdir()
            )
        )

    def test_rejects_hostile_zip_entry_types_paths_and_collisions(self) -> None:
        hostile = [
            ("traversal", ArchiveEntry("../escape", b"x")),
            ("absolute", ArchiveEntry("/absolute", b"x")),
            (
                "link",
                ArchiveEntry(
                    "link",
                    b"box.json",
                    file_type=stat.S_IFLNK,
                ),
            ),
            (
                "special",
                ArchiveEntry("fifo", b"", file_type=stat.S_IFIFO),
            ),
            ("duplicate", ArchiveEntry("box.json", b"{}")),
        ]
        for label, entry in hostile:
            with self.subTest(label=label):
                self.fixture.write_archive([*self.fixture.entries, entry])
                with self.assertRaises(ScrollcaseConsumerError):
                    self.prepare(label)
                self.assertFalse((self.fixture.root / label).exists())

        self.fixture.write_archive(encrypted=True)
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "Encrypted ZIP entries",
        ):
            self.prepare("encrypted")


if __name__ == "__main__":
    unittest.main()
