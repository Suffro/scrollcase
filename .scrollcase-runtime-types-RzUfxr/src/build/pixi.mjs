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
import { chmod, copyFile, cp, mkdir, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as tar from 'tar';
import { resolvePayloadLinkTarget, targetCarriesLinks } from '../contract/links.mjs';
import { compareStableStrings, safeRelativePath } from './filesystem.mjs';
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
 * Verifies the pinned pixi is installed. `build` and `lock` must use the same pixi the scroll was
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
  if (found.version !== requiredVersion) fail(`Scroll requires pixi ${requiredVersion}, found ${found.version}.`);
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
 * `lock` — resolves a scroll's pixi.toml into its committed pixi.lock without installing anything.
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
 * The only fields a box keeps from conda's per-package records: which exact binary this is, and
 * what it is licensed under. Everything else is dropped.
 *
 * `build` earns its place because name and version do not identify a conda binary — one version is
 * published in many builds, and a CPU and a CUDA build of the same library can differ in nothing
 * else. All four are properties of the package as published rather than of the install that placed
 * it, which is what makes them stable across rebuilds: `license` here was measured equal to the
 * lock's declared licence for every package, and the lock is already the source the shipped licence
 * inventory is derived from. A package declaring no licence simply has no such field, which is
 * equally a property of the package and not of the run.
 *
 * The dependency graph is deliberately not here: nothing resolves dependencies inside a box, and
 * the lock records them where they can actually be acted on.
 */
const CONDA_RECORD_FIELDS = Object.freeze([
  'name',
  'version',
  'build',
  'license',
]);

/**
 * Rewrites `conda-meta/` into a canonical, build-independent form.
 *
 * These records are written by the installer, not by the package, and two installs of the identical
 * lock do not produce identical ones: a per-file `sha256_in_prefix` is recorded on one run and not
 * the next. They also carry absolute paths into the build machine's package cache. The first breaks
 * the promise the whole trust chain rests on — rebuild a commit, get the same bytes — and the second
 * ships a developer's directory layout to users, which is the very leak conda-unpack is refused
 * over. Anything that is not a record (conda's `history` log) goes entirely.
 *
 * Nothing in a box reads any of this: conda is never shipped inside one, and package versions stay
 * readable from `site-packages` where a Python tool actually looks. So the kept fields are copied
 * verbatim and the rule is an allowlist rather than a list of known-volatile fields — deliberately,
 * because a field pixi starts writing in a later release then cannot reintroduce the drift. It was
 * never eligible to be written in the first place.
 */
async function canonicalizeCondaRecords(venvDir) {
  const metaDir = join(venvDir, 'conda-meta');
  if (!existsSync(metaDir)) return;
  for (const entry of (await readdir(metaDir)).sort(compareStableStrings)) {
    const entryPath = join(metaDir, entry);
    if (!entry.endsWith('.json')) {
      await rm(entryPath, { recursive: true, force: true });
      continue;
    }
    let record;
    try {
      record = JSON.parse(await readFile(entryPath, 'utf8'));
    } catch (error) {
      return fail(`Unreadable conda package record ${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const canonical = {};
    for (const field of CONDA_RECORD_FIELDS) {
      if (record[field] !== undefined) canonical[field] = record[field];
    }
    await writeFile(entryPath, `${JSON.stringify(canonical, null, 2)}\n`);
  }
}

/**
 * Settles every symbolic link under `root`: kept when the payload may carry it, materialized into
 * real content when it may not, dropped when it points nowhere useful.
 *
 * A conda prefix is dense with links, and materializing all of them was expensive in a way nobody
 * had measured: on Linux the soname convention alone (`libfoo.so` → `.so.N` → `.so.N.M`) meant
 * roughly 60% of an extracted box was duplicates of its own bytes. What may be kept is decided by
 * `src/contract/links.mjs`, not here — this function only supplies the filesystem facts that rule
 * needs and applies its answer.
 *
 * Two conditions are checked against the disk rather than the path string, because only the disk
 * knows them: that the link resolves inside the prefix even after passing through other links, and
 * that what it ends at is a regular file. A link to a directory is materialized, which is what
 * keeps anything from ever being written *through* a link.
 *
 * @param {string} root
 * @param {boolean} keepLinks whether this target can extract links at all
 * @param {string} [current]
 * @returns {Promise<void>}
 */
async function settleSymlinksInPlace(root, keepLinks, current = root) {
  const canonicalRoot = await realpath(root);
  // Sorted, because whether a link is kept can depend on what an earlier entry became, and
  // readdir order is the filesystem's business. Two builds must settle the tree identically.
  const children = (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => compareStableStrings(left.name, right.name));
  for (const entry of children) {
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
      if (keepLinks && !info.isDirectory() && await keepsAsLink(root, path, canonicalRoot)) continue;
      await rm(path, { force: true });
      if (info.isDirectory()) {
        await cp(target, path, { recursive: true, dereference: true });
        await settleSymlinksInPlace(root, keepLinks, path);
      } else {
        await copyFile(target, path);
        await chmod(path, info.mode & 0o777);
      }
    } else if (entry.isDirectory()) {
      await settleSymlinksInPlace(root, keepLinks, path);
    }
  }
}

/**
 * Whether one link satisfies the payload rule, judged against the tree it actually sits in.
 *
 * The raw target is what gets archived, so it is what must be checked: an absolute target names the
 * build machine and is exactly what relocation exists to erase, and a relative one has to land
 * inside the prefix both lexically and after the filesystem has followed it.
 *
 * @param {string} root
 * @param {string} linkPath
 * @param {string} canonicalRoot
 * @returns {Promise<boolean>}
 */
async function keepsAsLink(root, linkPath, canonicalRoot) {
  const rawTarget = (await readlink(linkPath)).split(sep).join('/');
  const relativeLink = relative(root, linkPath).split(sep).join('/');
  const resolved = resolvePayloadLinkTarget(relativeLink, rawTarget);
  if (resolved === null) return false;
  // The lexical answer and the filesystem's answer must agree. They can differ when the target is
  // reached through another link, which is precisely the case a purely lexical check cannot see.
  const lexicalPath = join(root, ...resolved.split('/'));
  let lexicalReal;
  try {
    lexicalReal = await realpath(lexicalPath);
  } catch {
    return false;
  }
  if (lexicalReal !== canonicalRoot && !lexicalReal.startsWith(`${canonicalRoot}${sep}`)) return false;
  return (await stat(lexicalPath)).isFile();
}

/**
 * Builds the box's `venv/` prefix from a scroll's committed pixi.lock and packs it for relocation.
 *
 * Flow: install the exact locked env into an isolated workspace so pixi's `.pixi/envs` never
 * lands in the tracked scroll dir; conda-pack the prefix into a relocatable tarball; extract it
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
  // so the resulting `.pixi/envs/default` prefix is build-local, never inside the scroll.
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
  //
  // They cannot, however, be created *during* extraction. The extractor refuses a link whose target
  // leaves the tree, and refuses one whose target passes through another link — both are defences
  // against writing file content through a link, and neither is negotiable. A conda prefix trips
  // the second routinely: icu ships `current -> <version>` and then `pkgdata.inc ->
  // current/pkgdata.inc`, which arrives in a plain `python` environment that never asked for icu,
  // and made the whole box unbuildable.
  //
  // So links are extracted in a second pass, once every regular entry is already on disk and there
  // is nothing left that could be written through one. Creating a link is not traversing it: the
  // targets are resolved and checked immediately below, where anything leaving the tree is dropped.
  const deferredLinks = [];
  await tar.x({
    file: packPath,
    cwd: venvDir,
    gzip: true,
    preservePaths: false,
    strict: true,
    filter: (entryPath, entry) => {
      if (entry.type !== 'SymbolicLink') return true;
      deferredLinks.push({ path: safeRelativePath(entryPath), target: String(entry.linkpath) });
      return false;
    },
  });
  // Sorted so the tree is built the same way whatever order the tar happened to list them in.
  for (const link of deferredLinks.sort((left, right) => compareStableStrings(left.path, right.path))) {
    const linkPath = join(venvDir, ...link.path.split('/'));
    // A regular entry already holding the path wins: content beats an alias to it.
    if (existsSync(linkPath)) continue;
    await mkdir(dirname(linkPath), { recursive: true });
    // The type argument is inert on POSIX and decides junction-vs-file on Windows, where a conda
    // prefix carries no links at all — so a target that is not yet a directory is simply a file.
    const resolved = resolve(dirname(linkPath), link.target);
    const type = existsSync(resolved) && (await stat(resolved)).isDirectory() ? 'dir' : 'file';
    await symlink(link.target, linkPath, type);
  }

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
  // The rest of conda-meta carries the same two problems in a less obvious form; see above.
  await canonicalizeCondaRecords(venvDir);
  // Order matters: settle the links first, so the launcher repair that follows walks a tree whose
  // shape is final and rewrites each script's bytes exactly once, under its own name.
  await settleSymlinksInPlace(venvDir, targetCarriesLinks(adapter.platform));
  // conda console scripts (tqdm, isympy, …) embed the absolute build interpreter in a shell
  // trampoline shebang. Rewrite them to resolve Python next to themselves, so no build path
  // ships inside the box.
  await repairPosixLaunchers(adapter, payloadDir, [prefix, workspace, payloadDir]);

  await rm(workspace, { recursive: true, force: true });
  await rm(packPath, { force: true });
  return { interpreter, venvDir, sitePackagesRelative: relative(payloadDir, venvDir) };
}
