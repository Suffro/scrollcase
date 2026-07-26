# Contributing to scrollcase

Thanks for your interest. A few things about this project are deliberate and non-negotiable;
knowing them first will save you a rejected pull request.

## The boundaries

- **One substrate.** pixi + conda-pack + conda-forge, and only that. A second dependency backend
  means proving every guarantee twice, and the guarantees are the product.
- **The wire format is frozen at `schemaVersion: 1`.** Published boxes and installed clients
  depend on it. A breaking change needs a new `schemaVersion` — never a silent edit to a `kind`
  string, the payload encoding, the signature algorithm, or the golden fixtures under
  `src/contract/fixtures/`.
- **Determinism is a promise.** Rebuilding the same commit must produce a byte-identical archive.
  Do not introduce anything that varies per run: a clock read, a random value, an unsorted
  directory listing.
- **Scope stops at a signed box on disk.** Distribution, registries, channels, revocation
  services and CI orchestration belong to consumers of the tool. Read
  [docs/concepts/design-decisions.md](docs/concepts/design-decisions.md) before proposing a
  feature that looks missing — it may have been left out on purpose.
- **The tool names no consumer.** Project-specific values (namespaces, paths, tolerances) are
  declared by the project in config, recipe or flags; the tool stays ignorant of who uses it.

## Development

```sh
npm install
npm test
```

The suite (vitest) needs no network and no pixi/conda-pack toolchain: the environment solve is
stubbed, and everything after the solve is the real implementation. CI runs it on macOS, Linux
and Windows.

Building for real additionally needs `pixi` at the version a recipe pins, plus `conda-pack` 0.9.2;
`scrollcase doctor` reports what is missing.

## Tests

- Exercise the real path, not just the import: prefer a test that asserts a behaviour someone
  depends on — a tampered archive is rejected, a rebuild is byte-identical, a dirty tree is
  refused — over one that asserts an implementation detail.
- Never let a test reach the network, and never let one write outside its temporary directory.

## Pull requests

Keep changes focused, include a test for the behaviour you add or fix, and leave
`package-lock.json` alone unless the change is explicitly about dependencies.
