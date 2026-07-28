/**
 * Installing the build toolchain, only when a human says so.
 *
 * `init` prepares a workspace without touching the network. When pixi or conda-pack is missing it
 * *offers* to install them and downloads nothing until an explicit yes. That consent is the design,
 * not a courtesy: a command that quietly fetched and ran a binary would be one nobody dares re-run,
 * and the whole point of `init` is that it is always safe to run again.
 *
 * What is downloaded is verified before it is used. The archive's SHA-256 is checked against the
 * checksum pixi publishes beside it, and the verified digest is then recorded in the project's
 * config, so every later install — a teammate's machine, CI — is checked against a value the
 * project reviewed rather than against whatever the server serves that day. A mismatch is a hard
 * failure: an unverified toolchain would undermine every guarantee built on top of it.
 *
 * The toolchain is installed inside the project, under the workspace's toolchain directory. Nothing
 * is placed on PATH, nothing is installed system-wide, and removing the directory undoes it.
 */

import { createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { extractScrollArchive } from './archive.mjs';
import { collectFiles, fileExists, sha256File } from './filesystem.mjs';
import { fail, run as defaultRun } from './process.mjs';

const PIXI_RELEASES = 'https://github.com/prefix-dev/pixi/releases';
const PIXI_LATEST_API = 'https://api.github.com/repos/prefix-dev/pixi/releases/latest';
const SHA256_TOKEN = /\b[a-f0-9]{64}\b/;

/**
 * One host-specific archive published by pixi.
 *
 * @typedef {object} PixiReleaseAsset
 * @property {string} asset
 * @property {'zip' | 'tar.gz'} format
 * @property {string} binary
 */

// conda-pack changes the bytes staged into a box, so letting the resolver select a newer release
// would make the same Scrollcase version produce a different payload over time. Keep the pin with
// the implementation that relies on its output; changing it is a reviewed Scrollcase release.
export const CONDA_PACK_VERSION = '0.9.2';

/**
 * The release asset for each host pixi publishes a build for, keyed by `platform/arch` as Node
 * reports them. A host outside this table is not a failure of the project — it just means the
 * toolchain has to be installed by hand.
 */
/** @type {Readonly<Record<string, Readonly<PixiReleaseAsset>>>} */
export const PIXI_RELEASE_ASSETS = Object.freeze({
  'darwin/arm64': Object.freeze({ asset: 'pixi-aarch64-apple-darwin.tar.gz', format: 'tar.gz', binary: 'pixi' }),
  'darwin/x64': Object.freeze({ asset: 'pixi-x86_64-apple-darwin.tar.gz', format: 'tar.gz', binary: 'pixi' }),
  'linux/x64': Object.freeze({ asset: 'pixi-x86_64-unknown-linux-musl.tar.gz', format: 'tar.gz', binary: 'pixi' }),
  'linux/arm64': Object.freeze({ asset: 'pixi-aarch64-unknown-linux-musl.tar.gz', format: 'tar.gz', binary: 'pixi' }),
  'win32/x64': Object.freeze({ asset: 'pixi-x86_64-pc-windows-msvc.zip', format: 'zip', binary: 'pixi.exe' }),
  'win32/arm64': Object.freeze({ asset: 'pixi-aarch64-pc-windows-msvc.zip', format: 'zip', binary: 'pixi.exe' }),
});

/**
 * Where the project keeps the tools it installed for itself.
 *
 * @param {string} toolchainDir
 * @returns {{ binDir: string, pixi: string, condaPack: string }}
 */
export function toolchainPaths(toolchainDir) {
  const binDir = join(toolchainDir, 'bin');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return {
    binDir,
    pixi: join(binDir, `pixi${suffix}`),
    condaPack: join(binDir, `conda-pack${suffix}`),
  };
}

/**
 * Returns the release asset for this host, or null when pixi publishes no build for it.
 *
 * @param {{ platform: string, arch: string }} [host]
 * @returns {Readonly<PixiReleaseAsset> | null}
 */
export function pixiReleaseAsset(host = process) {
  return PIXI_RELEASE_ASSETS[`${host.platform}/${host.arch}`] ?? null;
}

/**
 * The archive and checksum URLs for one pixi release.
 *
 * @param {string} version
 * @param {string} asset
 * @returns {{ archiveUrl: string, checksumUrl: string }}
 */
export function pixiAssetUrls(version, asset) {
  const base = `${PIXI_RELEASES}/download/v${version}/${asset}`;
  return { archiveUrl: base, checksumUrl: `${base}.sha256` };
}

/**
 * Reads the digest out of a published checksum file, which may or may not name the file beside it.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function parseChecksumFile(text) {
  const match = SHA256_TOKEN.exec(String(text).toLowerCase());
  if (!match) fail('Published pixi checksum file does not contain a SHA-256 digest.');
  return match[0];
}

/**
 * Resolves the newest pixi release, for a project that has not pinned a version yet.
 *
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<string>}
 */
export async function latestPixiVersion({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(PIXI_LATEST_API, { headers: { accept: 'application/vnd.github+json' } });
  if (!response.ok) fail(`Could not look up the latest pixi release (${response.status}).`);
  const tag = (await response.json())?.tag_name;
  if (typeof tag !== 'string' || !tag) fail('The pixi release feed returned no version.');
  return tag.replace(/^v/, '');
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) fail(`Download failed (${response.status}): ${url}`);
  return response.text();
}

async function fetchToFile(url, destination, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) fail(`Download failed (${response.status}): ${url}`);
  await pipeline(response.body, createWriteStream(destination));
}

/**
 * Downloads one pixi release and installs its binary into the project's toolchain directory.
 *
 * `expectedSha256` is the digest the project has already reviewed, when it has one; without it the
 * checksum published beside the archive is used and returned, so the caller can pin it. Either way
 * the bytes on disk are hashed and compared before anything is installed.
 *
 * @param {{
 *   version: string,
 *   toolchainDir: string,
 *   expectedSha256?: string | null,
 *   host?: { platform: string, arch: string },
 *   fetchImpl?: typeof fetch,
 *   log?: (message: string) => void,
 * }} options
 * @returns {Promise<{ path: string, version: string, sha256: string, asset: string }>}
 */
export async function installPixi({
  version,
  toolchainDir,
  expectedSha256 = null,
  host = process,
  fetchImpl = fetch,
  log = console.log,
}) {
  const release = pixiReleaseAsset(host);
  if (!release) {
    fail(`pixi publishes no build for ${host.platform}/${host.arch}; install it manually from https://pixi.sh/.`);
  }
  const { archiveUrl, checksumUrl } = pixiAssetUrls(version, release.asset);
  const staging = await mkdtemp(join(tmpdir(), 'scrollcase-toolchain-'));
  try {
    const expected = expectedSha256 ?? parseChecksumFile(await fetchText(checksumUrl, fetchImpl));
    log(`Downloading pixi ${version} (${release.asset})`);
    const archivePath = join(staging, release.asset);
    await fetchToFile(archiveUrl, archivePath, fetchImpl);

    const actual = await sha256File(archivePath);
    if (actual !== expected) {
      fail(`pixi ${version} failed its checksum: expected ${expected}, got ${actual}. Nothing was installed.`);
    }

    // Unpacked through the same guarded extractor the payload uses, so a hostile archive cannot
    // write outside the staging directory even though this one came from a known publisher.
    const unpacked = join(staging, 'unpacked');
    await extractScrollArchive(archivePath, release.format, unpacked);
    const entry = (await collectFiles(unpacked)).find((file) => file.split('/').pop() === release.binary);
    if (!entry) fail(`The pixi archive did not contain ${release.binary}.`);

    const { binDir, pixi } = toolchainPaths(toolchainDir);
    await mkdir(binDir, { recursive: true });
    await rm(pixi, { force: true });
    await rename(join(unpacked, ...entry.split('/')), pixi);
    if (process.platform !== 'win32') await chmod(pixi, 0o755);
    return { path: pixi, version, sha256: expected, asset: release.asset };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Installs conda-pack with the project's own pixi, into the project's own toolchain directory.
 *
 * `PIXI_HOME` points pixi at the toolchain directory, so the result lands beside pixi instead of in
 * the user's home. Integrity here is conda-forge's to provide: the package is resolved and verified
 * by pixi exactly as any other dependency is.
 *
 * @param {{
 *   pixi: string,
 *   toolchainDir: string,
 *   run?: typeof defaultRun,
 *   log?: (message: string) => void,
 * }} options
 * @returns {Promise<{ path: string, version: typeof CONDA_PACK_VERSION }>}
 */
export async function installCondaPack({ pixi, toolchainDir, run = defaultRun, log = console.log }) {
  log(`Installing conda-pack ${CONDA_PACK_VERSION} with pixi`);
  run(pixi, ['global', 'install', `conda-pack==${CONDA_PACK_VERSION}`], {
    env: { PIXI_HOME: toolchainDir },
  });
  const { condaPack } = toolchainPaths(toolchainDir);
  if (!await fileExists(condaPack)) {
    fail(`pixi reported success but ${condaPack} is missing.`);
  }
  return { path: condaPack, version: CONDA_PACK_VERSION };
}
