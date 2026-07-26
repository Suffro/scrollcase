/**
 * Materialise the public schema routes from the package's canonical contract directory.
 *
 * The copies live under VitePress public assets because a schema's absolute `$id` is a web URL.
 * `--check` is what production builds use: it refuses drift instead of silently repairing a stale
 * checkout, so the committed public files and the npm package cannot diverge unnoticed.
 */

import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const check = process.argv.includes('--check');
const root = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = join(root, 'src', 'contract', 'schema');
const publicDir = join(root, 'docs', 'public', 'schema');
const schemaNames = (await readdir(sourceDir))
  .filter((name) => name.endsWith('.schema.json'))
  .sort();

if (check) {
  let publicNames;
  try {
    publicNames = (await readdir(publicDir))
      .filter((name) => name.endsWith('.schema.json'))
      .sort();
  } catch {
    throw new Error('Public schemas are missing; run npm run docs:schemas.');
  }
  if (JSON.stringify(publicNames) !== JSON.stringify(schemaNames)) {
    throw new Error('Public schema file set differs from src/contract/schema; run npm run docs:schemas.');
  }
  for (const name of schemaNames) {
    const [source, published] = await Promise.all([
      readFile(join(sourceDir, name)),
      readFile(join(publicDir, name)),
    ]);
    if (!source.equals(published)) {
      throw new Error(`Public schema differs from the shipped contract: ${name}`);
    }
  }
  console.log(`Checked ${schemaNames.length} public schemas.`);
} else {
  await mkdir(publicDir, { recursive: true });
  const stale = (await readdir(publicDir))
    .filter((name) => name.endsWith('.schema.json') && !schemaNames.includes(name));
  await Promise.all(stale.map((name) => rm(join(publicDir, name))));
  await Promise.all(schemaNames.map((name) =>
    copyFile(join(sourceDir, name), join(publicDir, name))));
  console.log(`Synchronized ${schemaNames.length} public schemas.`);
}
