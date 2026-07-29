from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path


class ReleaseVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.python_root = Path(__file__).resolve().parents[1]
        self.script = self.python_root / "scripts" / "check_release_version.py"

    def run_check(self, tag: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(self.script), tag],
            cwd=self.python_root,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_accepts_the_package_version_tag(self) -> None:
        result = self.run_check("python-v0.1.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("python-v0.1.0 matches package version 0.1.0", result.stdout)

    def test_rejects_the_node_release_tag_namespace(self) -> None:
        result = self.run_check("v0.1.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expected python-v0.1.0", result.stderr)

    def test_rejects_a_mismatched_python_release_tag(self) -> None:
        result = self.run_check("python-v0.1.1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expected python-v0.1.0", result.stderr)


if __name__ == "__main__":
    unittest.main()
