import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020.js';
import * as build from '../../src/build/index.mjs';
import * as contract from '../../src/contract/index.mjs';
import * as sign from '../../src/sign/index.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const schemaSource = join(root, 'src', 'contract', 'schema');
const schemaPublic = join(root, 'docs', 'public', 'schema');

async function markdownFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.vitepress') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await markdownFiles(path));
    else if (extname(entry.name) === '.md') found.push(path);
  }
  return found;
}

describe('public documentation routes', () => {
  it('publishes byte-identical copies of every shipped schema', async () => {
    const names = (await readdir(schemaSource)).filter((name) => name.endsWith('.schema.json')).sort();
    const published = await readdir(schemaPublic);
    expect(published.filter((name) => name.endsWith('.schema.json')).sort()).toEqual(names);
    for (const name of names) {
      expect(await readFile(join(schemaPublic, name)))
        .toEqual(await readFile(join(schemaSource, name)));
    }
  });

  it('keeps every absolute schema identifier and reference on a published route', async () => {
    const names = (await readdir(schemaSource)).filter((name) => name.endsWith('.schema.json')).sort();
    const published = new Set(names);
    for (const name of names) {
      const source = await readFile(join(schemaSource, name), 'utf8');
      const schema = JSON.parse(source);
      expect(new URL(schema.$id).pathname).toBe(`/schema/${name}`);
      for (const match of source.matchAll(/"\$ref":\s*"(https:\/\/scrollcase\.dev\/schema\/([^"#]+)(?:#[^"]*)?)"/g)) {
        expect(published.has(match[2]), match[1]).toBe(true);
      }
    }
  });

  it('has a real privacy page, reachable from every page', async () => {
    await expect(readFile(join(root, 'docs', 'privacy.md'), 'utf8'))
      .resolves.toMatch(/^---[\s\S]*title:\s*Privacy/m);
    // The footer is the only thing linking it now that the consent banner is gone.
    const config = await readFile(join(root, 'docs', '.vitepress', 'config.mts'), 'utf8');
    expect(config).toMatch(/href="\/privacy"/);
  });

  it('loads no third-party script, which is what lets the site ask for no consent', async () => {
    // The privacy page promises no cookies and no third-party code. A tag pasted back into the
    // head — an analytics snippet, a sharing widget — would make that page a false statement
    // before anyone noticed, so the promise is asserted rather than trusted.
    const config = await readFile(join(root, 'docs', '.vitepress', 'config.mts'), 'utf8');
    const scripts = [...config.matchAll(/\[\s*'script'\s*,[\s\S]*?\]/g)].map((match) => match[0]);
    expect(scripts).toEqual([]);
    for (const forbidden of ['googletagmanager', 'google-analytics', 'gtag(', 'sharethis']) {
      expect(config.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('keeps CLI verbs and help options discoverable in the CLI reference', async () => {
    const help = execFileSync(process.execPath, ['src/cli.mjs', 'help'], {
      cwd: root,
      encoding: 'utf8',
    });
    const reference = await readFile(join(root, 'docs', 'reference', 'cli.md'), 'utf8');
    const commands = help.slice(help.indexOf('Commands:'), help.indexOf('Init options:'));
    const helpVerbs = [...commands.matchAll(/^  ([a-z]+)(?:\s|$)/gm)].map((match) => match[1]);
    const documentedVerbs = [...reference.matchAll(/^## `([a-z]+)`$/gm)].map((match) => match[1]);
    expect(documentedVerbs).toEqual(helpVerbs);
    for (const option of new Set(help.match(/--[a-z][a-z-]+/g) ?? [])) {
      expect(reference, option).toContain(option);
    }
  });

  it('documents every public runtime export', async () => {
    const reference = await readFile(join(root, 'docs', 'reference', 'api.md'), 'utf8');
    for (const [subpath, exports] of Object.entries({ contract, build, sign })) {
      for (const name of Object.keys(exports)) {
        expect(reference, `scrollcase/${subpath} export ${name}`).toContain(name);
      }
    }
    expect(reference).toContain('scrollcase/contract/types');
  });

  it('parses every full JSON example and validates complete recipes', async () => {
    const [recipeSchema, targetSchema] = await Promise.all([
      readFile(join(schemaSource, 'recipe.schema.json'), 'utf8').then(JSON.parse),
      readFile(join(schemaSource, 'target.schema.json'), 'utf8').then(JSON.parse),
    ]);
    const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
    ajv.addSchema(targetSchema);
    const validateRecipe = ajv.compile(recipeSchema);
    for (const path of await markdownFiles(join(root, 'docs'))) {
      const markdown = await readFile(path, 'utf8');
      for (const match of markdown.matchAll(/^```json\n([\s\S]*?)^```$/gm)) {
        const example = JSON.parse(match[1]);
        if (example?.recipeId) {
          expect(validateRecipe(example), `${path}: ${ajv.errorsText(validateRecipe.errors)}`).toBe(true);
        }
      }
    }
  });

  it('resolves internal links generated by custom theme components and config', async () => {
    const sources = await Promise.all([
      readFile(join(root, 'docs', '.vitepress', 'config.mts'), 'utf8'),
      readFile(join(root, 'docs', '.vitepress', 'theme', 'HomePage.vue'), 'utf8'),
    ]);
    const routes = new Set();
    for (const source of sources) {
      for (const match of source.matchAll(/(?:link:\s*|withBase\()['"]([^'"]+)['"]/g)) {
        if (match[1].startsWith('/')) routes.add(match[1]);
      }
    }
    for (const route of routes) {
      if (route === '/') {
        await expect(readFile(join(root, 'docs', 'index.md'))).resolves.toBeTruthy();
      } else if (route.startsWith('/static/')) {
        await expect(readFile(join(root, 'docs', 'public', route.slice(1)))).resolves.toBeTruthy();
      } else {
        // VitePress accepts a link written with or without the `.md` suffix and resolves both to
        // the same page, so the check has to normalise before appending one of its own.
        const page = route.slice(1).replace(/\.md$/, '');
        await expect(readFile(join(root, 'docs', `${page}.md`)), route).resolves.toBeTruthy();
      }
    }
  });
});
