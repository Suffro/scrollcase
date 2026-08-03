import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import * as tar from 'tar';
import yauzl from 'yauzl';
import { buildBox } from '../../src/build/box.mjs';
import { extractZipArchive, listZipEntries } from '../../src/build/archive.mjs';
import { collectFiles, fileExists, payloadDigest } from '../../src/build/filesystem.mjs';
import {
  PAYLOAD_DIGEST_FILE,
  PAYLOAD_DIGEST_FORMAT,
  parsePayloadDigestStream,
} from '../../src/contract/payload-digest.mjs';
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

// The two ZIP compression methods a box may use. Read straight from the archive rather than
// inferred from sizes, because "did this file get deflated" is exactly the claim under test.
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;

/** Maps every archived path to the compression method it was written with. */
async function zipCompressionMethods(archivePath) {
  const zip = await yauzl.openPromise(archivePath, { autoClose: false, lazyEntries: true });
  const methods = new Map();
  try {
    for await (const entry of zip.eachEntry()) {
      methods.set(entry.fileName, entry.compressionMethod);
    }
  } finally {
    await zip.close();
  }
  return methods;
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
function fakeToolchain(payloadDir, { module = null } = {}) {
  const run = function run(command, args = []) {
    if (command === 'pixi' && args[0] === 'install') {
      const manifest = args[args.indexOf('--manifest-path') + 1];
      const prefix = join(dirname(manifest), '.pixi', 'envs', 'default');
      writeDeep(join(prefix, ...ENTRY_SEGMENTS.slice(1)), '#!/bin/sh\nexit 0\n');
      writeDeep(join(prefix, 'conda-meta', 'history'), '==> 2026-07-27 05:29:00 <==\n');
      writeDeep(join(prefix, 'conda-meta', 'bzip2-1.0.8-hd037594_9.json'),
        `${JSON.stringify(CONDA_RECORD, null, 2)}\n`);
      if (module) {
        const modulePath = module.split('.');
        const sitePackages = HOST_ADAPTER.platform === 'windows'
          ? ['Lib', 'site-packages']
          : ['lib', `python${SCROLL.pythonVersion.split('.').slice(0, 2).join('.')}`, 'site-packages'];
        writeDeep(join(prefix, ...sitePackages, ...modulePath.slice(0, -1), `${modulePath.at(-1)}.py`),
          'print("module ready")\n');
      }
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
  async function makeProject(scroll = SCROLL, {
    commit = true,
    dirName = null,
    projectFiles = {},
  } = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-build-')));
    created.push(root);
    const resolvedDirName = dirName ?? `${scroll.boxId}/${boxTargetId(scroll.target)}`;
    const scrollDir = join(root, 'scrolls', resolvedDirName);
    await mkdir(scrollDir, { recursive: true });
    await writeFile(join(scrollDir, 'scroll.json'), `${JSON.stringify(scroll, null, 2)}\n`);
    await writeFile(join(scrollDir, 'pixi.toml'), '[project]\nname = "example-model"\n');
    await writeFile(join(scrollDir, 'pixi.lock'), 'version: 6\n');
    for (const [path, contents] of Object.entries(projectFiles)) {
      writeDeep(join(root, ...path.split('/')), contents);
    }
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
    const allCandidates = await scrollCandidates();
    expect(allCandidates.map(({ reference }) => reference))
      .toEqual([`${SCROLL.boxId}/${targetId}`]);
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

  it('reports a missing execution field before probing the toolchain', async () => {
    await makeProject({
      ...SCROLL,
      execution: {
        kind: 'python-script',
        defaultArgs: [],
      },
    }, { commit: false });
    await expect(readScroll(SCROLL_REF)).rejects.toThrow(/execution\.script is required/);
  });

  it('builds, signs, and verifies Python module execution metadata', async () => {
    const execution = {
      kind: 'python-module',
      module: 'example_model.main',
      defaultArgs: ['--serve'],
    };
    const { keys, payloadDir } = await makeProject({
      ...SCROLL,
      execution,
    });
    const built = await buildBox(SCROLL_REF, {
      ...keys,
      ...fakeToolchain(payloadDir, { module: execution.module }),
      log: () => {},
    });
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    expect(release.execution).toEqual(execution);
    await expect(verifyBox(built.releasePath, { publicPath: keys.publicPath, log: () => {} }))
      .resolves.toMatchObject({ status: 'passed' });
  });

  it('refuses a Python module absent from the built environment', async () => {
    const { keys, payloadDir } = await makeProject({
      ...SCROLL,
      execution: {
        kind: 'python-module',
        module: 'missing.main',
        defaultArgs: [],
      },
    });
    await expect(buildBox(SCROLL_REF, {
      ...keys,
      ...fakeToolchain(payloadDir),
      log: () => {},
    })).rejects.toThrow(/Execution module is not discoverable/);
  });

  it('builds a Python script only when its verified payload file survives pruning', async () => {
    const source = 'print("script ready")\n';
    const sha256 = createHash('sha256').update(source).digest('hex');
    const execution = {
      kind: 'python-script',
      script: 'app/main.py',
      defaultArgs: ['--serve'],
    };
    const scroll = {
      ...SCROLL,
      execution,
      localFiles: [{
        sourcePath: 'runtime/main.py',
        relativePath: execution.script,
        sha256,
      }],
    };
    const { keys, payloadDir } = await makeProject(scroll, {
      projectFiles: { 'runtime/main.py': source },
    });
    const built = await buildBox(SCROLL_REF, {
      ...keys,
      ...fakeToolchain(payloadDir),
      log: () => {},
    });
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    expect(release.execution).toEqual(execution);
    await expect(verifyBox(built.releasePath, { publicPath: keys.publicPath, log: () => {} }))
      .resolves.toMatchObject({ status: 'passed' });

    resetWorkspace();
    const pruned = { ...scroll, prunePaths: [execution.script] };
    const missing = await makeProject(pruned, {
      projectFiles: { 'runtime/main.py': source },
    });
    await expect(buildBox(SCROLL_REF, {
      ...missing.keys,
      ...fakeToolchain(missing.payloadDir),
      log: () => {},
    })).rejects.toThrow(/Execution script is missing/);
  });

  it('rejects malformed signed execution metadata before looking for an archive', async () => {
    const { root, keys, payloadDir } = await makeProject();
    const built = await buildBox(SCROLL_REF, {
      ...keys,
      ...fakeToolchain(payloadDir),
      log: () => {},
    });
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    const malformedPath = join(root, 'malformed.release.json');
    await writeFile(malformedPath, `${JSON.stringify(await signDocument({
      ...release,
      execution: {
        kind: 'python-module',
        module: 'example_model.main',
        defaultArgs: [42],
      },
    }, keys), null, 2)}\n`);

    await expect(verifyBox(malformedPath, { publicPath: keys.publicPath, log: () => {} }))
      .rejects.toThrow(/Invalid release manifest/);
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

  it('handles in-tree and escaping symlinks according to the host platform', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(SCROLL_REF, {
      ...keys,
      ...fakeToolchain(payloadDir),
      log: () => {},
    });

    const icu = join(payloadDir, 'venv', 'lib', 'icu');
    const isWindows = HOST_ADAPTER.platform === 'windows';

    const pkgdataPath = join(icu, 'pkgdata.inc');
    const pkgdataStat = await lstat(pkgdataPath);

    // Windows dereferences every symlink. Unix platforms preserve file symlinks.
    if (isWindows) {
      expect(pkgdataStat.isFile()).toBe(true);
      expect(pkgdataStat.isSymbolicLink()).toBe(false);
    } else {
      expect(pkgdataStat.isSymbolicLink()).toBe(true);
    }

    // The content must be readable in either case.
    expect(await readFile(pkgdataPath, 'utf8')).toBe('PKGDATA\n');

    // Directory symlinks are materialised on every platform.
    expect((await lstat(join(icu, 'current'))).isDirectory()).toBe(true);
    expect(await readFile(join(icu, 'current', 'pkgdata.inc'), 'utf8')).toBe('PKGDATA\n');

    // Escaping links are always dropped.
    expect(await fileExists(join(icu, 'escaped.inc'))).toBe(false);

    const entries = await listZipEntries(built.archivePath);

    expect(
      entries.some((entry) => entry.path.endsWith('outside-the-box.txt')),
    ).toBe(false);

    const pkgdataEntry = entries.find(
      (entry) => entry.path === 'venv/lib/icu/pkgdata.inc',
    );

    expect(pkgdataEntry).toBeDefined();

    if (isWindows) {
      // The dereferenced target reaches the archive as a regular file.
      expect(pkgdataEntry).toMatchObject({
        kind: 'file',
      });
    } else {
      // Unix platforms preserve the link and store its target.
      expect(pkgdataEntry).toMatchObject({
        kind: 'link',
        linkTarget: 'current/pkgdata.inc',
      });
    }
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

  it('stores declared weights instead of deflating them, and still rebuilds identically', async () => {
    // Incompressible on purpose: deflate makes this *larger*, which is the whole reason the rule
    // exists. Text elsewhere in the payload still compresses, so one archive proves both halves.
    const weights = randomBytes(64 * 1024);
    const corpus = randomBytes(32 * 1024);
    const asset = {
      url: 'https://assets.example.org/weights.bin',
      relativePath: 'model-cache/example-model/weights.bin',
      sizeBytes: weights.length,
      sha256: createHash('sha256').update(weights).digest('hex'),
    };
    const scroll = {
      ...SCROLL,
      assets: [asset],
      // Declared by path rather than downloaded: this is the half a project has to say out loud,
      // because Scrollcase cannot know a bundled directory holds compressed bytes.
      uncompressedPaths: ['corpus'],
      localFiles: [{
        sourcePath: 'bundled/corpus.bin',
        relativePath: 'corpus/data.bin',
        sha256: createHash('sha256').update(corpus).digest('hex'),
      }],
    };
    const { keys, payloadDir } = await makeProject(scroll, {
      projectFiles: { 'bundled/corpus.bin': corpus },
    });
    const fetchImpl = async () => ({ ok: true, status: 200, body: Readable.from([weights]) });
    const build = () => buildBox(SCROLL_REF, {
      ...keys,
      ...fakeToolchain(payloadDir),
      fetchImpl,
      log: () => {},
    });

    const built = await build();
    const methods = await zipCompressionMethods(built.archivePath);
    expect(methods.get(asset.relativePath)).toBe(ZIP_STORED);
    expect(methods.get('corpus/data.bin')).toBe(ZIP_STORED);
    // The interpreter and the box's own manifest are ordinary files and must still be compressed;
    // otherwise this rule would have quietly turned compression off for the whole box.
    expect(methods.get(HOST_ADAPTER.python.entryPoint)).toBe(ZIP_DEFLATED);
    expect(methods.get('box.json')).toBe(ZIP_DEFLATED);

    // Stored is only worth anything if the bytes come back exactly, so read them back out.
    const extracted = join(await mkdtemp(join(tmpdir(), 'scrollcase-stored-')), 'box');
    created.push(dirname(extracted));
    await extractZipArchive(built.archivePath, extracted);
    expect(await readFile(join(extracted, ...asset.relativePath.split('/')))).toEqual(weights);
    expect(await readFile(join(extracted, 'corpus', 'data.bin'))).toEqual(corpus);

    // The decision is taken from declared paths alone, so determinism survives it.
    expect((await build()).archiveSha256).toBe(built.archiveSha256);
  });

  it('commits to an entry list that describes the tree the archive extracts to', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    expect(release.payloadDigest.format).toBe(PAYLOAD_DIGEST_FORMAT);

    // The list ships inside the archive, so an installed box can be re-identified once the archive
    // is gone. Extract and hold the whole chain to the same standard a consumer would.
    const extracted = await mkdtemp(join(tmpdir(), 'scrollcase-digest-'));
    created.push(extracted);
    await extractZipArchive(built.archivePath, extracted);
    const listPath = join(extracted, PAYLOAD_DIGEST_FILE);
    expect(await fileExists(listPath)).toBe(true);
    expect(createHash('sha256').update(await readFile(listPath)).digest('hex'))
      .toBe(release.payloadDigest.sha256);

    // Recomputing from the extracted tree must reach the same value, which is the only thing that
    // proves the build-time walk and the install-time walk agree.
    expect(await payloadDigest(extracted)).toEqual(release.payloadDigest);

    // A file cannot carry its own hash, so the list names everything except itself — and the
    // release commits to it directly instead.
    const listed = parsePayloadDigestStream(await readFile(listPath));
    const paths = listed.map((entry) => entry.path);
    expect(paths).not.toContain(PAYLOAD_DIGEST_FILE);
    expect(paths).toContain('box.json');
    expect(paths).toContain(HOST_ADAPTER.python.entryPoint);
  });

  it('notices a payload byte that changed after the box was built', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    const extracted = await mkdtemp(join(tmpdir(), 'scrollcase-digest-'));
    created.push(extracted);
    await extractZipArchive(built.archivePath, extracted);

    const boxManifest = join(extracted, 'box.json');
    await writeFile(boxManifest, `${await readFile(boxManifest, 'utf8')} `);
    expect((await payloadDigest(extracted)).sha256).not.toBe(release.payloadDigest.sha256);
  });

  it('produces the same entry list when the same commit is rebuilt', async () => {
    const { keys, payloadDir } = await makeProject();
    const first = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const second = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const read = async (built) => decodeDocumentPayload(
      JSON.parse(await readFile(built.releasePath, 'utf8')),
    ).payloadDigest;
    expect(await read(second)).toEqual(await read(first));
  });

  it('produces a byte-identical archive when the same commit is rebuilt', async () => {
    const { keys, payloadDir } = await makeProject();
    const first = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const second = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    expect(second.archiveSha256).toBe(first.archiveSha256);
  });

  it('keeps execution metadata byte-identical across rebuilds', async () => {
    const execution = {
      kind: 'python-module',
      module: 'example_model.main',
      defaultArgs: ['--serve'],
    };
    const { keys, payloadDir } = await makeProject({ ...SCROLL, execution });
    const toolchain = () => fakeToolchain(payloadDir, { module: execution.module });
    const first = await buildBox(SCROLL_REF, { ...keys, ...toolchain(), log: () => {} });
    const second = await buildBox(SCROLL_REF, { ...keys, ...toolchain(), log: () => {} });
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

  it('re-checks the entry list against what the archive extracts to, under self-test', async () => {
    const { keys, payloadDir } = await makeProject();
    const built = await buildBox(SCROLL_REF, { ...keys, ...fakeToolchain(payloadDir), log: () => {} });
    const invocations = [];
    const receipt = await verifyBox(built.releasePath, {
      publicPath: keys.publicPath,
      selfTest: true,
      run: (command, args) => invocations.push({ command, args }),
      log: () => {},
    });
    expect(receipt.selfTest).toBe('passed');
    expect(invocations[0].command).toContain(HOST_ADAPTER.python.entryPoint.split('/').at(-1));

    // Re-sign the same archive under a digest it does not have. Every archive check still passes,
    // so this isolates the one comparison: the tree the archive extracts to is not the tree the
    // release commits to. It is the check that would have caught a broken build-time walk before
    // the box was ever published.
    const release = decodeDocumentPayload(JSON.parse(await readFile(built.releasePath, 'utf8')));
    await writeFile(built.releasePath, `${JSON.stringify(await signDocument({
      ...release,
      payloadDigest: { ...release.payloadDigest, sha256: 'f'.repeat(64) },
    }, keys), null, 2)}\n`);
    await expect(verifyBox(built.releasePath, {
      publicPath: keys.publicPath,
      selfTest: true,
      run: () => {},
      log: () => {},
    })).rejects.toThrow(/Extracted payload does not match the signed release/);
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
    ['execution', { kind: 'python-module', module: 'other.main', defaultArgs: [] }],
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
