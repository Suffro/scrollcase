/**
 * What a consumer of the published package actually gets.
 *
 * Three failures this catches that nothing else does. First, an `exports` map that names a file which
 * moved or was never shipped: every other test imports by relative path, so the package could be
 * broken for everyone installing it while the suite stayed green. Second, generated types drifting
 * from the schemas they are a projection of — the schemas are the source of truth, and a type that
 * disagrees with them is worse than no type at all. Third, runtime declarations that exist but
 * silently widen the JavaScript API to `any`.
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeGeneratedText } from '../../scripts/normalize-generated-text.mjs';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');
const repoRoot = new URL('../../', import.meta.url);
const repoRootPath = fileURLToPath(repoRoot);

async function moduleClosure(entry, visited = new Set(), allowNodeBuiltins = false) {
  const url = new URL(entry, repoRoot);
  if (visited.has(url.href)) return visited;
  visited.add(url.href);
  const source = await readFile(url, 'utf8');
  const specifiers = [...source.matchAll(
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  )].map((match) => match[1]);
  for (const specifier of specifiers) {
    if (specifier.startsWith('node:')) {
      if (!allowNodeBuiltins) {
        expect(specifier, `${entry} imports a Node built-in`).not.toMatch(/^node:/);
      }
      continue;
    }
    if (specifier.startsWith('.')) {
      await moduleClosure(new URL(specifier, url).href, visited, allowNodeBuiltins);
    }
  }
  return visited;
}

describe('the package surface', () => {
  const subpathTargets = (subpath) => {
    const entry = packageJson.exports[subpath];
    return typeof entry === 'string' ? [entry] : Object.values(entry);
  };

  it('exports every subpath it advertises, and each one resolves to a file that exists', async () => {
    const subpaths = Object.keys(packageJson.exports).filter((subpath) => !subpath.includes('*'));
    expect(subpaths).toEqual([
      './contract',
      './contract/browser',
      './contract/types',
      './build',
      './consumer',
      './sign',
    ]);
    for (const subpath of subpaths) {
      for (const target of subpathTargets(subpath)) {
        // Reading it is the check: a path that no longer exists throws here.
        await expect(readFile(new URL(target, repoRoot), 'utf8')).resolves.toBeTruthy();
      }
    }
  });

  it('ships everything the exports map points at', () => {
    // `files` decides what npm publishes; an export outside it resolves for us and 404s for a user.
    const shipped = new Set(packageJson.files);
    for (const subpath of Object.keys(packageJson.exports)) {
      for (const target of subpathTargets(subpath)) {
        const top = target.replace(/^\.\//, '').split('/')[0];
        expect(shipped.has(top), `${subpath} resolves outside "files"`).toBe(true);
      }
    }
  });

  it('ships the executable under the canonical command name without npm normalization', () => {
    expect(packageJson.bin).toEqual({ scrollcase: 'src/cli.mjs' });
    expect(packageJson.files).toContain('src');
  });

  it('imports each runtime entry point the way a dependent would', async () => {
    const contract = await import('scrollcase/contract');
    const browserContract = await import('scrollcase/contract/browser');
    const build = await import('scrollcase/build');
    const consumer = await import('scrollcase/consumer');
    const sign = await import('scrollcase/sign');

    // A representative export from each, so a module that resolves but fails to evaluate is caught.
    expect(contract.boxTargetId({ platform: 'macos', arch: 'aarch64', accelerator: 'metal' }))
      .toBe('macos-aarch64-metal');
    expect(contract.documentKinds().release).toBe('scrollcase.box.release');
    expect(browserContract.isSignedBoxDocument({})).toBe(false);
    expect(typeof build.sha256File).toBe('function');
    expect(typeof consumer.verifyAndExtractBox).toBe('function');
    expect(typeof consumer.runExtractedBox).toBe('function');
    expect(typeof consumer.runBox).toBe('function');
    expect(typeof sign.verifySignedDocument).toBe('function');
  });

  it('ships a browser-safe contract helper graph with no Node built-ins', async () => {
    await expect(moduleClosure('src/contract/browser.mjs')).resolves.toBeInstanceOf(Set);
  });

  it('type-checks every public entry point in a strict TypeScript consumer', () => {
    const tsc = require.resolve('typescript/bin/tsc');
    const project = join(repoRootPath, 'tests/fixtures/typescript-consumer/tsconfig.json');
    expect(() => execFileSync(process.execPath, [tsc, '--project', project], {
      cwd: dirname(project),
      stdio: 'pipe',
    })).not.toThrow();
  });

  it('includes the complete consumer runtime import closure in an npm pack dry run', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'scrollcase-npm-pack-'));
    try {
      const npmCli = process.env.npm_execpath;
      if (!npmCli) throw new Error('npm_execpath is unavailable; run the suite through npm test.');
      const packed = JSON.parse(execFileSync(process.execPath, [
        npmCli,
        'pack',
        '--dry-run',
        '--json',
        '--ignore-scripts',
        '--cache',
        cache,
      ], {
        cwd: repoRootPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }));
      const packedFiles = new Set(packed[0].files.map((file) => file.path));
      const closure = await moduleClosure('src/consumer/index.mjs', new Set(), true);
      for (const url of closure) {
        const path = relative(repoRootPath, fileURLToPath(url)).replaceAll('\\', '/');
        expect(packedFiles.has(path), `${path} is missing from npm pack`).toBe(true);
      }
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  it('resolves the schema and fixture wildcards a mirror implementation relies on', async () => {
    const schema = await import('scrollcase/contract/schema/target.schema.json', { with: { type: 'json' } });
    const scroll = await import('scrollcase/contract/schema/scroll.schema.json', { with: { type: 'json' } });
    const fixture = await import('scrollcase/contract/fixtures/target-id-contract.json', { with: { type: 'json' } });
    expect(schema.default.$id).toMatch(/target\.schema\.json$/);
    expect(scroll.default.$id).toBe('https://scrollcase.dev/schema/v2/scroll.schema.json');
    expect(fixture.default.valid.length).toBeGreaterThan(0);
  });
});

describe('the generated contract types', () => {
  it('normalises platform line endings before checking generated source', () => {
    expect(normalizeGeneratedText('first\r\nsecond\rthird\n')).toBe('first\nsecond\nthird\n');
  });

  it('match the schemas they are generated from', () => {
    // Run the generator under Node itself instead of loading its CommonJS toolchain through
    // Vitest's transformer. Besides matching how contributors invoke it, this keeps collection
    // portable on Windows, where transforming that dependency graph failed before any test ran.
    const generator = fileURLToPath(new URL('../../scripts/generate-contract-types.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [generator, '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('declares a type for every document the format defines', async () => {
    const committed = await readFile(new URL('src/contract/types/index.d.ts', repoRoot), 'utf8');
    for (const name of [
      'BoxTarget',
      'BoxScroll',
      'BoxManifest',
      'BoxReleaseManifest',
      'BoxChannelManifest',
      'BoxRevocationsManifest',
      'SignedBoxDocument',
    ]) {
      expect(committed).toMatch(new RegExp(`^export (?:interface|type) ${name}\\b`, 'm'));
    }
  });
});

describe('the generated runtime declarations', () => {
  it('match the typed JavaScript implementation', () => {
    const generator = fileURLToPath(new URL('../../scripts/generate-runtime-types.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [generator, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
