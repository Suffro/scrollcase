from __future__ import annotations

import unittest

import scrollcase_consumer
from scrollcase_consumer import (
    attach_extracted_box,
    run_box,
    run_extracted_box,
    verify_and_extract_box,
    verify_extracted_payload,
)


class PublicApiTests(unittest.TestCase):
    def test_exports_the_five_consumer_operations(self) -> None:
        self.assertTrue(callable(verify_and_extract_box))
        self.assertTrue(callable(attach_extracted_box))
        self.assertTrue(callable(verify_extracted_payload))
        self.assertTrue(callable(run_extracted_box))
        self.assertTrue(callable(run_box))

    def test_declares_every_name_it_exports(self) -> None:
        # A name reachable but absent from __all__ is a name nobody documented, and one listed but
        # missing breaks `from scrollcase_consumer import *` at import time.
        for name in scrollcase_consumer.__all__:
            self.assertTrue(hasattr(scrollcase_consumer, name), name)


if __name__ == "__main__":
    unittest.main()
