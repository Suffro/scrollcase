/**
 * Where the project keeps the tools it installed for itself.
 *
 * @param {string} toolchainDir
 * @returns {{ binDir: string, pixi: string, condaPack: string }}
 */
export function toolchainPaths(toolchainDir: string): {
    binDir: string;
    pixi: string;
    condaPack: string;
};
/**
 * Returns the release asset for this host, or null when pixi publishes no build for it.
 *
 * @param {{ platform: string, arch: string }} [host]
 * @returns {Readonly<PixiReleaseAsset> | null}
 */
export function pixiReleaseAsset(host?: {
    platform: string;
    arch: string;
}): Readonly<PixiReleaseAsset> | null;
/**
 * The archive and checksum URLs for one pixi release.
 *
 * @param {string} version
 * @param {string} asset
 * @returns {{ archiveUrl: string, checksumUrl: string }}
 */
export function pixiAssetUrls(version: string, asset: string): {
    archiveUrl: string;
    checksumUrl: string;
};
/**
 * Reads the digest out of a published checksum file, which may or may not name the file beside it.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function parseChecksumFile(text: unknown): string;
/**
 * Resolves the newest pixi release, for a project that has not pinned a version yet.
 *
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<string>}
 */
export function latestPixiVersion({ fetchImpl }?: {
    fetchImpl?: typeof fetch;
}): Promise<string>;
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
export function installPixi({ version, toolchainDir, expectedSha256, host, fetchImpl, log, }: {
    version: string;
    toolchainDir: string;
    expectedSha256?: string | null;
    host?: {
        platform: string;
        arch: string;
    };
    fetchImpl?: typeof fetch;
    log?: (message: string) => void;
}): Promise<{
    path: string;
    version: string;
    sha256: string;
    asset: string;
}>;
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
export function installCondaPack({ pixi, toolchainDir, run, log }: {
    pixi: string;
    toolchainDir: string;
    run?: typeof defaultRun;
    log?: (message: string) => void;
}): Promise<{
    path: string;
    version: typeof CONDA_PACK_VERSION;
}>;
/**
 * One host-specific archive published by pixi.
 *
 * @typedef {object} PixiReleaseAsset
 * @property {string} asset
 * @property {'zip' | 'tar.gz'} format
 * @property {string} binary
 */
export const CONDA_PACK_VERSION: "0.9.2";
/**
 * The release asset for each host pixi publishes a build for, keyed by `platform/arch` as Node
 * reports them. A host outside this table is not a failure of the project — it just means the
 * toolchain has to be installed by hand.
 */
/** @type {Readonly<Record<string, Readonly<PixiReleaseAsset>>>} */
export const PIXI_RELEASE_ASSETS: Readonly<Record<string, Readonly<PixiReleaseAsset>>>;
/**
 * One host-specific archive published by pixi.
 */
export type PixiReleaseAsset = {
    asset: string;
    format: "zip" | "tar.gz";
    binary: string;
};
import { run as defaultRun } from './process.mjs';
