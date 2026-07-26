/**
 * Check routes and custom-theme semantics that VitePress's dead-link pass cannot see.
 *
 * VitePress validates Markdown links while it builds, but public assets and HTML emitted by Vue
 * components need an artefact-level guard. Keeping this dependency-free also makes the production
 * docs build the exact check contributors run locally.
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(process.argv[2] ?? join(root, 'docs', '.vitepress', 'dist'));
const schemaSource = join(root, 'src', 'contract', 'schema');
const schemaDist = join(distDir, 'schema');

async function requireFile(path, label) {
  try {
    return await readFile(path);
  } catch {
    throw new Error(`Built documentation is missing ${label}: ${path}`);
  }
}

await requireFile(join(distDir, 'privacy.html'), '/privacy');

const schemaNames = (await readdir(schemaSource))
  .filter((name) => name.endsWith('.schema.json'))
  .sort();
const builtSchemaNames = (await readdir(schemaDist))
  .filter((name) => name.endsWith('.schema.json'))
  .sort();
if (JSON.stringify(builtSchemaNames) !== JSON.stringify(schemaNames)) {
  throw new Error('Built schema route set differs from the shipped contract.');
}
for (const name of schemaNames) {
  const [source, built] = await Promise.all([
    readFile(join(schemaSource, name)),
    readFile(join(schemaDist, name)),
  ]);
  if (!source.equals(built)) throw new Error(`Built schema differs from the shipped contract: ${name}`);
}

const platformHtml = (await requireFile(
  join(distDir, 'guides', 'platform-examples.html'),
  'the platform examples page',
)).toString('utf8');
const tagAttribute = (tag, name) =>
  tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
const tabTags = [...platformHtml.matchAll(/<button\b[^>]*\brole="tab"[^>]*>/g)]
  .map((match) => match[0]);
const panelTags = [...platformHtml.matchAll(/<div\b[^>]*\brole="tabpanel"[^>]*>/g)]
  .map((match) => match[0]);

if (tabTags.length !== 5 || panelTags.length !== 5) {
  throw new Error(`Platform examples must render five tabs and panels in SSR HTML; found ${tabTags.length}/${panelTags.length}.`);
}

const panelsById = new Map(panelTags.map((tag) => [tagAttribute(tag, 'id'), tag]));
for (const tab of tabTags) {
  const id = tagAttribute(tab, 'id');
  const panelId = tagAttribute(tab, 'aria-controls');
  const panel = panelsById.get(panelId);
  if (!id || !panel || tagAttribute(panel, 'aria-labelledby') !== id) {
    throw new Error('A platform tab is missing its reciprocal aria-controls/aria-labelledby relationship.');
  }
}
if (tabTags.filter((tag) => tagAttribute(tag, 'aria-selected') === 'true').length !== 1) {
  throw new Error('Exactly one platform tab must be selected in SSR HTML.');
}
if (tabTags.filter((tag) => tagAttribute(tag, 'tabindex') === '0').length !== 1) {
  throw new Error('Exactly one platform tab must participate in the initial tab order.');
}
if (panelTags.filter((tag) => !tag.includes('style="display:none;"')).length !== 1) {
  throw new Error('Exactly one platform tab panel must be visible in SSR HTML.');
}

console.log(`Verified built privacy route, ${schemaNames.length} schemas, and platform tab semantics.`);
