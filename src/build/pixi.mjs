/**
 * pixi + conda-forge builder helpers for the box migration.
 *
 * This module is the pixi-substrate counterpart of the uv helpers in python.mjs/targets.mjs. It
 * owns only the deterministic, side-effect-free pieces (tool discovery and exact argument vectors)
 * so they can be unit-tested; the orchestration that actually installs and packs a prefix lives in
 * runtime-box.mjs, which composes these with process.run.
 *
 * Relocation model (Phase 0 spike + the Phase 2 measurement, see project-knowledge-base/roadmap/
 * runtime-box-pixi-phase0-spike.md): build the env with pixi from the committed pixi.lock, pack it
 * with conda-pack, and extract it into the box as `venv/`. conda-pack already rewrites the build
 * prefix to a neutral placeholder, and a conda-forge prefix imports and runs from any location with
 * **no activation environment and no relocation fixer** (proven cold on macOS and Windows,
 * CPU + GPU). So conda-unpack is deliberately never run: doing so would bake the build machine's
 * path into the shipped box. Nothing in the Rust install flow needs a relocation step.
 */

import { chmod, copyFile, cp, mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fail, runResult as defaultRunResult } from './process.mjs';
import { repairPosixLaunchers } from './launchers.mjs';

/**
 * Verifies the pinned pixi is installed. `build` and `lock` must use the same pixi the recipe was
 * pinned against, never whatever happens to be on PATH: a different resolver version can select
 * different packages and silently change the box.
 * `runResult` is injectable so a caller can drive discovery without a real pixi on PATH.
 */
export function findPixi({ requiredVersion, path = null, runResult = defaultRunResult }) {
  const candidate = String(path || process.env.SCROLLCASE_PIXI || 'pixi');
  const result = runResult(candidate, ['--version'], { capture: true });
  if (result.error || result.status !== 0) {
    fail(`pixi ${requiredVersion} is required. Install it from https://pixi.sh/ or pass --pixi <path>.`);
  }
  // `pixi --version` prints "pixi 0.x.y"; the version is the second token.
  const actual = String(result.stdout ?? '').trim().split(/\s+/)[1];
  if (actual !== requiredVersion) fail(`Recipe requires pixi ${requiredVersion}, found ${actual}.`);
  return candidate;
}

/**
 * `lock` — resolves a recipe's pixi.toml into its committed pixi.lock without installing anything.
 * Run by a human when dependencies change; the lock is committed and reviewed, and `build` then
 * only installs from it. The manifest itself pins the channels and the single target platform, so
 * resolution is host-independent without any per-invocation platform flag (unlike uv).
 */
export function pixiLockArguments(manifestPath) {
  return ['lock', '--manifest-path', manifestPath];
}

/**
 * `build` install — materializes the env from the committed lock, never re-resolving. `--frozen`
 * installs exactly the locked packages without touching or re-checking the lock, so what ships is
 * byte-for-byte what was reviewed (the pixi analogue of uv's install-from-lock, never-resolve).
 * Lock freshness against the manifest is a separate CI `check` concern, not a build-time resolve.
 */
export function pixiInstallArguments(manifestPath) {
  return ['install', '--manifest-path', manifestPath, '--frozen'];
}

/**
 * conda-pack arguments to pack an installed conda prefix into a relocatable tarball that carries a
 * self-contained conda-unpack. Extracted into the box as `venv/`, then fixed in place by running
 * the embedded conda-unpack with the box's own interpreter (no external binary at install time).
 */
export function condaPackArguments(prefix, outputPath) {
  return ['-p', prefix, '-o', outputPath, '--format', 'tar.gz'];
}

/**
 * Verifies conda-pack is available. Its `--version` is unreliable (prints 0.0.0), so we only
 * confirm it runs; the exact version pin is recorded elsewhere (via the pixi global manifest).
 */
export function findCondaPack({ path = null, runResult = defaultRunResult } = {}) {
  const candidate = String(path || process.env.SCROLLCASE_CONDA_PACK || 'conda-pack');
  const result = runResult(candidate, ['--help'], { capture: true });
  if (result.error || result.status !== 0) {
    fail('conda-pack is required. Install it (e.g. `pixi global install conda-pack`) or pass --conda-pack <path>.');
  }
  return candidate;
}

/**
 * Replaces every symbolic link under `root` with the real content it points to, so the payload
 * contains only regular files and directories.
 *
 * The box archive layer rejects links outright (collectFiles/normalizeTree/the ZIP writer). A conda
 * prefix is dense with symlinks (versioned dylibs, `bin` aliases), so they are materialized here,
 * *after* conda-unpack has rewritten in-prefix paths against the final location. Links that dangle
 * or resolve outside the prefix are dropped rather than pulling host files into the box.
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
 * Flow (decided by the Phase 0 spike): install the exact locked env into an isolated workspace so
 * pixi's `.pixi/envs` never lands in the tracked recipe dir; conda-pack the prefix into a
 * relocatable tarball with an embedded conda-unpack; extract it into `payloadDir/venv`; run the
 * embedded conda-unpack with the box's own interpreter to fix in-prefix paths against the final
 * location; then dereference every symlink so the payload is link-free for the archive layer. The
 * multi-gigabyte workspace and tarball are removed before the payload is archived.
 *
 * `run` is injected (process.run) so this composes with the orchestrator's logging and error model.
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
  // conda layout (bin/, lib/, conda-meta/) directly under it.
  run('tar', ['-xzf', packPath, '-C', venvDir]);

  const interpreter = join(payloadDir, ...adapter.python.entryPoint.split('/'));
  // Deliberately do NOT run conda-unpack. conda-pack already replaces the build prefix with a
  // neutral placeholder, and the box imports and runs fine that way (Phase 0 proved a cold import
  // from a moved prefix, before any fixer). Running the fixer here would stamp the *build machine's*
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
  // trampoline shebang. Rewrite them to resolve Python next to themselves, using the same repair
  // the uv path already applies, so no build path ships inside the box.
  await repairPosixLaunchers(adapter, payloadDir, [prefix, workspace, payloadDir]);

  await rm(workspace, { recursive: true, force: true });
  await rm(packPath, { force: true });
  return { interpreter, venvDir, sitePackagesRelative: relative(payloadDir, venvDir) };
}
