/**
 * pixi + conda-forge builder helpers.
 *
 * This module owns the deterministic, side-effect-free pieces (tool discovery and exact argument
 * vectors) so they can be unit-tested; the orchestration that actually installs and packs a
 * prefix lives below in installAndPackPixiEnvironment, composed with an injected runner.
 *
 * Relocation model: build the env with pixi from the committed pixi.lock, pack it with
 * conda-pack, and extract it into the box as `venv/`. conda-pack already rewrites the build
 * prefix to a neutral placeholder, and a conda-forge prefix imports and runs from any location
 * with **no activation environment and no relocation fixer** (proven cold on macOS and Windows,
 * CPU + GPU). So conda-unpack is deliberately never run: doing so would bake the build machine's
 * path into the shipped box. A box needs no relocation step at install time.
 */

import { existsSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import * as tar from 'tar';
import { fail, runResult as defaultRunResult } from './process.mjs';
import { repairPosixLaunchers } from './launchers.mjs';
import { CONDA_PACK_VERSION, toolchainPaths } from './toolchain.mjs';
import { getWorkspace } from './workspace.mjs';

/**
 * Resolves a tool, highest precedence first: an explicit path, the environment override, a
 * toolchain the project installed for itself, and finally the bare name on PATH. The project-local
 * toolchain is looked up rather than configured so that `init --install-toolchain` is enough on its
 * own: nothing has to be added to PATH for the next command to find what was just installed.
 */
function toolCandidate({ path, environmentVariable, toolchainKey, name }) {
  if (path) return String(path);
  const fromEnvironment = process.env[environmentVariable];
  if (fromEnvironment) return String(fromEnvironment);
  let installed = null;
  try {
    installed = toolchainPaths(getWorkspace().toolchainDir)[toolchainKey];
  } catch {
    // No resolvable workspace (an unusual cwd, a test): fall through to PATH.
  }
  return installed && existsSync(installed) ? installed : name;
}

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
export function findPixi({ requiredVersion, path = null, runResult = defaultRunResult }) {
  const found = probePixi({ path, runResult });
  if (!found) {
    fail(`pixi ${requiredVersion} is required. Install it from https://pixi.sh/, run \`scrollcase init --install-toolchain\`, or pass --pixi <path>.`);
  }
  if (found.version !== requiredVersion) fail(`Recipe requires pixi ${requiredVersion}, found ${found.version}.`);
  return found.path;
}

/**
 * Reports which pixi is available and at what version, without requiring a particular one.
 *
 * `findPixi` answers "is the pinned pixi here?"; this answers "is there a pixi at all?", which is
 * what `init` needs before it can offer to install one. Returns null when nothing runs.
 *
 * @param {{ path?: string | null, runResult?: typeof defaultRunResult }} [options]
 * @returns {{ path: string, version: string | null } | null} null when nothing runs
 */
export function probePixi({ path = null, runResult = defaultRunResult } = {}) {
  const candidate = toolCandidate({
    path,
    environmentVariable: 'SCROLLCASE_PIXI',
    toolchainKey: 'pixi',
    name: 'pixi',
  });
  const result = runResult(candidate, ['--version'], { capture: true });
  if (result.error || result.status !== 0) return null;
  // `pixi --version` prints "pixi 0.x.y"; the version is the second token.
  return { path: candidate, version: String(result.stdout ?? '').trim().split(/\s+/)[1] ?? null };
}

/**
 * Reports whether conda-pack is available, and where. Returns null when nothing runs.
 *
 * @param {{ path?: string | null, runResult?: typeof defaultRunResult }} [options]
 * @returns {{ path: string } | null} null when nothing runs
 */
export function probeCondaPack({ path = null, runResult = defaultRunResult } = {}) {
  const candidate = toolCandidate({
    path,
    environmentVariable: 'SCROLLCASE_CONDA_PACK',
    toolchainKey: 'condaPack',
    name: 'conda-pack',
  });
  const result = runResult(candidate, ['--help'], { capture: true });
  return result.error || result.status !== 0 ? null : { path: candidate };
}

/**
 * `lock` — resolves a recipe's pixi.toml into its committed pixi.lock without installing anything.
 * Run by a human when dependencies change; the lock is committed and reviewed, and `build` then
 * only installs from it. The manifest itself pins the channels and the single target platform, so
 * resolution is host-independent without any per-invocation platform flag.
 *
 * @param {string} manifestPath
 * @returns {string[]}
 */
export function pixiLockArguments(manifestPath) {
  return ['lock', '--manifest-path', manifestPath];
}

/**
 * `build` install — materializes the env from the committed lock, never re-resolving. `--frozen`
 * installs exactly the locked packages without touching or re-checking the lock, so what ships is
 * byte-for-byte what was reviewed: install-from-lock, never-resolve.
 * Lock freshness against the manifest is a separate CI `check` concern, not a build-time resolve.
 *
 * @param {string} manifestPath
 * @returns {string[]}
 */
export function pixiInstallArguments(manifestPath) {
  return ['install', '--manifest-path', manifestPath, '--frozen'];
}

/**
 * conda-pack arguments to pack an installed conda prefix into a relocatable tarball. The tarball
 * is extracted into the box as `venv/`; the embedded conda-unpack fixer is deliberately removed
 * rather than run (see installAndPackPixiEnvironment).
 *
 * @param {string} prefix
 * @param {string} outputPath
 * @returns {string[]}
 */
export function condaPackArguments(prefix, outputPath) {
  return ['-p', prefix, '-o', outputPath, '--format', 'tar.gz'];
}

/**
 * Verifies conda-pack is available. Its `--version` is unreliable (prints 0.0.0), so we only
 * confirm it runs; the exact version pin is recorded elsewhere (via the pixi global manifest).
 *
 * @param {{ path?: string | null, runResult?: typeof defaultRunResult }} [options]
 * @returns {string} the executable to invoke
 * @throws {Error} when conda-pack is absent
 */
export function findCondaPack({ path = null, runResult = defaultRunResult } = {}) {
  const found = probeCondaPack({ path, runResult });
  if (!found) {
    fail(`conda-pack ${CONDA_PACK_VERSION} is required. Install it with \`scrollcase init --install-toolchain\` or \`pixi global install "conda-pack==${CONDA_PACK_VERSION}"\`, or pass --conda-pack <path>.`);
  }
  return found.path;
}

/**
 * Replaces every symbolic link under `root` with the real content it points to, so the payload
 * contains only regular files and directories.
 *
 * The box archive layer rejects links outright (collectFiles/normalizeTree/the ZIP writer). A conda
 * prefix is dense with symlinks (versioned dylibs, `bin` aliases), so they are materialized here
 * before the launcher repair walks the tree. Links that dangle or resolve outside the prefix are
 * dropped rather than pulling host files into the box.
 */
async function dereferenceSymlinksInPlace(root, current = root) {
  const canonicalRoot = await realpath(root);
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      let target;
      try {
        target = await realpath(path);
      } catch {
        await rm(path, { force: true }); // dangling link
        continue;
      }
      const insideTree = target === canonicalRoot
        || target.startsWith(`${canonicalRoot}${sep}`);
      let info;
      try {
        info = await stat(target);
      } catch {
        await rm(path, { force: true });
        continue;
      }
      if (!insideTree) {
        // A link escaping the prefix would drag a host file into the box; drop it instead.
        await rm(path, { force: true });
        continue;
      }
      await rm(path, { force: true });
      if (info.isDirectory()) {
        await cp(target, path, { recursive: true, dereference: true });
        await dereferenceSymlinksInPlace(root, path);
      } else {
        await copyFile(target, path);
        await chmod(path, info.mode & 0o777);
      }
    } else if (entry.isDirectory()) {
      await dereferenceSymlinksInPlace(root, path);
    }
  }
}

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
export async function installAndPackPixiEnvironment({
  pixi,
  condaPack,
  manifestPath,
  lockPath,
  buildDir,
  payloadDir,
  adapter,
  run,
}) {
  const workspace = join(buildDir, 'pixi-workspace');
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  // pixi installs from the manifest+lock sitting next to each other; stage both into the workspace
  // so the resulting `.pixi/envs/default` prefix is build-local, never inside the recipe.
  await copyFile(manifestPath, join(workspace, 'pixi.toml'));
  await copyFile(lockPath, join(workspace, 'pixi.lock'));
  run(pixi, pixiInstallArguments(join(workspace, 'pixi.toml')));
  const prefix = join(workspace, '.pixi', 'envs', 'default');

  const packPath = join(buildDir, 'pixi-env.tar.gz');
  await rm(packPath, { force: true });
  run(condaPack, condaPackArguments(prefix, packPath));

  const venvDir = join(payloadDir, 'venv');
  await rm(venvDir, { recursive: true, force: true });
  await mkdir(venvDir, { recursive: true });
  // conda-pack emits the prefix contents at the tar root, so extracting into `venv` yields the
  // conda layout (bin/, lib/, conda-meta/) directly under it. Use the pinned Node implementation
  // rather than a host `tar`: builds then have exactly the dependencies `doctor` reports, and the
  // archive behaves the same on macOS, Linux and Windows. Symlinks are expected in a conda prefix
  // and are deliberately handled by dereferenceSymlinksInPlace immediately below.
  await tar.x({
    file: packPath,
    cwd: venvDir,
    gzip: true,
    preservePaths: false,
    strict: true,
  });

  const interpreter = join(payloadDir, ...adapter.python.entryPoint.split('/'));
  // Deliberately do NOT run conda-unpack. conda-pack already replaces the build prefix with a
  // neutral placeholder, and the box imports and runs fine that way (a cold import from a moved
  // prefix was proven before any fixer). Running the fixer here would stamp the *build machine's*
  // absolute path into dozens of files that then ship to users — measured on a probe env: 0 files
  // carry the prefix before, 36 after — leaking a developer path while still being wrong at the
  // user's install location. Instead drop the few service files that do carry the build prefix.
  for (const servicePath of [
    ['conda-meta', 'pixi_env_prefix'],
    ['conda-meta', 'pixi'],
    ['bin', 'conda-unpack'],
    ['Scripts', 'conda-unpack.exe'],
    ['Scripts', 'conda-unpack-script.py'],
  ]) {
    await rm(join(venvDir, ...servicePath), { force: true });
  }
  // Order matters: dereference first, because the launcher repair walks the tree with collectFiles,
  // which rejects symbolic links outright (venv/bin ships aliases such as `2to3`).
  await dereferenceSymlinksInPlace(venvDir);
  // conda console scripts (tqdm, isympy, …) embed the absolute build interpreter in a shell
  // trampoline shebang. Rewrite them to resolve Python next to themselves, so no build path
  // ships inside the box.
  await repairPosixLaunchers(adapter, payloadDir, [prefix, workspace, payloadDir]);

  await rm(workspace, { recursive: true, force: true });
  await rm(packPath, { force: true });
  return { interpreter, venvDir, sitePackagesRelative: relative(payloadDir, venvDir) };
}
