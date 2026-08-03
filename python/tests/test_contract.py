from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from importlib.resources import files
from pathlib import Path
from typing import Any, cast

from scrollcase_consumer._contract import (
    PAYLOAD_DIGEST_FILE,
    PAYLOAD_DIGEST_FORMAT,
    SCHEMA_FILES,
    PayloadDigestEntry,
    absolute_path,
    parse_payload_digest_stream,
    payload_digest_stream,
    target_from_json,
    target_id,
)
from scrollcase_consumer.errors import ScrollcaseConsumerError
from scrollcase_consumer.extract import payload_digest


class ContractMirrorTests(unittest.TestCase):
    def test_matches_every_canonical_target_id_fixture(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        fixture = cast(
            dict[str, list[dict[str, Any]]],
            json.loads(
                (
                    repo_root
                    / "src"
                    / "contract"
                    / "fixtures"
                    / "target-id-contract.json"
                ).read_text(encoding="utf-8")
            ),
        )
        for case in fixture["valid"]:
            with self.subTest(case=case):
                self.assertEqual(
                    target_id(target_from_json(case["target"])),
                    case["targetId"],
                )

    def test_bundled_schemas_are_exact_generated_copies(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        bundled = files("scrollcase_consumer.schemas")
        for name in SCHEMA_FILES:
            with self.subTest(name=name):
                self.assertEqual(
                    bundled.joinpath(name).read_bytes(),
                    (repo_root / "src" / "contract" / "schema" / name).read_bytes(),
                )
        result = subprocess.run(
            [sys.executable, "scripts/sync_schemas.py", "--check"],
            cwd=repo_root / "python",
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


class PayloadDigestContractTests(unittest.TestCase):
    """The Python half of the canonical entry list, against the shared vectors.

    These drive `src/contract/fixtures/payload-digest-contract.json`, the same file
    `tests/unit/contract-payload-digest.test.mjs` drives. Without it the two implementations would
    only ever be proven to agree with themselves — and this suite in particular builds its archives
    from an in-memory entry list, so it never has a payload directory to compare against.
    """

    @staticmethod
    def _load() -> dict[str, Any]:
        repo_root = Path(__file__).resolve().parents[2]
        return cast(
            dict[str, Any],
            json.loads(
                (
                    repo_root
                    / "src"
                    / "contract"
                    / "fixtures"
                    / "payload-digest-contract.json"
                ).read_text(encoding="utf-8")
            ),
        )

    @staticmethod
    def _entries(case: dict[str, Any]) -> list[PayloadDigestEntry]:
        # Deriving the content digest here, rather than reading it from the fixture, is what pins
        # the rule that a link is hashed by its target string and never opened.
        described = []
        for entry in case["entries"]:
            content = (
                hashlib.sha256(entry["linkTarget"].encode("utf-8")).hexdigest()
                if entry["kind"] == "link"
                else hashlib.sha256(base64.b64decode(entry["contentBase64"])).hexdigest()
            )
            described.append(
                PayloadDigestEntry(
                    path=entry["path"], kind=entry["kind"], content_sha256=content
                )
            )
        return described

    def test_reproduces_every_canonical_stream_and_digest(self) -> None:
        fixture = self._load()
        self.assertEqual(fixture["format"], PAYLOAD_DIGEST_FORMAT)
        for case in fixture["cases"]:
            with self.subTest(case=case["name"]):
                stream = payload_digest_stream(self._entries(case))
                self.assertEqual(base64.b64encode(stream).decode("ascii"), case["streamBase64"])
                self.assertEqual(hashlib.sha256(stream).hexdigest(), case["sha256"])

    def test_round_trips_every_vector_back_to_its_entries(self) -> None:
        for case in self._load()["cases"]:
            with self.subTest(case=case["name"]):
                entries = self._entries(case)
                parsed = parse_payload_digest_stream(payload_digest_stream(entries))
                self.assertEqual(
                    parsed, sorted(entries, key=lambda entry: entry.path.encode("utf-8"))
                )

    def test_refuses_streams_a_serialiser_could_not_have_produced(self) -> None:
        digest = hashlib.sha256(b"a").hexdigest()
        one = payload_digest_stream(
            [PayloadDigestEntry(path="x", kind="file", content_sha256=digest)]
        )
        header_length = len(PAYLOAD_DIGEST_FORMAT) + 1

        with self.assertRaisesRegex(ScrollcaseConsumerError, "expected format header"):
            parse_payload_digest_stream(b"sha256-path-list-v2\n")
        with self.assertRaisesRegex(
            ScrollcaseConsumerError, "ends inside a record|malformed record"
        ):
            parse_payload_digest_stream(one[:-1])
        with self.assertRaisesRegex(ScrollcaseConsumerError, "malformed record"):
            parse_payload_digest_stream(one[:-1] + b" ")
        # Accepting a re-ordered or repeated list would let two streams describe one tree, and the
        # signed hash is over the stream.
        with self.assertRaisesRegex(ScrollcaseConsumerError, "canonical order|twice"):
            parse_payload_digest_stream(one + one[header_length:])

    def test_refuses_entries_a_payload_could_not_hold(self) -> None:
        digest = hashlib.sha256(b"a").hexdigest()
        for kind, path, content, expected in (
            ("directory", "x", digest, "Unsupported payload entry kind"),
            ("file", "x\0y", digest, "Unsupported payload entry path"),
            ("file", "x", "not-a-digest", "Invalid payload entry digest"),
            # Upper-case hex is a different string for the same value; one spelling keeps two
            # implementations from producing two digests for one tree.
            ("file", "x", digest.upper(), "Invalid payload entry digest"),
        ):
            with self.subTest(kind=kind, path=path):
                with self.assertRaisesRegex(ScrollcaseConsumerError, expected):
                    payload_digest_stream(
                        [PayloadDigestEntry(path=path, kind=kind, content_sha256=content)]
                    )
        with self.assertRaisesRegex(ScrollcaseConsumerError, "Duplicate payload entry"):
            payload_digest_stream(
                [
                    PayloadDigestEntry(path="x", kind="file", content_sha256=digest),
                    PayloadDigestEntry(path="x", kind="file", content_sha256=digest),
                ]
            )


class AbsolutePathTests(unittest.TestCase):
    """Making a caller's path absolute must give the same answer as the Node consumer.

    The expectations are the literal output of `node:path`'s `resolve()` for the same inputs, so a
    drift in either direction shows up here rather than as two receipts naming one directory
    differently.
    """

    @unittest.skipIf(sys.platform == "win32", "POSIX path semantics")
    def test_matches_node_resolve_lexically(self) -> None:
        cwd = os.getcwd()
        for value, expected in (
            ("/a/b", "/a/b"),
            ("/a/b/", "/a/b"),
            ("/a/./b", "/a/b"),
            ("/a/b/../c", "/a/c"),
            ("/a/b//", "/a/b"),
            ("/.", "/"),
            ("/..", "/"),
            ("/a/../..", "/"),
            # POSIX leaves exactly two leading slashes implementation-defined; Node collapses them.
            ("//a//b", "/a/b"),
            ("///a", "/a"),
            ("", cwd),
            (".", cwd),
            ("rel/path", os.path.join(cwd, "rel/path")),
        ):
            with self.subTest(value=value):
                self.assertEqual(str(absolute_path(value)), expected)

    def test_never_consults_the_filesystem(self) -> None:
        root = Path(tempfile.mkdtemp(prefix="scrollcase-abspath-"))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        if sys.platform == "win32":
            self.skipTest("symbolic links need elevation on Windows")
        target = root / "real"
        target.mkdir()
        link = root / "alias"
        link.symlink_to(target)

        # The whole point: a link stays the path the caller named, so the check that refuses one
        # still has something to look at.
        self.assertEqual(str(absolute_path(link)), str(link))
        self.assertEqual(str(absolute_path(root / "dangling")), str(root / "dangling"))


class PayloadDigestWalkTests(unittest.TestCase):
    """What the digest sees when it walks a real directory."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="scrollcase-digest-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        (self.root / "venv" / "bin").mkdir(parents=True)
        (self.root / "box.json").write_bytes(b'{"schemaVersion":2}\n')
        (self.root / "venv" / "bin" / "python3.11").write_bytes(b"interpreter")

    def test_skips_the_list_file_and_the_names_python_generates(self) -> None:
        (self.root / PAYLOAD_DIGEST_FILE).write_bytes(b"whatever")
        before = payload_digest(self.root)

        # A file cannot carry its own hash, and the things Python writes after installation are
        # excluded by the collector — so neither may move the digest.
        (self.root / PAYLOAD_DIGEST_FILE).write_bytes(b"something else entirely")
        (self.root / "venv" / "__pycache__").mkdir()
        (self.root / "venv" / "__pycache__" / "x.cpython-311.pyc").write_bytes(b"cached")
        (self.root / "venv" / "os.pyc").write_bytes(b"stale")
        self.assertEqual(payload_digest(self.root), before)

    def test_notices_a_changed_byte_but_not_a_changed_mode_or_time(self) -> None:
        before = payload_digest(self.root)
        target = self.root / "venv" / "bin" / "python3.11"

        # Mode is synthesised by the archive writer and never restored on Windows; mtime is stamped
        # at build and restored by no extractor. Including either would fail honest boxes.
        target.chmod(0o600)
        os.utime(target, (0, 0))
        self.assertEqual(payload_digest(self.root), before)

        target.write_bytes(b"interprete")
        self.assertNotEqual(payload_digest(self.root), before)

    @unittest.skipIf(sys.platform == "win32", "Windows boxes carry no links")
    def test_separates_a_link_from_a_file_holding_its_target_name(self) -> None:
        (self.root / "venv" / "bin" / "python").symlink_to("python3.11")
        with_link = payload_digest(self.root)

        (self.root / "venv" / "bin" / "python").unlink()
        (self.root / "venv" / "bin" / "python").write_bytes(b"python3.11")
        self.assertNotEqual(payload_digest(self.root), with_link)


if __name__ == "__main__":
    unittest.main()


class PayloadLinkRuleTests(unittest.TestCase):
    """The Python half of the one rule both consumers apply to payload links.

    These mirror `tests/unit/contract-links.test.mjs`. Two implementations of one rule are two
    chances to disagree, and the cases that matter here are the hostile ones: whatever a box
    claims, neither consumer may create a link that reaches out of the directory it extracted into.
    """

    def test_keeps_the_shapes_a_conda_prefix_produces(self) -> None:
        from scrollcase_consumer._contract import resolve_payload_link_target

        self.assertEqual(
            resolve_payload_link_target("venv/bin/python", "python3.11"),
            "venv/bin/python3.11",
        )
        self.assertEqual(
            resolve_payload_link_target("venv/lib/libicudata.so", "libicudata.so.78"),
            "venv/lib/libicudata.so.78",
        )
        # `..` is not hostile in itself, and real prefixes use it.
        self.assertEqual(
            resolve_payload_link_target("venv/share/x", "../lib/x"), "venv/lib/x"
        )

    def test_refuses_a_target_that_reaches_outside_the_payload(self) -> None:
        from scrollcase_consumer._contract import resolve_payload_link_target

        for link_path, target in (
            ("venv/bin/python", "/usr/bin/python3"),
            ("venv/bin/python", "/etc/passwd"),
            ("venv/bin/python", "../../../etc/passwd"),
            ("a", "../b"),
            ("venv/bin/x", "../../../scrollcase/venv/bin/y"),
            ("venv/bin/python", "C:/Windows/System32"),
            ("venv/bin/python", "..\\..\\windows"),
            # A link onto itself resolves to nothing useful and loops anything that follows it.
            ("venv/bin/python", "python"),
        ):
            with self.subTest(target=target):
                self.assertIsNone(resolve_payload_link_target(link_path, target))

    def test_refuses_directory_links_cycles_and_dangling_links(self) -> None:
        from dataclasses import dataclass

        from scrollcase_consumer._contract import (
            find_entry_through_link,
            find_unresolvable_link,
        )

        @dataclass(frozen=True)
        class Entry:
            path: str
            kind: str
            link_target: str | None = None

        chain = [
            Entry("venv/lib/libicudata.so", "link", "libicudata.so.78"),
            Entry("venv/lib/libicudata.so.78", "link", "libicudata.so.78.3"),
            Entry("venv/lib/libicudata.so.78.3", "file"),
        ]
        self.assertIsNone(find_unresolvable_link(chain))

        # A directory link is the only way an entry could be written somewhere its own name does
        # not describe, so it is refused however that directory exists.
        directory_link = [
            Entry("venv/lib/python3.1", "link", "python3.11"),
            Entry("venv/lib/python3.11/os.py", "file"),
        ]
        self.assertEqual(find_unresolvable_link(directory_link), "venv/lib/python3.1")

        cycle = [Entry("venv/a", "link", "b"), Entry("venv/b", "link", "a")]
        self.assertIsNotNone(find_unresolvable_link(cycle))

        dangling = [Entry("venv/bin/python", "link", "python3.11")]
        self.assertEqual(find_unresolvable_link(dangling), "venv/bin/python")

        through = [
            Entry("venv/lib/real/os.py", "file"),
            Entry("venv/lib/alias", "link", "real"),
            Entry("venv/lib/alias/evil.py", "file"),
        ]
        self.assertEqual(find_entry_through_link(through), "venv/lib/alias/evil.py")
