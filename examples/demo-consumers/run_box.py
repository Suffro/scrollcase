"""Runs the demo box through the typed Python consumer.

The Python consumer is published separately on PyPI, and needs no Node at all.

SETUP (once):

    python -m pip install scrollcase-consumer

RUN (from this folder):

    python run_box.py

The public key is not shipped with the box: download it first, as the guide describes. A signature
only proves where something came from if the key does not travel with it.
"""

from __future__ import annotations

import sys
from pathlib import Path

from scrollcase_consumer import PreparedBox, run_box

# The release document is named for its own SHA-256, so it is found rather than hard-coded. The box
# archive is never named here: the consumer resolves it beside this document, under the hash the
# document commits to.
releases = sorted(Path("box").glob("*.release.json"))
if not releases:
    raise SystemExit("No .release.json in box/ — unpack the downloaded archive first.")


def report(prepared: PreparedBox) -> None:
    """Runs after verification and before the box interpreter starts."""

    # Flushed because the box writes straight to this process's stdout, and an unflushed line would
    # appear after the output it introduces.
    print(
        f"Running {prepared.box_id} {prepared.version} ({prepared.target_id})",
        flush=True,
    )


result = run_box(
    releases[0],
    public_key_path="keys/example-signing-public.json",
    on_prepared=report,
)

if result.signal:
    print(f"Box exited after {result.signal}.", file=sys.stderr)
raise SystemExit(result.exit_code if result.exit_code is not None else 1)
