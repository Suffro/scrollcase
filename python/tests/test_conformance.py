from __future__ import annotations

import unittest

from .conformance_support import (
    load_consumer_conformance_suite,
    remove_conformance_root,
    run_python_conformance_case,
)


class SharedConsumerConformanceTests(unittest.TestCase):
    def test_every_shared_semantic_case(self) -> None:
        suite = load_consumer_conformance_suite()
        for test_case in suite["cases"]:
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
