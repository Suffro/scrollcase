import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as tar from 'tar';
import { buildBox } from '../../src/build/box.mjs';
import { listZipEntries } from '../../src/build/archive.mjs';
import { collectFiles, fileExists } from '../../src/build/filesystem.mjs';
import { boxReleaseStem } from '../../src/build/identity.mjs';
import { scrollCandidates, readScroll, sourceBuildState } from '../../src/build/scroll.mjs';
import { assertBoxManifestAgreement, verifyBox } from '../../src/build/verify.mjs';
import { configureWorkspace, resetWorkspace } from '../../src/build/workspace.mjs';
import { generateSigningKey, signDocument } from '../../src/sign/index.mjs';
import { boxTargetAdapters, boxTargetId, decodeDocumentPayload, documentKinds } from '../../src/contract/index.mjs';

// The pipeline is the same on every platform, but the native-host gate (rightly) refuses to build
// a box for any other one — so the test scroll targets whatever host the suite is running on.
// `cpu` is the one accelerator every target supports without extra declarations.
const HOST_ADAPTER = boxTargetAdapters().find((adapter) =>
  adapter.host.platform === process.platform && adapter.host.arch === process.arch)
  ?? (() => { throw new Error(`No box target adapter for this host: ${process.platform}/${process.arch}`); })();

const SCROLL = {
  schemaVersion: 2,
  scrollId: 'example-model-native-cpu',
  scrollVersion: '1.0.0',
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
const SCROLL_REF = `${SCROLL.boxId}/${boxTargetId(SCROLL.target)}`;

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
 * `python` environment, where nothing in the scroll asks for icu.
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

  /** Lays out a project the way a user of the tool would have one: scrolls in a git checkout. */
  async function makeProject(scroll = SCROLL, { commit = true, dirName = null } = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-build-')));
    created.push(root);
    const resolvedDirName = dirName ?? `${scroll.boxId}/${boxTargetId(scroll.target)}`;
    const scrollDir = join(root, 'scrolls', resolvedDirName);
    await mkdir(scrollDir, { recursive: true });
    await writeFile(join(scrollDir, 'scroll.json'), `${JSON.stringify(scroll, null, 2)}\n`);
    await writeFile(join(scrollDir, 'pixi.toml'), '[project]\nname = "example-model"\n');
    await writeFile(join(scrollDir, 'pixi.lock'), 'version: 6\n');
    await writeFile(join(root, '.gitignore'), '/.scrollcase/\n');
    if (commit) {
      git(root, 'init', '--quiet');
      git(root, 'config', 'user.email', 'test@example.org');
      git(root, 'config', 'user.name', 'Test');
      git(root, 'add', '.');
      git(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'scroll');
    }
    configureWorkspace({ cwd: root });
    const keys = {
      privatePath: join(root, '.scrollcase', 'keys', 'signing-private.pem'),
      publicPath: join(root, '.scrollcase', 'keys', 'signing-public.json'),
    };
    await generateSigningKey(keys);
    const scrollId = scroll.scrollId ?? `${scroll.boxId}-${boxTargetId(scroll.target)}`;
    return { root, scrollDir, keys, payloadDir: join(root, '.scrollcase', 'build', scrollId, 'payload') };
  }

  it('rejects the removed flat scroll layout', async () => {
    await makeProject(SCROLL, { commit: false, dirName: SCROLL.scrollId });
    await expect(readScroll(SCROLL.scrollId)).rejects.toThrow(/contains no target scrolls/);
  });

  it('loads a nested scroll from semantic box and target directories without a scrollId', async () => {
    const targetId = boxTargetId(SCROLL.target);
    const { scrollId: _scrollId, ...scrollWithoutId } = SCROLL;
    await makeProject(scrollWithoutId, { commit: false, dirName: `${SCROLL.boxId}/${targetId}` });

    const candidates = await scrollCandidates(SCROLL.boxId);
    expect(candidates.map(({ reference }) => reference)).toEqual([`${SCROLL.boxId}/${targetId}`]);
    const loaded = await readScroll(SCROLL.boxId);
    expect(loaded.reference).toBe(`${SCROLL.boxId}/${targetId}`);
    expect(loaded.scroll.scrollId).toBe(`${SCROLL.boxId}-${targetId}`);
  });

  it('requires an explicit target when a box contains several nested scrolls', async () => {
    const targetId = boxTargetId(SCROLL.target);
    const { scrollId: _scrollId, ...scrollWithoutId } = SCROLL;
    const { root } = await makeProject(scrollWithoutId, {
      commit: false,
      dirName: `${SCROLL.boxId}/${targetId}`,
    });
    const alternateTarget = SCROLL.target.platform === 'macos'
      ? { ...SCROLL.target, accelerator: 'metal' }
      : { ...SCROLL.target, accelerator: 'cuda', cudaVersion: '12.4' };
    const alternateTargetId = boxTargetId(alternateTarget);
    const alternateDir = join(root, 'scrolls', SCROLL.boxId, alternateTargetId);
    await mkdir(alternateDir, { recursive: true });
    await writeFile(join(alternateDir, 'scroll.json'), `${JSON.stringify({
      ...scrollWithoutId,
      target: alternateTarget,
    }, null, 2)}\n`);
    await writeFile(join(alternateDir, 'pixi.toml'), '[project]\nname = "alternate"\n');
    await writeFile(join(alternateDir, 'pixi.lock'), 'version: 6\n');

    await expect(readScroll(SCROLL.boxId)).rejects.toThrow(/multiple scroll targets/);
    const selected = await readScroll(SCROLL.boxId, { targetId: alternateTargetId });
    expect(selected.reference).toBe(`${SCROLL.boxId}/${alternateTargetId}`);
  });

  it('rejects a nested path whose box or target directory contradicts the scroll', async () => {
    const targetId = boxTargetId(SCROLL.target);
    await makeProject(SCROLL, { commit: false, dirName: `wrong-box/${targetId}` });
    await expect(readScroll('wrong-box')).rejects.toThrow(/box directory wrong-box.*boxId example-model/);

    resetWorkspace();
    await makeProject(SCROLL, { commit: false, dirName: `${SCROLL.boxId}/wrong-target` });
    await expect(readScroll(SCROLL.boxId)).rejects.toThrow(/target directory wrong-target.*target macos-|target directory wrong-target.*target linux-|target directory wrong-target.*target windows-/);
  });

  it('rejects a scroll with no pixi version, and one whose entry point defies its target', async () => {
    await makeProject({ ...SCROLL, pixiVersion: undefined }, { commit: false });
    await expect(readScroll(SCROLL_REF)).rejects.toThrow(/pixiVersion is required/);
    resetWorkspace();
    // An entry point belonging to any *other* target must be refused on this one.
    const foreignEntryPoint = HOST_ADAPTER.platform === 'windows' ? 'venv/bin/python' : 'venv/python.exe';
    await makeProject({ ...SCROLL, pythonEntryPoint: foreignEntryPoint }, { commit: false });
    await expect(readScroll(SCROLL_REF)).rejects.toThrow(/entry point/);
  });

  it.each([
    ['an identity the release schema cannot carry', { ...SCROLL, boxId: 'Example Model' }],
    ['an invalid nested asset field', {
      ...SCROLL,
      assets: [{
        url: 'https://assets.example.org/weights.bin',
        relativePath: 'model-cache/weights.bin',
        sizeBytes: 'four',
        sha256: 'a'.repeat(64),
      }],
    }],
    ['empty imports', { ...SCROLL, selfTest: { imports: [], files: [] } }],
    ['an escaping payload path', {
      ...SCROLL,
      assets: [{
        url: 'https://assets.example.org/weights.bin',
        relativePath: '../weights.bin',
        sizeBytes: 4,
        sha256: 'a'.repeat(64),
      }],
    }],
    ['an invalid parity threshold', {
      ...SCROLL,
      parity: {
        script: 'checks/parity.py',
        accelerators: ['cpu', 'cuda'],
        tolerances: { absolute: 0 },
      },
    }],
  ])('rejects %s against the complete scroll schema', async (_label, scroll) => {
    await makeProject(scroll, { commit: false, dirName: SCROLL_REF });
    await expect(readScroll(SCROLL_REF)).rejects.toThrow(/Invalid scroll/);
  });

  it('rejects structurally invalid input without probing a process or fetching', async () => {
    const { keys } = await makeProject({
      ...SCROLL,
      selfTest: { imports: [], files: [] },
    });
    const calls = [];
    await expect(buildBox(SCROLL_REF, {
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
    })).rejects.toThrow(/Invalid scroll/);
    expect(calls).toEqual([]);
  });

  it('refuses authored execution metadata until the execution-aware builder phase', async () => {
    const { keys } = await makeProject({
      ...SCROLL,
      execution: {
        kind: 'python-module',
        module: 'example_model.main',
        defaultArgs: [],
      },
    });
    const calls = [];
    await expect(buildBox(SCROLL_REF, {
      ...keys,
      runResult: (...args) => {
        calls.push(args);
        return { status: 0, stdout: '' };
      },
      log: () => {},
    })).rejects.toThrow(/execution-aware builder is not available yet/);
    expect(calls).toEqual([]);
  });

  it('rejects a channel outside the v2 contract before tool discovery', async () => {
    const { keys } = await makeProject();
    const calls = [];
    await expect(buildBox(SCROLL_REF, {
      ...keys,
      channel: 'internal',
      runResult: (...args) => calls.push(args),
      log: () => {},
    })).rejects.toThrow(/Unsupported channel/);
    expect(calls).toEqual([]);
  });

  it('rejects an on-demand archive before probing tools, fetching, or mutating the build tree', async () => {
    const scroll = {
      ...SCROLL,
      weights: 'on-demand',
      assetArchives: [{
        relativePath: 'model-cache/weights.zip',
        format: 'zip',
        destination: 'model-cache',
      }],
    };
    const { keys, payloadDir } = await makeProject(scroll);
    const calls = [];
    await expect(buildBox(SCROLL_REF, {
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
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });

    // The archive is content-addressed, and the release commits to that exact hash.
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    expect(release.kind).toBe(documentKinds().release);
    expect(release.archive.sha256).toBe(built.archiveSha256);
    expect(release.archive.url).toContain(built.archiveSha256);
    expect(release.provenance.pixiVersion).toBe('0.73.0');
    expect(release.provenance.sourceTreeDirty).toBe(false);
    expect(release.provenance.builderRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(release.compatibility).toEqual(SCROLL.compatibility);
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

  it('rejects a signed v1 release payload even inside a valid v2 envelope', async () => {
    const { root, keys } = await makeProject();
    const releasePath = join(root, 'v1.release.json');
    const signed = await signDocument({
      schemaVersion: 1,
      kind: documentKinds().release,
    }, keys);
    await writeFile(releasePath, `${JSON.stringify(signed, null, 2)}\n`);

    await expect(verifyBox(releasePath, { publicPath: keys.publicPath, log: () => {} }))
      .rejects.toThrow('Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.');
  });

  it('does not fall back to the pre-v2 stem-based archive name', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const oldArchivePath = join(dirname(built.releasePath), `${boxReleaseStem(SCROLL)}.zip`);
    await rename(built.archivePath, oldArchivePath);

    await expect(verifyBox(built.releasePath, { publicPath: keys.publicPath, log: () => {} }))
      .rejects.toThrow(`Archive not found: ${built.archivePath}`);
  });

  it('materialises a chained prefix symlink, and still refuses one that leaves the tree', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });

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
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });

    const metaDir = join(payloadDir, 'venv', 'conda-meta');
    const record = JSON.parse(await readFile(join(metaDir, 'bzip2-1.0.8-hd037594_9.json'), 'utf8'));
    // What the package is, taken verbatim — and nothing else, including a field invented here to
    // stand for one a later pixi might write.
    expect(record).toEqual({
      name: 'bzip2',
      version: '1.0.8',
      build: 'hd037594_9',
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

  it('lays dist out as the two things a publisher uploads, with nothing written twice', async () => {
    const { root, keys, payloadDir } = await makeProject();
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const dist = join(root, '.scrollcase', 'dist');

    // Everything under dist is either a box object or a channel pointer — no third category, and
    // no second copy of the archive under a friendlier name.
    const files = await collectFiles(dist);
    const objectPrefix = `boxes/${SCROLL.boxId}/${SCROLL.version}/${boxTargetId(SCROLL.target)}`;
    expect(files).toHaveLength(3);
    expect(files).toContain(`${objectPrefix}/${built.archiveSha256}.zip`);
    expect(files).toContain(`channels/${SCROLL.boxId}/beta/${boxTargetId(SCROLL.target)}.json`);
    expect(files.filter((file) =>
      new RegExp(`(${objectPrefix}\/[a-f0-9]{64}.release.json)`).test(file))).toHaveLength(1);

    // The object path is the one the signed documents publish under, so uploading dist/boxes as it
    // stands puts every object exactly where its own URL already says it is.
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    const objectKey = relative(dist, built.archivePath).split(sep).join('/');
    expect(release.archive.url).toBe(`${SCROLL.assetBaseUrl}/${objectKey}`);

    // And a release verifies where it lands, without being told where its archive is.
    const receipt = await verifyBox(built.releasePath, { publicPath: keys.publicPath, log: () => {} });
    expect(receipt.status).toBe('passed');
  });

  it('produces a byte-identical archive when the same commit is rebuilt', async () => {
    const { keys, payloadDir } = await makeProject();
    const first = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const second = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    expect(second.archiveSha256).toBe(first.archiveSha256);
  });

  it('refuses to build from a dirty tree unless that is made explicit', async () => {
    const { root, keys, payloadDir } = await makeProject();
    await writeFile(join(root, 'scrolls', ...SCROLL_REF.split('/'), 'pixi.toml'), '[project]\nname = "edited"\n');
    await expect(buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} }))
      .rejects.toThrow(/dirty source tree/);
    const built = await buildBox(SCROLL_REF, {
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
    const { keys, payloadDir } = await makeProject(SCROLL, { commit: false });
    await expect(buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} }))
      .rejects.toThrow(/git checkout/);
  });

  it('fails the build when pruning removed a file the self-test needs', async () => {
    const scroll = { ...SCROLL, selfTest: { imports: ['json'], files: ['model-cache/weights.bin'] } };
    const { keys, payloadDir } = await makeProject(scroll);
    await expect(buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} }))
      .rejects.toThrow(/Missing self-test file/);
  });

  it('leaves assets out of the archive on demand, and carries their descriptors instead', async () => {
    const asset = {
      url: 'https://assets.example.org/weights.bin',
      relativePath: 'model-cache/example-model/weights.bin',
      sizeBytes: 4,
      sha256: 'b'.repeat(64),
    };
    const scroll = {
      ...SCROLL,
      assets: [asset],
      selfTest: { imports: ['json'], files: [asset.relativePath] },
    };
    const { keys, payloadDir } = await makeProject(scroll);
    // Nothing is downloaded: the fake toolchain would throw on an unexpected command, and the
    // self-test file that lives at the asset's path is legitimately absent from the payload.
    const built = await buildBox(SCROLL_REF, {
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
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    await writeFile(built.archivePath, 'tampered');
    await expect(verifyBox(built.releasePath, { publicPath: keys.publicPath, log: () => {} }))
      .rejects.toThrow(/Archive size mismatch|Archive SHA-256 mismatch/);
  });

  it('refuses a release signed by a key outside the trusted set', async () => {
    const { root, keys, payloadDir } = await makeProject();
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
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
    schemaVersion: 2,
    boxId: 'example-model',
    modelId: 'example-org-example-model',
    runtimeId: 'example-runtime',
    version: '1.0.0',
    target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
    pythonEntryPoint: 'venv/bin/python',
    modelCacheSubdir: 'model-cache/example-model',
    selfTest: { pythonImports: ['json'], timeoutSeconds: 180 },
    provenance: {
      scrollId: 'example-model-linux',
      scrollVersion: '1.0.0',
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
    ['schemaVersion', 1],
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
