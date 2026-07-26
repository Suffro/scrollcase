#!/usr/bin/env node

/**
 * Generates the contract's TypeScript types from its JSON Schemas.
 *
 * The schemas are the source of truth for the box format; these types are a projection of them,
 * never a second definition. Generating rather than hand-writing is what makes it impossible for a
 * consumer's types to drift from the format a builder actually emits — the same reason the licence
 * audit is derived from the lock rather than maintained beside it.
 *
 * The output is committed, so the package needs no build step and `npm publish` still ships only
 * reviewed files. The package-surface test runs this script in check mode, so a schema change that
 * was not accompanied by a regeneration fails the suite instead of shipping stale types.
 *
 * Run with `npm run types`, or `npm run types:check` to verify without writing.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const SCHEMA_DIR = fileURLToPath(new URL('../src/contract/schema/', import.meta.url));
const OUTPUT_PATH = fileURLToPath(new URL('../src/contract/types/index.d.ts', import.meta.url));

/**
 * The generated type name for each schema. Named explicitly rather than derived from the file name
 * so that renaming a schema file cannot silently rename a type consumers import.
 */
const SCHEMAS = Object.freeze([
  { file: 'target.schema.json', name: 'BoxTarget' },
  { file: 'recipe.schema.json', name: 'BoxRecipe' },
  { file: 'box-manifest.schema.json', name: 'BoxManifest' },
  { file: 'release-manifest.schema.json', name: 'BoxReleaseManifest' },
  { file: 'channel-manifest.schema.json', name: 'BoxChannelManifest' },
  { file: 'revocations-manifest.schema.json', name: 'BoxRevocationsManifest' },
  { file: 'signed-document.schema.json', name: 'SignedBoxDocument' },
]);

/**
 * Resolves the schemas' own `$id` URLs to the files shipped in this package.
 *
 * The `$id`s are absolute URLs because published documents refer to them, but generation must never
 * depend on that host being reachable — the schemas in the tree are the ones being compiled.
 */
const localSchemaResolver = {
  order: 1,
  canRead: /^https?:\/\/scrollcase\.dev\/schema\//,
  read: (file) => readFile(join(SCHEMA_DIR, basename(new URL(file.url).pathname)), 'utf8'),
};

const BANNER = `/**
 * Types for the scrollcase box format, generated from the JSON Schemas in
 * src/contract/schema/. Do not edit by hand: run \`npm run types\` instead.
 *
 * The schemas are the source of truth. These types are a projection of them, and the test suite
 * fails if the two disagree.
 */`;

/** Compiles every schema into one declaration file. */
export async function generateContractTypes() {
  const blocks = [];
  for (const { file, name } of SCHEMAS) {
    const schema = JSON.parse(await readFile(join(SCHEMA_DIR, file), 'utf8'));
    // The generator names the root type after the schema's `title`, falling back to its `$id` URL.
    // Overwrite it so the table above stays the single place a public type is named.
    schema.title = name;
    const compiled = await compile(schema, name, {
      bannerComment: '',
      additionalProperties: false,
      declareExternallyReferenced: true,
      enableConstEnums: false,
      style: { singleQuote: true },
      cwd: SCHEMA_DIR,
      $refOptions: { resolve: { scrollcase: localSchemaResolver, http: false } },
    });
    blocks.push(compiled.trim());
  }
  // Repeated `$ref`s produce the same helper interface in more than one block; keep the first.
  const seen = new Set();
  const deduped = blocks.join('\n\n').split(/\n(?=export (?:interface|type) )/).filter((block) => {
    const name = /^export (?:interface|type) (\w+)/.exec(block)?.[1];
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  return `${BANNER}\n\n${deduped.join('\n').trim()}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const types = await generateContractTypes();
  if (process.argv.includes('--check')) {
    const committed = await readFile(OUTPUT_PATH, 'utf8');
    if (committed !== types) {
      throw new Error('Generated contract types are out of date. Run `npm run types`.');
    }
    console.log('Generated contract types are current.');
  } else {
    await writeFile(OUTPUT_PATH, types);
    console.log(`Wrote ${OUTPUT_PATH}`);
  }
}
