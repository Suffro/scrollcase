from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


class ReleaseVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.python_root = Path(__file__).resolve().parents[1]
        self.script = self.python_root / "scripts" / "check_release_version.py"
        # Read from pyproject rather than restate it: hard-coding the version here meant every
        # release broke three tests that were not about the release.
        pyproject = (self.python_root / "pyproject.toml").read_text(encoding="utf-8")
        self.version = next(
            line.split('"')[1]
            for line in pyproject.splitlines()
            if line.startswith("version = ")
        )

    def run_check(self, tag: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(self.script), tag],
            cwd=self.python_root,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_accepts_the_package_version_tag(self) -> None:
        result = self.run_check(f"python-v{self.version}")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            f"python-v{self.version} matches package version {self.version}",
            result.stdout,
        )

    def test_rejects_the_node_release_tag_namespace(self) -> None:
        result = self.run_check(f"v{self.version}")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"expected python-v{self.version}", result.stderr)

    def test_rejects_a_mismatched_python_release_tag(self) -> None:
        result = self.run_check("python-v9.9.9")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"expected python-v{self.version}", result.stderr)


if __name__ == "__main__":
    unittest.main()
