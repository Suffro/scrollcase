# scrollcase-consumer

Verify, prepare, and run caller-supplied local [Scrollcase](https://scrollcase.dev) boxes from Rust.

A **box** is a portable, locked, self-contained Python environment built for one operating system and
accelerator, signed so whoever receives it can prove what they received. This crate is the consuming
half of that story, and only that half.

It is deliberately **not** a distribution system. It selects no channel, downloads nothing, updates
nothing, and knows about no registry. Every path, trust key, archive and destination comes from the
caller, because those lifecycle choices belong to the application rather than to the format.

## Status

**Under development.** The public surface is complete, covered by 96 tests, and passes all 65 shared
conformance cases. What remains is packaging. Not yet published to crates.io.

| Area | State |
| --- | --- |
| Target model, document envelope, link rules, payload digest | complete, fixture-proved |
| Signature verification and typed release manifests | complete |
| Archive inspection, extraction, `box.json` agreement | complete |
| Prepare, attach, payload verification, receipts | complete |
| Execution, environment reporting, signal forwarding | complete |
| The 65 shared consumer-conformance cases | complete |
| Packaging, CI, documentation | planned |

## One contract, three implementations

`src/contract/` in the [Scrollcase repository](https://github.com/suffro/scrollcase) is the single
source of truth for the box format. This crate does not import it — it cannot, across languages — so
it *mirrors* the rules and proves the mirror against shared, language-neutral fixtures. The Node
consumer at `scrollcase/consumer` and the Python `scrollcase_consumer` package do the same, which is
how three runtimes stay in agreement without one of them owning a second definition of the format.

The bundled copies under `fixtures/` and `src/contract/schema/` exist because a published crate cannot
read files outside itself. They are kept honest by a drift test and by
`node rust/scripts/sync-assets.mjs --check`.

## Verification precedes execution

No interpreter, script, module or import from a box runs before the signature, the payload shape, the
archive size and hash, the entry safety and the manifest agreement have all passed. The type system
carries that rule: the receipt proving those checks succeeded has private fields and no public
constructor, so it can only be obtained from a function that performed them.

## Development

```sh
cargo test                              # unit suite and contract fixtures
node scripts/sync-assets.mjs --check    # bundled schemas and fixtures are current
```

## Licence

Apache-2.0. See [LICENSE](LICENSE).
