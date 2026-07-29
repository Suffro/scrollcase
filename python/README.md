# scrollcase-consumer

`scrollcase-consumer` is the typed Python API for verifying, preparing, and running a
caller-supplied local Scrollcase box:

```python
from scrollcase_consumer import run_box

result = run_box(
    "release.json",
    public_key_path="trusted-key.json",
    archive="box.zip",
    args=("--input", "sample.json"),
)
```

The public operations are `verify_and_extract_box`, `run_extracted_box`, and `run_box`. Verification
always precedes execution, and the child application runs with the box's own interpreter through an
argument array, never a shell.

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
