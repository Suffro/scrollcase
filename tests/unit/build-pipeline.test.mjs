import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBox } from '../../src/build/box.mjs';
import { readRecipe } from '../../src/build/recipe.mjs';
import { verifyBox } from '../../src/build/verify.mjs';
import { configureWorkspace, resetWorkspace } from '../../src/build/workspace.mjs';
import { generateSigningKey } from '../../src/sign/index.mjs';
import { decodeDocumentPayload, documentKinds } from '../../src/contract/index.mjs';

const RECIPE = {
  schemaVersion: 1,
  recipeId: 'example-model-macos-arm64-metal',
  recipeVersion: '1.0.0',
  boxId: 'example-model',
  modelId: 'example-org-example-model',
  runtimeId: 'example-model-runtime',
  version: '1.0.0',
  sourceRevision: 'a'.repeat(40),
  target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
  compatibility: { minHostAppVersion: '1.0.0' },
  pythonVersion: '3.11.15',
  pixiVersion: '0.73.0',
  pythonEntryPoint: 'venv/bin/python',
  modelCacheSubdir: 'model-cache/example-model',
  assetBaseUrl: 'https://assets.example.org/boxes',
  assets: [],
  selfTest: { imports: ['json'], files: [] },
};

function writeDeep(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/**
 * Stands in for pixi, conda-pack and tar.
 *
 * Solving the environment is the one step that needs real external tools and a network, so it is
 * simulated by materialising the files each step is contracted to produce. Everything after it —
 * asset staging, pruning, the self-test gate, box.json, the deterministic archive, signing — is the
 * real implementation, which is what this test is here to exercise.
 */
function fakeToolchain(payloadDir) {
  const run = function run(command, args = []) {
    if (command === 'pixi' && args[0] === 'install') {
      const manifest = args[args.indexOf('--manifest-path') + 1];
      mkdirSync(join(dirname(manifest), '.pixi', 'envs', 'default', 'bin'), { recursive: true });
      return '';
    }
    if (command === 'conda-pack') {
      // conda-pack takes -p <prefix> -o <output>; reading the wrong flag would write the tarball to
      // whatever happened to be argument zero, which is how this fake once littered the repo root.
      const output = args[args.indexOf('-o') + 1];
      expect(output).toMatch(/pixi-env\.tar\.gz$/);
      writeDeep(output, 'fake-tarball');
      return '';
    }
    if (command === 'tar') {
      const venvDir = args[args.indexOf('-C') + 1];
      writeDeep(join(venvDir, 'bin', 'python'), '#!/bin/sh\nexit 0\n');
      writeDeep(join(venvDir, 'conda-meta', 'history'), '');
      return '';
    }
    // Anything else is the box's own interpreter, running the self-test.
    expect(command).toBe(join(payloadDir, 'venv', 'bin', 'python'));
    return '';
  };
  // Tool discovery probes `pixi --version` and `conda-pack --help` before anything is installed.
  const runResult = (command, args = []) => (command === 'pixi' && args[0] === '--version'
    ? { status: 0, stdout: 'pixi 0.73.0\n' }
    : { status: 0, stdout: '' });
  return { run, runResult };
}

const git = (root, ...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });

describe('the build pipeline', () => {
  const created = [];

  afterEach(async () => {
    resetWorkspace();
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  /** Lays out a project the way a user of the tool would have one: recipes in a git checkout. */
  async function makeProject(recipe = RECIPE, { commit = true, dirName = RECIPE.recipeId } = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-build-')));
    created.push(root);
    const recipeDir = join(root, 'recipes', dirName);
    await mkdir(recipeDir, { recursive: true });
    await writeFile(join(recipeDir, 'recipe.json'), `${JSON.stringify(recipe, null, 2)}\n`);
    await writeFile(join(recipeDir, 'pixi.toml'), '[project]\nname = "example-model"\n');
    await writeFile(join(recipeDir, 'pixi.lock'), 'version: 6\n');
    if (commit) {
      git(root, 'init', '--quiet');
      git(root, 'config', 'user.email', 'test@example.org');
      git(root, 'config', 'user.name', 'Test');
      git(root, 'add', '.');
      git(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'recipe');
    }
    configureWorkspace({ cwd: root });
    const keys = {
      privatePath: join(root, '.scrollcase', 'keys', 'signing-private.pem'),
      publicPath: join(root, '.scrollcase', 'keys', 'signing-public.json'),
    };
    await generateSigningKey(keys);
    return { root, recipeDir, keys, payloadDir: join(root, '.scrollcase', 'build', dirName, 'payload') };
  }

  it('rejects a recipe whose declared identity does not match where it lives', async () => {
    await makeProject({ ...RECIPE, recipeId: 'something-else' }, { commit: false });
    await expect(readRecipe(RECIPE.recipeId)).rejects.toThrow(/does not match directory/);
  });

  it('rejects a recipe with no pixi version, and one whose entry point defies its target', async () => {
    await makeProject({ ...RECIPE, pixiVersion: undefined }, { commit: false });
    await expect(readRecipe(RECIPE.recipeId)).rejects.toThrow(/does not declare a pixiVersion/);
    resetWorkspace();
    await makeProject({ ...RECIPE, pythonEntryPoint: 'venv/python.exe' }, { commit: false });
    await expect(readRecipe(RECIPE.recipeId)).rejects.toThrow(/entry point/);
  });

  it('builds, signs, and verifies a box end to end', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });

    // The archive is content-addressed, and the release commits to that exact hash.
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    expect(release.kind).toBe(documentKinds().release);
    expect(release.archive.sha256).toBe(built.archiveSha256);
    expect(release.archive.url).toContain(built.archiveSha256);
    expect(release.provenance.pixiVersion).toBe('0.73.0');
    expect(release.provenance.sourceTreeDirty).toBe(false);
    expect(release.provenance.builderRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(release.compatibility).toEqual(RECIPE.compatibility);
    expect(release.installedSizeBytes).toBeGreaterThan(0);
    // Embed is the default, and a self-contained box says nothing about assets to fetch.
    expect(release.weights).toBeUndefined();
    expect(release.assets).toBeUndefined();

    // The channel points at the release document by its own hash, closing the chain.
    const channel = decodeDocumentPayload(JSON.parse(await readFile(built.channelPath, 'utf8')));
    expect(channel.kind).toBe(documentKinds().channel);
    expect(channel.channel).toBe('beta');
    expect(channel.releases[0].releaseManifestUrl).toMatch(/\.release\.json$/);

    // And the result passes the checks an installing consumer would run.
    const receipt = await verifyBox(built.releasePath, { publicPath: keys.publicPath, log: () => {} });
    expect(receipt.status).toBe('passed');
    expect(receipt.localSignatureVerified).toBe(true);
    expect(receipt.archiveSha256).toBe(built.archiveSha256);
  });

  it('produces a byte-identical archive when the same commit is rebuilt', async () => {
    const { keys, payloadDir } = await makeProject();
    const first = await buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const second = await buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    expect(second.archiveSha256).toBe(first.archiveSha256);
  });

  it('refuses to build from a dirty tree unless that is made explicit', async () => {
    const { root, keys, payloadDir } = await makeProject();
    await writeFile(join(root, 'recipes', RECIPE.recipeId, 'pixi.toml'), '[project]\nname = "edited"\n');
    await expect(buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} }))
      .rejects.toThrow(/dirty source tree/);
    const built = await buildBox(RECIPE.recipeId, {
      ...keys, allowDirty: true, ...fakeToolchain(payloadDir), log: () => {},
    });
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    // The box says so rather than hiding it: that build is not reproducible from its revision alone.
    expect(release.provenance.sourceTreeDirty).toBe(true);
  });

  it('refuses to build where it cannot record the commit it came from', async () => {
    const { keys, payloadDir } = await makeProject(RECIPE, { commit: false });
    await expect(buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} }))
      .rejects.toThrow(/git checkout/);
  });

  it('fails the build when pruning removed a file the self-test needs', async () => {
    const recipe = { ...RECIPE, selfTest: { imports: ['json'], files: ['model-cache/weights.bin'] } };
    const { keys, payloadDir } = await makeProject(recipe);
    await expect(buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} }))
      .rejects.toThrow(/Missing self-test file/);
  });

  it('leaves assets out of the archive on demand, and carries their descriptors instead', async () => {
    const asset = {
      url: 'https://assets.example.org/weights.bin',
      relativePath: 'model-cache/example-model/weights.bin',
      sizeBytes: 4,
      sha256: 'b'.repeat(64),
    };
    const recipe = {
      ...RECIPE,
      assets: [asset],
      selfTest: { imports: ['json'], files: [asset.relativePath] },
    };
    const { keys, payloadDir } = await makeProject(recipe);
    // Nothing is downloaded: the fake toolchain would throw on an unexpected command, and the
    // self-test file that lives at the asset's path is legitimately absent from the payload.
    const built = await buildBox(RECIPE.recipeId, {
      ...keys, weights: 'on-demand', ...fakeToolchain(payloadDir), log: () => {},
    });
    expect(built.weights).toBe('on-demand');
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    expect(release.weights).toBe('on-demand');
    // The hash travels with the descriptor, which is what makes fetching it later safe.
    expect(release.assets).toEqual([asset]);
    await expect(verifyBox(built.releasePath, { publicPath: keys.publicPath, log: () => {} }))
      .resolves.toMatchObject({ status: 'passed' });
  });

  it('detects an archive that no longer matches its signed release', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    await writeFile(built.archivePath, 'tampered');
    await expect(verifyBox(built.releasePath, { publicPath: keys.publicPath, log: () => {} }))
      .rejects.toThrow(/Archive size mismatch|Archive SHA-256 mismatch/);
  });

  it('refuses a release signed by a key outside the trusted set', async () => {
    const { root, keys, payloadDir } = await makeProject();
    const built = await buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const stranger = {
      privatePath: join(root, 'other', 'private.pem'),
      publicPath: join(root, 'other', 'public.json'),
    };
    await generateSigningKey(stranger);
    await expect(verifyBox(built.releasePath, { publicPath: stranger.publicPath, log: () => {} }))
      .rejects.toThrow(/no valid signature/);
  });
});
