from __future__ import annotations

import unittest

from scrollcase_consumer import (
    run_box,
    run_extracted_box,
    verify_and_extract_box,
)


class PublicApiTests(unittest.TestCase):
    def test_exports_the_three_consumer_operations(self) -> None:
        self.assertTrue(callable(verify_and_extract_box))
        self.assertTrue(callable(run_extracted_box))
        self.assertTrue(callable(run_box))


if __name__ == "__main__":
    unittest.main()
