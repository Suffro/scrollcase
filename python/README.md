# scrollcase-consumer

`scrollcase-consumer` is the typed Python API for verifying, preparing, and running a
caller-supplied local Scrollcase box:

```sh
python -m pip install scrollcase-consumer
```

```python
from scrollcase_consumer import run_box

result = run_box(
    "release.json",
    public_key_path="trusted-key.json",
    archive="box.zip",
    args=("--input", "sample.json"),
)
```

The public operations are `verify_and_extract_box`, `attach_extracted_box`,
`verify_extracted_payload`, `run_extracted_box`, and `run_box`. Verification always precedes
execution, and the child application runs with the box's own interpreter through an argument array,
never a shell.

A receipt is bound to the process that produced it, so an application that installs a box once and
runs it across restarts calls `attach_extracted_box` on each later launch: it re-identifies the
extracted directory against the signed release without the archive and without re-reading original
payload file contents. It still enumerates paths, measures metadata, requires the native target, and
verifies on-demand assets. The returned receipt says `status == "attached"`; a freshly extracted
receipt says `"prepared"`.

`verify_extracted_payload` is the separate, opt-in check that the installed bytes are still the ones
the release describes. It verifies the signed `payload-digest.v1` list before parsing it, then hashes
only the files and links that list names. Extra application output and on-demand assets are ignored;
embedded assets are listed and may make the check read tens of gigabytes. Modes and timestamps are
not part of the commitment.

The result is point-in-time integrity, not protection against later changes or a live local
attacker. The build collector excludes `__pycache__` directories and `*.pyc` files, so the digest
never makes an assertion about compiled Python caches. Protect an installation with operating-system
permissions and the embedding application's ownership policy.

This package does not select channels, download boxes or on-demand assets, update installations,
publish, promote, revoke, or manage application lifecycle. The caller supplies local release,
archive, trust-key, destination, and asset paths.

The repository's `src/contract/schema/` directory is the format authority. Run
`python scripts/sync_schemas.py` after an intentional schema change and
`python scripts/sync_schemas.py --check` in verification; the bundled files are generated copies,
not a second Python contract.

Repository verification:

```text
python -m unittest discover -s tests -t .
mypy src
python scripts/sync_schemas.py --check
python -m build
python scripts/check_distribution.py dist/*
```
