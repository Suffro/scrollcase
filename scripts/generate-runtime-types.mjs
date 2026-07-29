#!/usr/bin/env node

/**
 * Generates TypeScript declarations for Scrollcase's JavaScript library entry points.
 *
 * The runtime implementation remains the source of truth: TypeScript reads the JSDoc already
 * reviewed beside each function and emits declarations for the complete dependency closure of the
 * public modules. Committing that output keeps the published package build-free, while the
 * check mode prevents a JavaScript API change from silently leaving stale declarations behind.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeGeneratedText } from './normalize-generated-text.mjs';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_ROOT = join(ROOT, 'src');
const ENTRY_POINTS = [
  'src/contract/index.mjs',
  'src/contract/browser.mjs',
  'src/build/index.mjs',
  'src/consumer/index.mjs',
  'src/sign/index.mjs',
];

async function declarationFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await declarationFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith('.d.mts')) files.push(relative(root, path));
  }
  return files.sort();
}

async function generateRuntimeTypes() {
  // Compile a declaration-free staging copy. Otherwise TypeScript sees the previous committed
  // `.d.mts` files beside the JavaScript and treats them as inputs, making regeneration depend on
  // the very output it is meant to replace.
  const workspace = await mkdtemp(join(ROOT, '.scrollcase-runtime-types-'));
  const stagedSource = join(workspace, 'src');
  const output = join(workspace, 'output');
  try {
    await cp(SOURCE_ROOT, stagedSource, {
      recursive: true,
      filter: (source) => !source.endsWith('.d.mts'),
    });
    const tsc = require.resolve('typescript/bin/tsc');
    execFileSync(process.execPath, [
      tsc,
      '--allowJs',
      '--declaration',
      '--emitDeclarationOnly',
      '--module', 'NodeNext',
      '--moduleResolution', 'NodeNext',
      '--target', 'ES2022',
      '--types', 'node',
      '--skipLibCheck', 'false',
      '--rootDir', 'src',
      '--outDir', output,
      ...ENTRY_POINTS,
    ], { cwd: workspace, stdio: 'pipe' });
    const generated = new Map();
    for (const file of await declarationFiles(output)) {
      generated.set(file, normalizeGeneratedText(await readFile(join(output, file), 'utf8')));
    }
    return generated;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

const generated = await generateRuntimeTypes();
const committedFiles = await declarationFiles(SOURCE_ROOT);

if (process.argv.includes('--check')) {
  const generatedFiles = [...generated.keys()];
  if (JSON.stringify(committedFiles) !== JSON.stringify(generatedFiles)) {
    throw new Error('Generated runtime declaration file set is out of date. Run `npm run types`.');
  }
  for (const [file, contents] of generated) {
    const committed = normalizeGeneratedText(await readFile(join(SOURCE_ROOT, file), 'utf8'));
    if (committed !== contents) {
      throw new Error(`Generated runtime declaration is out of date: src/${file}. Run \`npm run types\`.`);
    }
  }
  console.log('Generated runtime declarations are current.');
} else {
  for (const file of committedFiles) await rm(join(SOURCE_ROOT, file));
  for (const [file, contents] of generated) {
    const destination = join(SOURCE_ROOT, file);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  console.log(`Wrote ${generated.size} runtime declaration files.`);
}
