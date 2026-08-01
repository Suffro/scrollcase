from __future__ import annotations

import sys
import unittest

from .conformance_support import (
    load_consumer_conformance_suite,
    remove_conformance_root,
    run_python_conformance_case,
)


# Windows boxes are link-free, and creating a link there needs elevation, so a case that requires
# one cannot run on this host. Skipped rather than weakened: the rule it proves is real on the two
# platforms that carry links.
SYMLINKS_SUPPORTED = sys.platform != "win32"


class SharedConsumerConformanceTests(unittest.TestCase):
    def test_every_shared_semantic_case(self) -> None:
        suite = load_consumer_conformance_suite()
        for test_case in suite["cases"]:
            if test_case.get("requiresSymlinks") and not SYMLINKS_SUPPORTED:
                continue
            with self.subTest(case=test_case["id"]):
                actual, expected, root = run_python_conformance_case(
                    test_case,
                    suite,
                )
                try:
                    self.assertEqual(actual, expected)
                finally:
                    remove_conformance_root(root)


if __name__ == "__main__":
    unittest.main()
