import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020.js';
import * as build from '../../src/build/index.mjs';
import * as consumer from '../../src/consumer/index.mjs';
import * as contract from '../../src/contract/index.mjs';
import * as sign from '../../src/sign/index.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const schemaSource = join(root, 'src', 'contract', 'schema');
const schemaPublic = join(root, 'docs', 'public', 'schema', 'v2');

const whitePaperPath = join(root, 'docs', 'white-paper.md');

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

/** Every module the package ships, as the repository-relative path a document would cite. */
async function shippedModules(directory = join(root, 'src')) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await shippedModules(path));
    else if (extname(entry.name) === '.mjs') found.push(relative(root, path).split(sep).join('/'));
  }
  return found.sort();
}

/**
 * The heading slug VitePress produces, mirrored rather than imported.
 *
 * The site's own slugifier lives in a docs-only dependency, and this suite runs from the repository
 * root where those are not installed. The mirror is checked the only way a mirror can be: every
 * heading in the built page resolved through it while the white paper was written.
 */
function headingSlug(text) {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

/**
 * The prose of a document, with code removed.
 *
 * Both fenced blocks and inline spans go: a `#` inside a fence is a comment rather than a heading,
 * and this document quotes its own anchor syntax as inline code, which is a description of a link
 * rather than a link.
 */
function markdownProse(markdown) {
  return markdown.replace(/^```[\s\S]*?^```$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** Headings outside fenced code blocks — a `#` inside one is a comment, not a heading. */
function headingSlugs(markdown) {
  const slugs = new Set();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^#{2,6}\s+(.*?)\s*$/.exec(line);
    if (heading) slugs.add(headingSlug(heading[1]));
  }
  return slugs;
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
      expect(new URL(schema.$id).pathname).toBe(`/schema/v2/${name}`);
      for (const match of source.matchAll(/"\$ref":\s*"(https:\/\/scrollcase\.dev\/schema\/v2\/([^"#]+)(?:#[^"]*)?)"/g)) {
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
    for (const [subpath, exports] of Object.entries({
      contract,
      build,
      consumer,
      sign,
    })) {
      for (const name of Object.keys(exports)) {
        expect(reference, `scrollcase/${subpath} export ${name}`).toContain(name);
      }
    }
    expect(reference).toContain('scrollcase/contract/types');
  });

  it('parses every full JSON example and validates complete scrolls', async () => {
    const [scrollSchema, targetSchema, executionSchema] = await Promise.all([
      readFile(join(schemaSource, 'scroll.schema.json'), 'utf8').then(JSON.parse),
      readFile(join(schemaSource, 'target.schema.json'), 'utf8').then(JSON.parse),
      readFile(join(schemaSource, 'execution.schema.json'), 'utf8').then(JSON.parse),
    ]);
    const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
    ajv.addSchema(targetSchema);
    ajv.addSchema(executionSchema);
    const validateScroll = ajv.compile(scrollSchema);
    for (const path of await markdownFiles(join(root, 'docs'))) {
      const markdown = await readFile(path, 'utf8');
      for (const match of markdown.matchAll(/^```json\n([\s\S]*?)^```$/gm)) {
        const example = JSON.parse(match[1]);
        if (example?.schemaVersion === 2 && typeof example?.scrollVersion === 'string' && example?.target) {
          expect(validateScroll(example), `${path}: ${ajv.errorsText(validateScroll.errors)}`).toBe(true);
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
        // VitePress accepts a link written with or without the `.md` suffix, and resolves a
        // section route — `/guides` or `/guides/` — to that directory's `index.md`. All four
        // spellings name the same page, so the check tries both files before calling a route dead.
        const page = route.slice(1).replace(/\.md$/, '').replace(/\/$/, '');
        const backing = await Promise.allSettled([
          readFile(join(root, 'docs', `${page}.md`)),
          readFile(join(root, 'docs', page, 'index.md')),
        ]);
        expect(backing.some(({ status }) => status === 'fulfilled'), route).toBe(true);
      }
    }
  });
});

/**
 * The white paper describes the codebase module by module, which is exactly the kind of document
 * that decays without anyone noticing. These three cases make the decay loud: a module added
 * without a description, an export published without one, and an internal anchor that no longer
 * lands anywhere.
 */
describe('the technical white paper', () => {
  it('describes every module the package ships', async () => {
    const paper = await readFile(whitePaperPath, 'utf8');
    for (const module of await shippedModules()) {
      expect(paper, module).toContain(module);
    }
  });

  it('describes every public surface and every runtime export', async () => {
    const paper = await readFile(whitePaperPath, 'utf8');
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    for (const subpath of Object.keys(packageJson.exports)) {
      const specifier = `scrollcase${subpath.slice(1)}`;
      expect(paper, specifier).toContain(specifier);
    }
    for (const [subpath, exports] of Object.entries({ contract, build, consumer, sign })) {
      for (const name of Object.keys(exports)) {
        expect(paper, `scrollcase/${subpath} export ${name}`).toContain(name);
      }
    }
  });

  it('resolves every intra-page anchor to a heading that exists', async () => {
    // VitePress fails a build on a dead link between pages, but an anchor into the same page that
    // matches no heading renders as a link that quietly goes nowhere — and every technical term in
    // this document is such a link.
    const paper = await readFile(whitePaperPath, 'utf8');
    const slugs = headingSlugs(paper);
    for (const [, anchor] of markdownProse(paper).matchAll(/\]\(#([^)]+)\)/g)) {
      expect(slugs.has(anchor), `#${anchor}`).toBe(true);
    }
  });
});
