/**
 * Setting a project up, and telling it what is wrong.
 *
 * `init` scaffolds files; `doctor` inspects and never writes. Keeping that line sharp is what makes
 * `doctor` safe to run at any time, including inside CI, and what stops `init` from being the
 * command nobody dares re-run.
 *
 * `init` may also install the build toolchain, but only after asking: scaffolding never reaches for
 * the network on its own, and the download is verified against a pinned checksum. See
 * `ensureToolchain` below and `toolchain.mjs` for why the consent and the pin are the design rather
 * than a nicety.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boxTargetAdapters, boxTargetId, condaSubdir } from '../contract/targets.mjs';
import { fileExists } from './filesystem.mjs';
import { findCondaPack, findPixi, probeCondaPack, probePixi } from './pixi.mjs';
import { fail, run as defaultRun, runResult as defaultRunResult } from './process.mjs';
import {
  CONDA_PACK_VERSION,
  installCondaPack,
  installPixi,
  latestPixiVersion,
  pixiReleaseAsset,
} from './toolchain.mjs';
import { DEFAULT_WORKSPACE_PATHS, SCROLLCASE_CONFIG_FILENAME } from './workspace.mjs';

// Written into a project's .gitignore and matched on re-run to stay idempotent. Changing the text
// makes an already-scaffolded project look unmarked and append the rules a second time.
const GITIGNORE_MARKER = '# scrollcase build state';

/** The example a new project starts from: an environment with nothing in it but Python. */
function exampleScroll(boxId, target, scrollId = null) {
  const scroll = {
    schemaVersion: 2,
    scrollVersion: '1.0.0',
    boxId,
    modelId: `example-org-${boxId}`,
    runtimeId: `${boxId}-runtime`,
    version: '1.0.0',
    sourceRevision: 'example-v1',
    target,
    compatibility: { minHostAppVersion: '1.0.0' },
    pythonVersion: '3.11',
    pixiVersion: null,
    pythonEntryPoint: boxTargetAdapters().find((adapter) => adapter.platform === target.platform).python.entryPoint,
    modelCacheSubdir: 'model-cache/example',
    assetBaseUrl: 'https://example.org/boxes',
    assets: [],
    selfTest: { imports: ['json'], files: [] },
  };
  // A caller may supply an explicit provenance identity. Fresh scrolls omit the redundant field
  // and let the reader derive `<boxId>-<targetId>` deterministically.
  if (scrollId) scroll.scrollId = scrollId;
  return scroll;
}

function exampleManifest(environmentName, target) {
  return `# Solved by \`scrollcase lock\` into pixi.lock, which is committed and reviewed.
# \`platforms\` must equal the target's conda subdirectory, or the solve produces an environment
# that cannot run on the machine the box is for.
[workspace]
name = "${environmentName}"
channels = ["conda-forge"]
platforms = ["${condaSubdir(target)}"]

[dependencies]
python = "3.11.*"
`;
}

/**
 * Scaffolds a project: a workspace config, one example scroll, and the ignore rules for generated
 * state. Existing files are never overwritten — the command reports what it skipped and why, so a
 * half-configured project can be completed by running it again.
 */
export async function initProject({
  root,
  target,
  pixiVersion = null,
  boxId = 'example-box',
  scrollId = null,
}) {
  if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(boxId)) {
    fail(`Invalid box ID ${boxId}; use lowercase letters, digits, dots and hyphens.`);
  }
  const targetId = boxTargetId(target);
  const derivedScrollId = `${boxId}-${targetId}`;
  const scrollRef = `${boxId}/${targetId}`;
  const written = [];
  const skipped = [];
  const write = async (path, contents) => {
    if (await fileExists(path)) return skipped.push(path);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, contents);
    return written.push(path);
  };

  await write(join(root, SCROLLCASE_CONFIG_FILENAME), `${JSON.stringify({
    version: 1,
    paths: { ...DEFAULT_WORKSPACE_PATHS },
  }, null, 2)}\n`);

  const scrollDir = join(root, DEFAULT_WORKSPACE_PATHS.scrolls, boxId, targetId);
  const scroll = exampleScroll(boxId, target, scrollId);
  if (pixiVersion) scroll.pixiVersion = pixiVersion;
  await write(join(scrollDir, 'scroll.json'), `${JSON.stringify(scroll, null, 2)}\n`);
  await write(join(scrollDir, 'pixi.toml'), exampleManifest(derivedScrollId, target));

  // Build state is regenerated on every build and must never be committed; the lock and the scroll
  // must be. Appending rather than rewriting leaves an existing .gitignore alone.
  const gitignorePath = join(root, '.gitignore');
  const existing = await fileExists(gitignorePath) ? await readFile(gitignorePath, 'utf8') : '';
  if (!existing.includes(GITIGNORE_MARKER)) {
    const rules = `${existing.endsWith('\n') || existing === '' ? '' : '\n'}${GITIGNORE_MARKER}\n.scrollcase/\n`;
    await writeFile(gitignorePath, `${existing}${rules}`);
    written.push(gitignorePath);
  } else {
    skipped.push(gitignorePath);
  }
  return {
    written,
    skipped,
    scrollId: scrollId ?? derivedScrollId,
    scrollRef,
    scrollDir,
    boxId,
    targetId,
  };
}

/** Reads the project config back, so a toolchain pin is added to it rather than replacing it. */
async function readConfig(configPath) {
  if (!await fileExists(configPath)) return { version: 1, paths: { ...DEFAULT_WORKSPACE_PATHS } };
  return JSON.parse(await readFile(configPath, 'utf8'));
}

/** Pins a scaffolded scroll to the pixi it will use, without overwriting an explicit choice. */
async function pinScrollPixiVersion(scrollPath, version) {
  if (!scrollPath || !version || !await fileExists(scrollPath)) return false;
  const scroll = JSON.parse(await readFile(scrollPath, 'utf8'));
  if (scroll.pixiVersion) return false;
  scroll.pixiVersion = version;
  await writeFile(scrollPath, `${JSON.stringify(scroll, null, 2)}\n`);
  return true;
}

/**
 * Installs the build toolchain into the project, if it is missing and only if allowed.
 *
 * `confirm` is the consent, injected rather than assumed: the CLI asks a human, a scripted setup
 * passes a flag, and CI without a terminal answers no. Nothing is downloaded before it returns
 * true, which is what keeps `init` a command that is always safe to run.
 *
 * The pixi version is the scroll's pin when there is one, the installed pixi's version when one is
 * already present, and otherwise the newest release — resolved once and then written into the
 * scroll, because a toolchain nobody pinned is a box nobody can reproduce.
 *
 * The archive's verified digest and managed conda-pack version are recorded under `toolchain` in
 * the project config. The first pixi install trusts the checksum published beside the release;
 * every later one is checked against the value the project committed, so a teammate or a CI runner
 * cannot silently receive different bytes.
 */
export async function ensureToolchain({
  workspace,
  pixiVersion = null,
  confirm,
  scrollPath = null,
  host = process,
  fetchImpl = fetch,
  run = defaultRun,
  runResult = defaultRunResult,
  log = console.log,
}) {
  const discoveredPixi = probePixi({ runResult });
  // A present but different pixi is still missing for this project: resolver versions are part of
  // the scroll's reproducibility contract, so `init --pixi-version` must install what it promises.
  const pixi = discoveredPixi && (!pixiVersion || discoveredPixi.version === pixiVersion)
    ? discoveredPixi
    : null;
  const condaPack = probeCondaPack({ runResult });
  const missing = [!pixi && 'pixi', !condaPack && 'conda-pack'].filter(Boolean);
  if (missing.length === 0) {
    const pinnedScroll = await pinScrollPixiVersion(scrollPath, pixi.version);
    return {
      installed: [],
      missing: [],
      pixiVersion: pixi.version,
      condaPackVersion: CONDA_PACK_VERSION,
      pinnedScroll,
      declined: false,
    };
  }
  if (!pixiReleaseAsset(host)) {
    return { installed: [], missing, declined: false, unsupportedHost: `${host.platform}/${host.arch}` };
  }
  if (!await confirm(missing)) return { installed: [], missing, declined: true };

  const configPath = join(workspace.root, SCROLLCASE_CONFIG_FILENAME);
  const config = await readConfig(configPath);
  const installed = [];
  let pixiPath = pixi?.path ?? null;
  let version = pixiVersion ?? pixi?.version ?? null;

  if (!pixi) {
    if (!version) {
      version = await latestPixiVersion({ fetchImpl });
      log(`Newest pixi release is ${version}; pinning the scroll to it.`);
    }
    const pinned = config.toolchain?.pixi?.version === version
      ? config.toolchain?.pixi?.assets?.[pixiReleaseAsset(host).asset] ?? null
      : null;
    const result = await installPixi({
      version,
      toolchainDir: workspace.toolchainDir,
      expectedSha256: pinned,
      host,
      fetchImpl,
      log,
    });
    pixiPath = result.path;
    installed.push(`pixi ${version}`);
    // Record the digest that was actually verified, so the next machine checks against it.
    config.toolchain = {
      ...config.toolchain,
      pixi: {
        version,
        assets: { ...config.toolchain?.pixi?.assets, [result.asset]: result.sha256 },
      },
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  if (!condaPack) {
    if (!pixiPath) fail('conda-pack is installed with pixi, but no pixi is available.');
    await installCondaPack({ pixi: pixiPath, toolchainDir: workspace.toolchainDir, run, log });
    installed.push(`conda-pack ${CONDA_PACK_VERSION}`);
    config.toolchain = {
      ...config.toolchain,
      condaPack: { version: CONDA_PACK_VERSION },
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  // A scroll scaffolded without a pin gets the version that was just installed, so `lock` and
  // `build` agree with the toolchain sitting next to them.
  const pinnedScroll = await pinScrollPixiVersion(scrollPath, version);
  return {
    installed,
    missing: [],
    declined: false,
    pixiVersion: version,
    condaPackVersion: CONDA_PACK_VERSION,
    pinnedScroll,
    configPath,
  };
}

/**
 * Diagnoses whether this machine can build a box, and says what to do when it cannot.
 *
 * Every check reports rather than throws, so one missing tool does not hide the next problem: a
 * user with neither pixi nor conda-pack should learn both in one run, not one per attempt.
 */
export async function diagnose({ workspace, pixiVersion = null, pixiPath = null, condaPackPath = null, runResult = defaultRunResult }) {
  const checks = [];
  const record = (name, ok, detail, remedy = null) => checks.push({ name, ok, detail, remedy });

  record('workspace', true, workspace.configPath
    ? `config ${workspace.configPath}`
    : `no ${SCROLLCASE_CONFIG_FILENAME} found; using defaults under ${workspace.root}`);
  record('scrolls', await fileExists(workspace.scrollsDir), workspace.scrollsDir,
    `Create it, or point "paths.scrolls" at where your scrolls live.`);

  const git = runResult('git', ['rev-parse', 'HEAD'], { capture: true, cwd: workspace.root });
  record('git', git.status === 0,
    git.status === 0 ? `HEAD ${git.stdout.trim().slice(0, 12)}` : 'not a git checkout',
    'A box records the commit it was built from. Initialise a repository and commit your scrolls.');

  if (pixiVersion) {
    try {
      const pixi = findPixi({ requiredVersion: pixiVersion, path: pixiPath, runResult });
      record('pixi', true, `${pixi} at ${pixiVersion}`);
    } catch (error) {
      record('pixi', false, error.message,
        `Install pixi ${pixiVersion} from https://pixi.sh/, or pass --pixi <path>.`);
    }
  } else {
    record('pixi', true, 'not checked: pass --pixi-version, or run doctor with a scroll');
  }

  try {
    const condaPack = findCondaPack({ path: condaPackPath, runResult });
    record('conda-pack', true, condaPack);
  } catch (error) {
    record('conda-pack', false, error.message,
      `Install conda-pack ${CONDA_PACK_VERSION} with \`scrollcase init --install-toolchain\`, or pass --conda-pack <path>.`);
  }

  return { checks, ok: checks.every((check) => check.ok) };
}
