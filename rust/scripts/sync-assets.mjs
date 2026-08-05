#!/usr/bin/env node
/**
 * Copy the canonical contract assets into the Rust crate, or check for drift.
 *
 * The crate mirrors the format rather than importing it, and it must remain publishable on its own:
 * `include_str!` cannot reach outside the crate directory once packaged. So the fixtures and schemas
 * live in two places by design, and this script is what keeps the second one honest — the same
 * arrangement `python/scripts/sync_schemas.py` maintains for the Python consumer.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CRATE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(CRATE_ROOT);

/** Canonical source → crate destination, both relative to the repository root. */
const ASSETS = [
  ['src/contract/fixtures/target-id-contract.json', 'rust/fixtures/target-id-contract.json'],
  ['src/contract/fixtures/payload-digest-contract.json', 'rust/fixtures/payload-digest-contract.json'],
  ['src/contract/fixtures/consumer-conformance.json', 'rust/fixtures/consumer-conformance.json'],
  ['src/contract/schema/signed-document.schema.json', 'rust/src/contract/schema/signed-document.schema.json'],
  ['src/contract/schema/release-manifest.schema.json', 'rust/src/contract/schema/release-manifest.schema.json'],
  ['src/contract/schema/box-manifest.schema.json', 'rust/src/contract/schema/box-manifest.schema.json'],
  ['src/contract/schema/target.schema.json', 'rust/src/contract/schema/target.schema.json'],
  ['src/contract/schema/execution.schema.json', 'rust/src/contract/schema/execution.schema.json'],
  ['src/contract/fixtures/examples/release-manifest.example.json', 'rust/fixtures/examples/release-manifest.example.json'],
  ['src/contract/fixtures/examples/box-manifest.example.json', 'rust/fixtures/examples/box-manifest.example.json'],
  ['src/contract/fixtures/examples/signed-release.example.json', 'rust/fixtures/examples/signed-release.example.json'],
];

const check = process.argv.includes('--check');
const drift = [];

for (const [source, destination] of ASSETS) {
  const canonical = await readFile(join(REPO_ROOT, source));
  const destinationPath = join(REPO_ROOT, destination);
  if (check) {
    const current = await readFile(destinationPath).catch(() => null);
    if (current === null || !current.equals(canonical)) drift.push(destination);
    continue;
  }
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, canonical);
}

if (drift.length > 0) {
  process.stderr.write(
    `Rust asset copies are stale: ${drift.join(', ')}. Run node rust/scripts/sync-assets.mjs.\n`,
  );
  process.exit(1);
}
