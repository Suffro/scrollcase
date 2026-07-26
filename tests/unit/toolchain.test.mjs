import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as tar from 'tar';
import { fileExists } from '../../src/build/filesystem.mjs';
import { ensureToolchain, initProject } from '../../src/build/project.mjs';
import {
  CONDA_PACK_VERSION,
  installCondaPack,
  installPixi,
  parseChecksumFile,
  pixiAssetUrls,
  pixiReleaseAsset,
  toolchainPaths,
} from '../../src/build/toolchain.mjs';
import { resetWorkspace } from '../../src/build/workspace.mjs';

const TARGET = { platform: 'macos', arch: 'aarch64', accelerator: 'metal' };
const HOST = { platform: 'darwin', arch: 'arm64' };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const created = [];
afterEach(async () => {
  resetWorkspace();
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function scratch(prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  created.push(path);
  return path;
}

/** Builds a tar.gz holding a stand-in pixi binary, the shape the real release ships. */
async function fakePixiRelease() {
  const staging = await scratch('scrollcase-release-');
  await writeFile(join(staging, 'pixi'), '#!/bin/sh\necho "pixi 9.9.9"\n');
  const archivePath = join(staging, 'pixi.tar.gz');
  await tar.c({ file: archivePath, cwd: staging, gzip: true }, ['pixi']);
  return { archivePath, bytes: await readFile(archivePath) };
}

/** A fetch that serves one archive and its checksum, and records what was asked for. */
function servedBy({ bytes, digest, requests = [] }) {
  return async (url) => {
    requests.push(String(url));
    if (String(url).endsWith('.sha256')) {
      return { ok: true, status: 200, text: async () => `${digest}  pixi-aarch64-apple-darwin.tar.gz\n` };
    }
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(bytes));
          controller.close();
        },
      }),
    };
  };
}

describe('resolving the pixi release for a host', () => {
  it('names the published asset for each supported host', () => {
    expect(pixiReleaseAsset({ platform: 'darwin', arch: 'arm64' }).asset).toBe('pixi-aarch64-apple-darwin.tar.gz');
    expect(pixiReleaseAsset({ platform: 'linux', arch: 'x64' }).asset).toBe('pixi-x86_64-unknown-linux-musl.tar.gz');
    expect(pixiReleaseAsset({ platform: 'win32', arch: 'x64' })).toMatchObject({
      asset: 'pixi-x86_64-pc-windows-msvc.zip',
      format: 'zip',
      binary: 'pixi.exe',
    });
  });

  it('returns null for a host pixi publishes nothing for, rather than guessing a URL', () => {
    expect(pixiReleaseAsset({ platform: 'sunos', arch: 'sparc' })).toBeNull();
  });

  it('builds the release URLs from the version', () => {
    const { archiveUrl, checksumUrl } = pixiAssetUrls('0.73.0', 'pixi-aarch64-apple-darwin.tar.gz');
    expect(archiveUrl).toBe('https://github.com/prefix-dev/pixi/releases/download/v0.73.0/pixi-aarch64-apple-darwin.tar.gz');
    expect(checksumUrl).toBe(`${archiveUrl}.sha256`);
  });

  it('reads the digest whether or not the checksum file names the file', () => {
    const digest = 'a'.repeat(64);
    expect(parseChecksumFile(`${digest}\n`)).toBe(digest);
    expect(parseChecksumFile(`${digest.toUpperCase()}  pixi.tar.gz\n`)).toBe(digest);
    expect(() => parseChecksumFile('not a digest')).toThrow(/does not contain a SHA-256/);
  });
});

describe('installing pixi', () => {
  it('verifies the download and installs the binary where scrollcase looks for it', async () => {
    const toolchainDir = await scratch('scrollcase-toolchain-');
    const { bytes } = await fakePixiRelease();
    const requests = [];
    const result = await installPixi({
      version: '0.73.0',
      toolchainDir,
      host: HOST,
      fetchImpl: servedBy({ bytes, digest: sha256(bytes), requests }),
      log: () => {},
    });

    expect(result.sha256).toBe(sha256(bytes));
    expect(result.path).toBe(toolchainPaths(toolchainDir).pixi);
    expect(await fileExists(result.path)).toBe(true);
    // The checksum is fetched before the archive: nothing is written before there is something to
    // check it against.
    expect(requests[0]).toMatch(/\.sha256$/);
    if (process.platform !== 'win32') {
      expect((await stat(result.path)).mode & 0o111).toBeGreaterThan(0);
    }
  });

  it('refuses a download whose checksum does not match, and installs nothing', async () => {
    const toolchainDir = await scratch('scrollcase-toolchain-');
    const { bytes } = await fakePixiRelease();
    await expect(installPixi({
      version: '0.73.0',
      toolchainDir,
      host: HOST,
      // The digest of different bytes: what a tampered or corrupted mirror would produce.
      fetchImpl: servedBy({ bytes, digest: sha256(Buffer.from('something else')) }),
      log: () => {},
    })).rejects.toThrow(/failed its checksum/);
    expect(await fileExists(toolchainPaths(toolchainDir).pixi)).toBe(false);
  });

  it('checks against the pinned digest instead of asking the server', async () => {
    const toolchainDir = await scratch('scrollcase-toolchain-');
    const { bytes } = await fakePixiRelease();
    const requests = [];
    await installPixi({
      version: '0.73.0',
      toolchainDir,
      expectedSha256: sha256(bytes),
      host: HOST,
      fetchImpl: servedBy({ bytes, digest: 'ignored', requests }),
      log: () => {},
    });
    // A pinned project never consults the published checksum, so a changed one cannot be adopted.
    expect(requests.some((url) => url.endsWith('.sha256'))).toBe(false);
  });
});

describe('installing conda-pack', () => {
  it('pins the packer version that this Scrollcase release was verified against', async () => {
    const toolchainDir = await scratch('scrollcase-conda-pack-');
    const expected = toolchainPaths(toolchainDir).condaPack;
    const calls = [];
    const result = await installCondaPack({
      pixi: '/tools/pixi',
      toolchainDir,
      run(command, args, options) {
        calls.push({ command, args, options });
        mkdirSync(dirname(expected), { recursive: true });
        writeFileSync(expected, 'stand-in');
      },
      log: () => {},
    });

    expect(calls).toEqual([{
      command: '/tools/pixi',
      args: ['global', 'install', `conda-pack==${CONDA_PACK_VERSION}`],
      options: { env: { PIXI_HOME: toolchainDir } },
    }]);
    expect(result).toEqual({ path: expected, version: CONDA_PACK_VERSION });
  });
});

describe('offering the toolchain during init', () => {
  const presentTools = (available) => (command, args = []) => {
    if (command.endsWith('pixi') || command === 'pixi') {
      return available.pixi ? { status: 0, stdout: `pixi ${available.pixi}\n` } : { status: 127, error: new Error('ENOENT') };
    }
    return available.condaPack ? { status: 0, stdout: '' } : { status: 127, error: new Error('ENOENT') };
  };

  async function project() {
    const root = await scratch('scrollcase-init-');
    const result = await initProject({ root, target: TARGET });
    return { root, ...result, workspace: { root, toolchainDir: join(root, '.scrollcase', 'toolchain') } };
  }

  it('downloads nothing when the answer is no', async () => {
    const { workspace, root } = await project();
    const outcome = await ensureToolchain({
      workspace,
      confirm: async () => false,
      runResult: presentTools({ pixi: null, condaPack: false }),
      fetchImpl: async () => { throw new Error('the network must not be touched'); },
      log: () => {},
    });
    expect(outcome.declined).toBe(true);
    expect(outcome.installed).toEqual([]);
    expect(outcome.missing).toEqual(['pixi', 'conda-pack']);
    expect(await fileExists(join(root, '.scrollcase', 'toolchain'))).toBe(false);
  });

  it('asks only for what is missing, and pins the recipe without asking when both are present', async () => {
    const { workspace, recipeDir } = await project();
    const asked = [];
    const outcome = await ensureToolchain({
      workspace,
      recipePath: join(recipeDir, 'recipe.json'),
      confirm: async (missing) => { asked.push(missing); return false; },
      runResult: presentTools({ pixi: '0.73.0', condaPack: true }),
      fetchImpl: async () => { throw new Error('the network must not be touched'); },
      log: () => {},
    });
    expect(asked).toEqual([]);
    expect(outcome.missing).toEqual([]);
    expect(outcome.pixiVersion).toBe('0.73.0');
    expect(outcome.pinnedRecipe).toBe(true);
    const recipe = JSON.parse(await readFile(join(recipeDir, 'recipe.json'), 'utf8'));
    expect(recipe.pixiVersion).toBe('0.73.0');
  });

  it('records both managed toolchain pins and pins the recipe after installation', async () => {
    const { workspace, root, recipeDir } = await project();
    const { bytes } = await fakePixiRelease();
    const condaPackPath = toolchainPaths(workspace.toolchainDir).condaPack;
    const outcome = await ensureToolchain({
      workspace,
      pixiVersion: '0.73.0',
      recipePath: join(recipeDir, 'recipe.json'),
      confirm: async () => true,
      host: HOST,
      runResult: presentTools({ pixi: null, condaPack: false }),
      run(command, args, options) {
        expect(command).toBe(toolchainPaths(workspace.toolchainDir).pixi);
        expect(args).toEqual(['global', 'install', `conda-pack==${CONDA_PACK_VERSION}`]);
        expect(options).toEqual({ env: { PIXI_HOME: workspace.toolchainDir } });
        mkdirSync(dirname(condaPackPath), { recursive: true });
        writeFileSync(condaPackPath, 'stand-in');
      },
      fetchImpl: servedBy({ bytes, digest: sha256(bytes) }),
      log: () => {},
    });

    expect(outcome.installed).toEqual(['pixi 0.73.0', `conda-pack ${CONDA_PACK_VERSION}`]);
    const config = JSON.parse(await readFile(join(root, 'scrollcase.config.json'), 'utf8'));
    expect(config.toolchain.pixi.version).toBe('0.73.0');
    expect(config.toolchain.pixi.assets['pixi-aarch64-apple-darwin.tar.gz']).toBe(sha256(bytes));
    expect(config.toolchain.condaPack).toEqual({ version: CONDA_PACK_VERSION });
    // The scaffolded recipe carried no pin; it now names the pixi that was actually installed.
    const recipe = JSON.parse(await readFile(join(recipeDir, 'recipe.json'), 'utf8'));
    expect(recipe.pixiVersion).toBe('0.73.0');
    expect(outcome.pinnedRecipe).toBe(true);
  });

  it('installs the requested pixi when a different resolver version is already present', async () => {
    const { workspace, recipeDir } = await project();
    const { bytes } = await fakePixiRelease();
    const outcome = await ensureToolchain({
      workspace,
      pixiVersion: '0.73.0',
      recipePath: join(recipeDir, 'recipe.json'),
      confirm: async (missing) => {
        expect(missing).toEqual(['pixi']);
        return true;
      },
      host: HOST,
      runResult: presentTools({ pixi: '0.72.0', condaPack: true }),
      fetchImpl: servedBy({ bytes, digest: sha256(bytes) }),
      log: () => {},
    });

    expect(outcome.installed).toEqual(['pixi 0.73.0']);
    expect(outcome.pixiVersion).toBe('0.73.0');
    const recipe = JSON.parse(await readFile(join(recipeDir, 'recipe.json'), 'utf8'));
    expect(recipe.pixiVersion).toBe('0.73.0');
  });

  it('reports an unsupported host instead of downloading a guessed URL', async () => {
    const { workspace } = await project();
    const outcome = await ensureToolchain({
      workspace,
      confirm: async () => true,
      host: { platform: 'sunos', arch: 'sparc' },
      runResult: presentTools({ pixi: null, condaPack: false }),
      fetchImpl: async () => { throw new Error('the network must not be touched'); },
      log: () => {},
    });
    expect(outcome.unsupportedHost).toBe('sunos/sparc');
    expect(outcome.installed).toEqual([]);
  });
});
