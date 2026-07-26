/**
 * Verifies the pinned pixi is installed. `build` and `lock` must use the same pixi the recipe was
 * pinned against, never whatever happens to be on PATH: a different resolver version can select
 * different packages and silently change the box.
 * `runResult` is injectable so a caller can drive discovery without a real pixi on PATH.
 *
 * @param {{ requiredVersion: string, path?: string | null, runResult?: typeof defaultRunResult }} options
 * @returns {string} the executable to invoke
 * @throws {Error} when pixi is absent or is not the pinned version
 */
export function findPixi({ requiredVersion, path, runResult }: {
    requiredVersion: string;
    path?: string | null;
    runResult?: typeof defaultRunResult;
}): string;
/**
 * Reports which pixi is available and at what version, without requiring a particular one.
 *
 * `findPixi` answers "is the pinned pixi here?"; this answers "is there a pixi at all?", which is
 * what `init` needs before it can offer to install one. Returns null when nothing runs.
 *
 * @param {{ path?: string | null, runResult?: typeof defaultRunResult }} [options]
 * @returns {{ path: string, version: string | null } | null} null when nothing runs
 */
export function probePixi({ path, runResult }?: {
    path?: string | null;
    runResult?: typeof defaultRunResult;
}): {
    path: string;
    version: string | null;
} | null;
/**
 * Reports whether conda-pack is available, and where. Returns null when nothing runs.
 *
 * @param {{ path?: string | null, runResult?: typeof defaultRunResult }} [options]
 * @returns {{ path: string } | null} null when nothing runs
 */
export function probeCondaPack({ path, runResult }?: {
    path?: string | null;
    runResult?: typeof defaultRunResult;
}): {
    path: string;
} | null;
/**
 * `lock` — resolves a recipe's pixi.toml into its committed pixi.lock without installing anything.
 * Run by a human when dependencies change; the lock is committed and reviewed, and `build` then
 * only installs from it. The manifest itself pins the channels and the single target platform, so
 * resolution is host-independent without any per-invocation platform flag.
 *
 * @param {string} manifestPath
 * @returns {string[]}
 */
export function pixiLockArguments(manifestPath: string): string[];
/**
 * `build` install — materializes the env from the committed lock, never re-resolving. `--frozen`
 * installs exactly the locked packages without touching or re-checking the lock, so what ships is
 * byte-for-byte what was reviewed: install-from-lock, never-resolve.
 * Lock freshness against the manifest is a separate CI `check` concern, not a build-time resolve.
 *
 * @param {string} manifestPath
 * @returns {string[]}
 */
export function pixiInstallArguments(manifestPath: string): string[];
/**
 * conda-pack arguments to pack an installed conda prefix into a relocatable tarball. The tarball
 * is extracted into the box as `venv/`; the embedded conda-unpack fixer is deliberately removed
 * rather than run (see installAndPackPixiEnvironment).
 *
 * @param {string} prefix
 * @param {string} outputPath
 * @returns {string[]}
 */
export function condaPackArguments(prefix: string, outputPath: string): string[];
/**
 * Verifies conda-pack is available. Its `--version` is unreliable (prints 0.0.0), so we only
 * confirm it runs; the exact version pin is recorded elsewhere (via the pixi global manifest).
 *
 * @param {{ path?: string | null, runResult?: typeof defaultRunResult }} [options]
 * @returns {string} the executable to invoke
 * @throws {Error} when conda-pack is absent
 */
export function findCondaPack({ path, runResult }?: {
    path?: string | null;
    runResult?: typeof defaultRunResult;
}): string;
/**
 * Builds the box's `venv/` prefix from a recipe's committed pixi.lock and packs it for relocation.
 *
 * Flow: install the exact locked env into an isolated workspace so pixi's `.pixi/envs` never
 * lands in the tracked recipe dir; conda-pack the prefix into a relocatable tarball; extract it
 * into `payloadDir/venv`; remove the service files that carry the build prefix (conda-unpack is
 * never run — see below); then dereference every symlink so the payload is link-free for the
 * archive layer. The multi-gigabyte workspace and tarball are removed before the payload is
 * archived.
 *
 * `run` is injected so this composes with the orchestrator's logging and error model.
 *
 * @param {{
 *   pixi: string,
 *   condaPack: string,
 *   manifestPath: string,
 *   lockPath: string,
 *   buildDir: string,
 *   payloadDir: string,
 *   adapter: import('../contract/targets.mjs').BoxTargetAdapter,
 *   run: typeof import('./process.mjs').run,
 * }} options
 * @returns {Promise<{ interpreter: string, prefix: string }>}
 */
export function installAndPackPixiEnvironment({ pixi, condaPack, manifestPath, lockPath, buildDir, payloadDir, adapter, run, }: {
    pixi: string;
    condaPack: string;
    manifestPath: string;
    lockPath: string;
    buildDir: string;
    payloadDir: string;
    adapter: import("../contract/targets.mjs").BoxTargetAdapter;
    run: typeof import("./process.mjs").run;
}): Promise<{
    interpreter: string;
    prefix: string;
}>;
import { runResult as defaultRunResult } from './process.mjs';
