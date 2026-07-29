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
