import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as tar from 'tar';
import { buildBox } from '../../src/build/box.mjs';
import { listZipEntries } from '../../src/build/archive.mjs';
import { collectFiles, fileExists } from '../../src/build/filesystem.mjs';
import { readRecipe, sourceBuildState } from '../../src/build/recipe.mjs';
import { assertBoxManifestAgreement, verifyBox } from '../../src/build/verify.mjs';
import { configureWorkspace, resetWorkspace } from '../../src/build/workspace.mjs';
import { generateSigningKey } from '../../src/sign/index.mjs';
import { boxTargetAdapters, decodeDocumentPayload, documentKinds } from '../../src/contract/index.mjs';

// The pipeline is the same on every platform, but the native-host gate (rightly) refuses to build
// a box for any other one — so the test recipe targets whatever host the suite is running on.
// `cpu` is the one accelerator every target supports without extra declarations.
const HOST_ADAPTER = boxTargetAdapters().find((adapter) =>
  adapter.host.platform === process.platform && adapter.host.arch === process.arch)
  ?? (() => { throw new Error(`No box target adapter for this host: ${process.platform}/${process.arch}`); })();

const RECIPE = {
  schemaVersion: 1,
  recipeId: 'example-model-native-cpu',
  recipeVersion: '1.0.0',
  boxId: 'example-model',
  modelId: 'example-org-example-model',
  runtimeId: 'example-model-runtime',
  version: '1.0.0',
  sourceRevision: 'a'.repeat(40),
  target: { platform: HOST_ADAPTER.platform, arch: HOST_ADAPTER.arch, accelerator: 'cpu' },
  compatibility: { minHostAppVersion: '1.0.0' },
  pythonVersion: '3.11.15',
  pixiVersion: '0.73.0',
  pythonEntryPoint: HOST_ADAPTER.python.entryPoint,
  modelCacheSubdir: 'model-cache/example-model',
  assetBaseUrl: 'https://assets.example.org/boxes',
  assets: [],
  selfTest: { imports: ['json'], files: [] },
};

// The interpreter's path inside the payload, split for platform-correct joins.
const ENTRY_SEGMENTS = HOST_ADAPTER.python.entryPoint.split('/');

function writeDeep(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/**
 * One of conda's per-package records, as the installer writes it.
 *
 * Three of these fields are why the payload cannot ship the record as found: `sha256_in_prefix`
 * appears on some installs of the identical lock and not others, the two `*_dir`/`*_path` fields
 * name the build machine's package cache, and `future_pixi_field` stands in for whatever a later
 * release starts writing — the case an allowlist has to survive and a denylist cannot.
 */
const CONDA_RECORD = {
  name: 'bzip2',
  version: '1.0.8',
  build: 'hd037594_9',
  build_number: 9,
  subdir: 'osx-arm64',
  depends: ['__osx >=11.0', 'libzlib >=1.3.2,<2.0a0'],
  license: 'bzip2-1.0.6',
  md5: '0f51e2391ade309db462a55611263e9c',
  timestamp: 1739822400000,
  extracted_package_dir: '/Users/somebody/.cache/rattler/pkgs/bzip2-1.0.8-hd037594_9',
  package_tarball_full_path: '/Users/somebody/.cache/rattler/pkgs/bzip2-1.0.8-hd037594_9.conda',
  paths_data: {
    paths: [{
      _path: 'bin/bzip2',
      path_type: 'hardlink',
      sha256: 'd5e2951edcc0388feda0726ee69b5ac079bf91e4bc79ce095b34a56b38db29b7',
      sha256_in_prefix: 'd5e2951edcc0388feda0726ee69b5ac079bf91e4bc79ce095b34a56b38db29b7',
    }],
  },
  future_pixi_field: { recorded: 'by a version of pixi that does not exist yet' },
};

/**
 * Plants the symlink shapes a real conda prefix carries, which a stub made only of regular files
 * would never exercise.
 *
 * The chain is icu's, verbatim: `current` points at the versioned directory, and `pkgdata.inc`
 * points *through* it. Extraction refuses to write through a link by default, so a prefix
 * containing this shape failed to unpack at all — and conda-forge started shipping it in a plain
 * `python` environment, where nothing in the recipe asks for icu.
 *
 * The escaping link is here to keep the fix honest: leaving the tree must still drop the link
 * rather than pull a host file into the box.
 */
function plantPrefixSymlinks(prefix) {
  writeDeep(join(prefix, 'lib', 'icu', '78.3', 'pkgdata.inc'), 'PKGDATA\n');
  symlinkSync('78.3', join(prefix, 'lib', 'icu', 'current'), 'dir');
  symlinkSync(join('current', 'pkgdata.inc'), join(prefix, 'lib', 'icu', 'pkgdata.inc'));
  symlinkSync(join('..', '..', '..', '..', 'outside-the-box.txt'), join(prefix, 'lib', 'icu', 'escaped.inc'));
}

/**
 * Stands in for pixi and conda-pack.
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
      const prefix = join(dirname(manifest), '.pixi', 'envs', 'default');
      writeDeep(join(prefix, ...ENTRY_SEGMENTS.slice(1)), '#!/bin/sh\nexit 0\n');
      writeDeep(join(prefix, 'conda-meta', 'history'), '==> 2026-07-27 05:29:00 <==\n');
      writeDeep(join(prefix, 'conda-meta', 'bzip2-1.0.8-hd037594_9.json'),
        `${JSON.stringify(CONDA_RECORD, null, 2)}\n`);
      plantPrefixSymlinks(prefix);
      return '';
    }
    if (command === 'conda-pack') {
      // conda-pack takes -p <prefix> -o <output>; reading the wrong flag would write the tarball to
      // whatever happened to be argument zero, which is how this fake once littered the repo root.
      const output = args[args.indexOf('-o') + 1];
      expect(output).toMatch(/pixi-env\.tar\.gz$/);
      const prefix = args[args.indexOf('-p') + 1];
      // The file the escaping link in the packed prefix points at. It exists, so a link that got
      // followed would copy a build-machine file into the box rather than merely dangle.
      writeDeep(join(dirname(output), 'outside-the-box.txt'), 'HOST SECRET\n');
      tar.c({ file: output, cwd: prefix, gzip: true, sync: true }, ['.']);
      return '';
    }
    // Anything else is the box's own interpreter, running the self-test.
    expect(command).toBe(join(payloadDir, ...ENTRY_SEGMENTS));
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
    await writeFile(join(root, '.gitignore'), '/.scrollcase/\n');
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
    await expect(readRecipe(RECIPE.recipeId)).rejects.toThrow(/pixiVersion is required/);
    resetWorkspace();
    // An entry point belonging to any *other* target must be refused on this one.
    const foreignEntryPoint = HOST_ADAPTER.platform === 'windows' ? 'venv/bin/python' : 'venv/python.exe';
    await makeProject({ ...RECIPE, pythonEntryPoint: foreignEntryPoint }, { commit: false });
    await expect(readRecipe(RECIPE.recipeId)).rejects.toThrow(/entry point/);
  });

  it.each([
    ['an identity the release schema cannot carry', { ...RECIPE, boxId: 'Example Model' }],
    ['an invalid nested asset field', {
      ...RECIPE,
      assets: [{
        url: 'https://assets.example.org/weights.bin',
        relativePath: 'model-cache/weights.bin',
        sizeBytes: 'four',
        sha256: 'a'.repeat(64),
      }],
    }],
    ['empty imports', { ...RECIPE, selfTest: { imports: [], files: [] } }],
    ['an escaping payload path', {
      ...RECIPE,
      assets: [{
        url: 'https://assets.example.org/weights.bin',
        relativePath: '../weights.bin',
        sizeBytes: 4,
        sha256: 'a'.repeat(64),
      }],
    }],
    ['an invalid parity threshold', {
      ...RECIPE,
      parity: {
        script: 'checks/parity.py',
        accelerators: ['cpu', 'cuda'],
        tolerances: { absolute: 0 },
      },
    }],
  ])('rejects %s against the complete recipe schema', async (_label, recipe) => {
    await makeProject(recipe, { commit: false });
    await expect(readRecipe(RECIPE.recipeId)).rejects.toThrow(/Invalid recipe/);
  });

  it('rejects structurally invalid input without probing a process or fetching', async () => {
    const { keys } = await makeProject({
      ...RECIPE,
      selfTest: { imports: [], files: [] },
    });
    const calls = [];
    await expect(buildBox(RECIPE.recipeId, {
      ...keys,
      run: (...args) => calls.push(['run', ...args]),
      runResult: (...args) => {
        calls.push(['runResult', ...args]);
        return { status: 0, stdout: '' };
      },
      fetchImpl: async (...args) => {
        calls.push(['fetch', ...args]);
        throw new Error('unexpected fetch');
      },
      log: () => {},
    })).rejects.toThrow(/Invalid recipe/);
    expect(calls).toEqual([]);
  });

  it('rejects an on-demand archive before probing tools, fetching, or mutating the build tree', async () => {
    const recipe = {
      ...RECIPE,
      weights: 'on-demand',
      assetArchives: [{
        relativePath: 'model-cache/weights.zip',
        format: 'zip',
        destination: 'model-cache',
      }],
    };
    const { keys, payloadDir } = await makeProject(recipe);
    const calls = [];
    await expect(buildBox(RECIPE.recipeId, {
      ...keys,
      run: (...args) => calls.push(['run', ...args]),
      runResult: (...args) => {
        calls.push(['runResult', ...args]);
        return { status: 0, stdout: '' };
      },
      fetchImpl: async (...args) => {
        calls.push(['fetch', ...args]);
        throw new Error('unexpected fetch');
      },
      log: () => {},
    })).rejects.toThrow(/on-demand weights cannot be combined with assetArchives/);
    expect(calls).toEqual([]);
    expect(await fileExists(payloadDir)).toBe(false);
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

  it('materialises a chained prefix symlink, and still refuses one that leaves the tree', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });

    // `pkgdata.inc -> current/pkgdata.inc -> 78.3/pkgdata.inc`: both hops resolved, real content.
    const icu = join(payloadDir, 'venv', 'lib', 'icu');
    expect(await readFile(join(icu, 'pkgdata.inc'), 'utf8')).toBe('PKGDATA\n');
    expect(await readFile(join(icu, 'current', 'pkgdata.inc'), 'utf8')).toBe('PKGDATA\n');
    // Nothing that is still a link may reach the archive, which rejects them outright.
    expect((await lstat(join(icu, 'pkgdata.inc'))).isSymbolicLink()).toBe(false);
    expect((await lstat(join(icu, 'current'))).isDirectory()).toBe(true);

    // The escaping link is dropped, and the host file it pointed at neither moves nor ships.
    expect(await fileExists(join(icu, 'escaped.inc'))).toBe(false);
    const entries = await listZipEntries(built.archivePath);
    expect(entries.some((entry) => entry.path.endsWith('outside-the-box.txt'))).toBe(false);
    expect(entries.some((entry) => entry.path === 'venv/lib/icu/pkgdata.inc')).toBe(true);
  });

  it('ships conda records reduced to identity, and nothing an install or a machine varies', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(RECIPE.recipeId, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });

    const metaDir = join(payloadDir, 'venv', 'conda-meta');
    const record = JSON.parse(await readFile(join(metaDir, 'bzip2-1.0.8-hd037594_9.json'), 'utf8'));
    // What the package is, taken verbatim — and nothing else, including a field invented here to
    // stand for one a later pixi might write.
    expect(record).toEqual({
      name: 'bzip2',
      version: '1.0.8',
      build: 'hd037594_9',
      build_number: 9,
      subdir: 'osx-arm64',
      depends: ['__osx >=11.0', 'libzlib >=1.3.2,<2.0a0'],
      license: 'bzip2-1.0.6',
    });
    // conda's own log is not a record and is dropped whole.
    expect(await fileExists(join(metaDir, 'history'))).toBe(false);

    // And nothing naming the build machine, or varying with the install, survives anywhere in the
    // payload — searched across every file rather than only the record it came from.
    const contents = await Promise.all((await collectFiles(payloadDir))
      .map((file) => readFile(join(payloadDir, ...file.split('/')), 'utf8').catch(() => '')));
    expect(contents.filter((text) => text.includes('/Users/somebody'))).toEqual([]);
    expect(contents.filter((text) => text.includes('sha256_in_prefix'))).toEqual([]);
    expect(built.installedSizeBytes).toBeGreaterThan(0);
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

  it('counts untracked inputs as dirty while ignoring generated workspace state', async () => {
    const { root } = await makeProject();
    expect(sourceBuildState(root)?.dirty).toBe(false);
    await mkdir(join(root, '.scrollcase', 'cache'), { recursive: true });
    await writeFile(join(root, '.scrollcase', 'cache', 'ignored.bin'), 'generated');
    expect(sourceBuildState(root)?.dirty).toBe(false);
    await writeFile(join(root, 'untracked-model.bin'), 'build input');
    expect(sourceBuildState(root)?.dirty).toBe(true);
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

describe('box manifest agreement', () => {
  const shared = {
    schemaVersion: 1,
    boxId: 'example-model',
    modelId: 'example-org-example-model',
    runtimeId: 'example-runtime',
    version: '1.0.0',
    target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
    pythonEntryPoint: 'venv/bin/python',
    modelCacheSubdir: 'model-cache/example-model',
    selfTest: { pythonImports: ['json'], timeoutSeconds: 180 },
    provenance: {
      recipeId: 'example-model-linux',
      recipeVersion: '1.0.0',
      builderRevision: 'a'.repeat(40),
      sourceTreeDirty: false,
      sourceRevision: 'b'.repeat(40),
      pythonVersion: '3.11.15',
      pixiVersion: '0.73.0',
      dependencyLockSha256: 'c'.repeat(64),
      builtAt: '2026-01-01T00:00:00Z',
    },
  };

  it.each([
    ['schemaVersion', 2],
    ['boxId', 'other-box'],
    ['modelId', 'other-model'],
    ['runtimeId', 'other-runtime'],
    ['version', '2.0.0'],
    ['target', { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.8' }],
    ['pythonEntryPoint', 'venv/python.exe'],
    ['modelCacheSubdir', 'other-cache'],
    ['selfTest', { pythonImports: ['math'], timeoutSeconds: 180 }],
    ['provenance', { ...shared.provenance, sourceTreeDirty: true }],
  ])('rejects a %s mismatch', (field, value) => {
    expect(() => assertBoxManifestAgreement({ ...shared, [field]: value }, shared))
      .toThrow(new RegExp(`box\\.json mismatch: ${field}`));
  });

  it('compares the complete on-demand asset policy', () => {
    const asset = {
      url: 'https://assets.example.org/weights.bin',
      relativePath: 'model-cache/example-model/weights.bin',
      sizeBytes: 4,
      sha256: 'd'.repeat(64),
    };
    const release = { ...shared, weights: 'on-demand', assets: [asset] };
    expect(() => assertBoxManifestAgreement({ ...release }, release)).not.toThrow();
    expect(() => assertBoxManifestAgreement({
      ...release,
      assets: [{ ...asset, sha256: 'e'.repeat(64) }],
    }, release)).toThrow(/box\.json mismatch: assets/);
    expect(() => assertBoxManifestAgreement({ ...shared }, release))
      .toThrow(/box\.json mismatch: weights/);
  });
});
