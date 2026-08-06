from __future__ import annotations

import json
import os
import shutil
import stat
import sys
import unittest
from pathlib import Path

from scrollcase_consumer import (
    PayloadVerification,
    PreparedBox,
    ScrollcaseConsumerError,
    attach_extracted_box,
    parse_trusted_keys,
    verify_and_extract_box,
    verify_extracted_payload,
)
from scrollcase_consumer._contract import PAYLOAD_DIGEST_FILE

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

    @unittest.skipIf(sys.platform == "win32", "symbolic links need elevation on Windows")
    def test_refuses_a_destination_that_is_a_dangling_symlink(self) -> None:
        # A caller-supplied path is made absolute lexically, never resolved. Resolving would follow
        # this broken link to a name the caller never asked for, find nothing there, and install
        # into it — which is exactly what the Node consumer refuses, and the two may not disagree.
        destination = self.fixture.root / "dangling"
        destination.symlink_to(self.fixture.root / "nowhere")
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "Destination already exists",
        ):
            self.prepare("dangling")
        self.assertFalse((self.fixture.root / "nowhere").exists())

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

    def test_rejects_a_payload_digest_this_implementation_cannot_read(self) -> None:
        # A release naming a format this build does not implement is refused outright, by the
        # schema's `const`, rather than treated as a box carrying no commitment at all — which is
        # what a permissive read would silently downgrade it to.
        self.fixture.release["payloadDigest"] = {
            "format": "sha256-path-list-v2",
            "sha256": "f" * 64,
        }
        self.fixture.sign()
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            "Invalid release manifest: /payloadDigest/format",
        ):
            self.prepare("future-digest")

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


class ReattachmentTests(unittest.TestCase):
    """Running a box installed by an earlier process, without its archive."""

    def setUp(self) -> None:
        self.fixture = create_fixture()
        self.addCleanup(shutil.rmtree, self.fixture.root, ignore_errors=True)
        self.root = self.fixture.root / "installed"
        verify_and_extract_box(
            self.fixture.release_path,
            public_key_path=self.fixture.public_key_path,
            archive=self.fixture.archive_path,
            destination=self.root,
        )

    def attach(self, root: Path | None = None) -> PreparedBox:
        return attach_extracted_box(
            self.fixture.release_path,
            public_key_path=self.fixture.public_key_path,
            root=self.root if root is None else root,
        )

    def test_accepts_keys_the_caller_already_holds(self) -> None:
        # What an application reads out of a keyring or an environment variable. Parsed by the
        # package rather than at the call site, so both trust sources read the shapes identically.
        keys = parse_trusted_keys(Path(self.fixture.public_key_path).read_text("utf8"))

        attached = attach_extracted_box(
            self.fixture.release_path, trusted_keys=keys, root=self.root
        )
        self.assertEqual(attached.status, "attached")
        self.assertEqual(attached.box_id, "consumer-fixture")

        # Genuinely checking, not waving the box through because no file was named.
        stranger = [{**keys[0], "keyId": "someone-else"}]
        with self.assertRaisesRegex(ScrollcaseConsumerError, "no valid signature"):
            attach_extracted_box(
                self.fixture.release_path, trusted_keys=stranger, root=self.root
            )

        # Naming both sources is a caller that has not decided; naming neither is unverifiable.
        with self.assertRaisesRegex(ScrollcaseConsumerError, "not both"):
            attach_extracted_box(
                self.fixture.release_path,
                public_key_path=self.fixture.public_key_path,
                trusted_keys=keys,
                root=self.root,
            )
        with self.assertRaisesRegex(ScrollcaseConsumerError, "are required"):
            attach_extracted_box(self.fixture.release_path, root=self.root)

    def test_mints_a_receipt_marked_for_what_it_did_not_check(self) -> None:
        attached = self.attach()
        self.assertEqual(attached.status, "attached")
        self.assertEqual(attached.root, os.path.abspath(self.root))
        self.assertEqual(attached.box_id, "consumer-fixture")
        self.assertEqual(attached.version, "2.0.0")
        self.assertEqual(attached.archive_sha256, self.fixture.release["archive"]["sha256"])

    def test_ignores_whatever_appeared_after_installation(self) -> None:
        (self.root / "output.log").write_bytes(b"the application wrote this")
        (self.root / "__pycache__").mkdir()
        (self.root / "__pycache__" / "x.pyc").write_bytes(b"compiled")
        self.assertEqual(self.attach().status, "attached")

    def test_refuses_a_root_that_is_missing_a_file_or_a_link(self) -> None:
        with self.assertRaisesRegex(
            ScrollcaseConsumerError, "is not an extracted box directory"
        ):
            self.attach(self.fixture.root / "nope")
        with self.assertRaisesRegex(
            ScrollcaseConsumerError, "is not an extracted box directory"
        ):
            self.attach(self.fixture.archive_path)
        if sys.platform != "win32":
            # A link satisfies a naive directory check and is then refused by execution, leaving
            # the caller holding a receipt that can never run.
            link = self.fixture.root / "linked"
            link.symlink_to(self.root)
            with self.assertRaisesRegex(
                ScrollcaseConsumerError, "is not an extracted box directory"
            ):
                self.attach(link)

    def test_refuses_a_directory_that_is_not_the_box_described(self) -> None:
        (self.root / "app" / "main.py").unlink()
        with self.assertRaisesRegex(ScrollcaseConsumerError, "Execution script is missing"):
            self.attach()

        bare = self.fixture.root / "bare"
        bare.mkdir()
        with self.assertRaisesRegex(ScrollcaseConsumerError, "Attached box is missing"):
            self.attach(bare)


class PayloadVerificationTests(unittest.TestCase):
    """Proving an installed tree against the list its release commits to."""

    def setUp(self) -> None:
        self.fixture = create_fixture()
        self.addCleanup(shutil.rmtree, self.fixture.root, ignore_errors=True)
        self.root = self.fixture.root / "installed"
        verify_and_extract_box(
            self.fixture.release_path,
            public_key_path=self.fixture.public_key_path,
            archive=self.fixture.archive_path,
            destination=self.root,
        )

    def verify(self) -> PayloadVerification:
        return verify_extracted_payload(
            self.fixture.release_path,
            public_key_path=self.fixture.public_key_path,
            root=self.root,
        )

    def test_walks_the_signed_list_and_reports_what_it_checked(self) -> None:
        verified = self.verify()
        self.assertEqual(verified.status, "verified")
        self.assertEqual(verified.box_id, "consumer-fixture")
        self.assertGreater(verified.entry_count, 0)

    def test_walks_the_list_and_not_the_directory(self) -> None:
        # Everything an installed box legitimately grows: the application's own output in its
        # working directory, Python's caches, and a model cache filled after extraction.
        (self.root / "output.log").write_bytes(b"the application wrote this")
        (self.root / "model-cache").mkdir(parents=True, exist_ok=True)
        (self.root / "model-cache" / "weights.bin").write_bytes(b"downloaded later")
        (self.root / "__pycache__").mkdir()
        (self.root / "__pycache__" / "x.pyc").write_bytes(b"compiled")
        self.assertEqual(self.verify().status, "verified")

    def test_ignores_a_changed_mode_and_timestamp(self) -> None:
        script = self.root / "app" / "main.py"
        script.chmod(0o600)
        os.utime(script, (0, 0))
        self.assertEqual(self.verify().status, "verified")

    def test_names_the_entry_that_no_longer_matches(self) -> None:
        script = self.root / "app" / "main.py"
        script.write_bytes(script.read_bytes() + b" ")
        with self.assertRaisesRegex(
            ScrollcaseConsumerError,
            r"Payload does not match the signed release: app/main\.py",
        ):
            self.verify()

        script.unlink()
        with self.assertRaisesRegex(ScrollcaseConsumerError, r"app/main\.py is missing"):
            self.verify()

    def test_refuses_a_list_that_is_altered_or_absent(self) -> None:
        list_path = self.root / PAYLOAD_DIGEST_FILE
        list_path.write_bytes(list_path.read_bytes().replace(b"box.json", b"box.jsoX"))
        with self.assertRaisesRegex(
            ScrollcaseConsumerError, "Payload digest list does not match the signed release"
        ):
            self.verify()

        list_path.unlink()
        with self.assertRaisesRegex(
            ScrollcaseConsumerError, "missing its payload digest list"
        ):
            self.verify()

    def test_refuses_a_release_that_commits_to_nothing(self) -> None:
        fixture = create_fixture(payload_digest=False)
        self.addCleanup(shutil.rmtree, fixture.root, ignore_errors=True)
        root = fixture.root / "installed"
        verify_and_extract_box(
            fixture.release_path,
            public_key_path=fixture.public_key_path,
            archive=fixture.archive_path,
            destination=root,
        )
        with self.assertRaisesRegex(
            ScrollcaseConsumerError, "does not commit to a payload digest"
        ):
            verify_extracted_payload(
                fixture.release_path,
                public_key_path=fixture.public_key_path,
                root=root,
            )


if __name__ == "__main__":
    unittest.main()
