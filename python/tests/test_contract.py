from __future__ import annotations

import json
import subprocess
import sys
import unittest
from importlib.resources import files
from pathlib import Path
from typing import Any, cast

from scrollcase_consumer._contract import (
    SCHEMA_FILES,
    target_from_json,
    target_id,
)


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
