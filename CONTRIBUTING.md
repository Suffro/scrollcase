# Contributing to scrollcase

Thanks for your interest. A few things about this project are deliberate and non-negotiable;
knowing them first will save you a rejected pull request.

## The boundaries

- **One substrate.** pixi + conda-pack + conda-forge, and only that. A second dependency backend
  means proving every guarantee twice, and the guarantees are the product.
- **Published v1 is immutable; the next major line is v2-only.** Existing v1 boxes stay with their old
  Scrollcase versions. New code must not add a v1/v2 union, compatibility aliases, or dual paths;
  the v2 verifier rejects v1 clearly. Never silently edit a `kind` string, payload encoding,
  signature algorithm, or golden fixture under `src/contract/fixtures/`.
- **Determinism is a promise.** Rebuilding the same commit must produce a byte-identical archive.
  Do not introduce anything that varies per run: a clock read, a random value, an unsorted
  directory listing.
- **Consumer scope stays local.** Scrollcase may verify, safely extract, inspect, and run
  caller-supplied local boxes. Distribution, downloads, registries, channel selection, updates,
  promotion, revocation services, application lifecycle policy, and CI orchestration belong to
  consuming projects. Read
  [docs/concepts/design-decisions.md](docs/concepts/design-decisions.md) before proposing a
  feature that looks missing — it may have been left out on purpose.
- **The tool names no consumer.** Project-specific values (namespaces, paths, tolerances) are
  declared by the project in config, scroll or flags; the tool stays ignorant of who uses it.
- **One contract, multiple implementations.** `src/contract/` and its schemas are authoritative.
  `scrollcase/consumer` and Python's `scrollcase_consumer` must prove the same observable behavior
  against shared language-neutral conformance fixtures; neither defines a parallel format.
- **Verification precedes execution.** No consumer path may start box code before signature,
  payload-shape, archive size/hash, safe-entry, and manifest-agreement checks succeed.

## Development

```sh
npm install
npm test
```

The suite (vitest) needs no network and no pixi/conda-pack toolchain: the environment solve is
stubbed, and everything after the solve is the real implementation. CI runs it on macOS, Linux
and Windows.

The Python consumer has its own typed package and verification:

```sh
python -m pip install -e './python[test]'
cd python
python -m unittest discover -s tests -t .
mypy src
python scripts/sync_schemas.py --check
python -m build
python scripts/check_distribution.py dist/*
```

Its tests use only temporary local fixtures. The copied schemas must stay byte-identical to
`src/contract/schema/`; regenerate them only through `python/scripts/sync_schemas.py`.

## Python releases

The Python consumer has an independent version and tag namespace. To prepare a release:

1. update `project.version` in `python/pyproject.toml` and the version pinned in the generated
   Python consumer template;
2. run every Python verification command above and inspect both distribution artifacts;
3. configure the `pypi` GitHub environment as the PyPI Trusted Publisher environment for
   `scrollcase-consumer`;
4. create and push the exact tag `python-v<project.version>`.

`.github/workflows/publish-python.yml` rejects a tag/version mismatch, rebuilds and inspects the
wheel and sdist, then publishes them through PyPI Trusted Publishing. Do not upload the artifacts
manually or reuse the npm `v<version>` tag namespace.

The conda-forge package is bootstrapped only after the PyPI release exists: submit its exact sdist
URL and SHA-256 through conda-forge's staged contribution repository. After acceptance, the
generated feedstock is the authority for conda packaging and conda-forge's update bot proposes
later PyPI versions.

Building for real additionally needs `pixi` at the version a scroll pins, plus `conda-pack` 0.9.2;
`scrollcase doctor` reports what is missing.

## Tests

- Exercise the real path, not just the import: prefer a test that asserts a behaviour someone
  depends on — a tampered archive is rejected, a rebuild is byte-identical, a dirty tree is
  refused — over one that asserts an implementation detail.
- Never let a test reach the network, and never let one write outside its temporary directory.

## Pull requests

Keep changes focused, include a test for the behaviour you add or fix, and leave
`package-lock.json` alone unless the change is explicitly about dependencies.
