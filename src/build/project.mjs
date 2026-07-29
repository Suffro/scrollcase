/**
 * Setting a project up, and telling it what is wrong.
 *
 * `initProject` scaffolds only the workspace; the CLI may compose it with the explicitly
 * disposable example used for onboarding. `doctor` inspects and never writes. Real scroll
 * authoring remains a separate operation because a workspace may carry many boxes and targets.
 *
 * `init` may also install the build toolchain, but only after asking: scaffolding never reaches for
 * the network on its own, and the download is verified against a pinned checksum. See
 * `ensureToolchain` below and `toolchain.mjs` for why the consent and the pin are the design rather
 * than a nicety.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

const PROJECT_GUIDE = `[Scrollcase documentation](https://scrollcase.dev/)

# Scrollcase in this project

Scrollcase turns a declarative [scroll](https://scrollcase.dev/reference/scroll) into a signed,
portable [box](https://scrollcase.dev/reference/box-format) for one
[target](https://scrollcase.dev/reference/box-format#targets).

## Usual workflow

\`scrollcase init\` prints the exact example reference for this machine. Then:

1. \`scrollcase lock <boxId>/<targetId>\`
2. \`scrollcase keygen\`
3. \`scrollcase build <boxId>/<targetId>\`
4. \`scrollcase verify <release.json> --self-test\` or \`scrollcase run <release.json>\`

See the [CLI reference](https://scrollcase.dev/reference/cli) for every option and
[signing and key custody](https://scrollcase.dev/guides/signing-and-custody) before distributing a
box. The files in \`consumer-templates/\` demonstrate the
[Node and Python consumer APIs](https://scrollcase.dev/reference/api) against local release files;
they do not download or publish boxes.

[Scrollcase documentation](https://scrollcase.dev/)
`;

/**
 * Scaffolds a workspace config, concise project guide, scroll root, and generated-state ignores.
 *
 * This low-level primitive deliberately creates no scroll. Existing files are never overwritten,
 * so a half-configured workspace can be completed by running the command again without changing
 * authored inputs.
 */
export async function initProject({
  root,
  scrollsDir = join(root, DEFAULT_WORKSPACE_PATHS.scrolls),
}) {
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
  await write(join(root, 'SCROLLCASE.md'), PROJECT_GUIDE);

  if (await fileExists(scrollsDir)) skipped.push(scrollsDir);
  else {
    await mkdir(scrollsDir, { recursive: true });
    written.push(scrollsDir);
  }

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
    root,
    scrollsDir,
  };
}

/** Reads the project config back, so a toolchain pin is added to it rather than replacing it. */
async function readConfig(configPath) {
  if (!await fileExists(configPath)) return { version: 1, paths: { ...DEFAULT_WORKSPACE_PATHS } };
  return JSON.parse(await readFile(configPath, 'utf8'));
}

/**
 * Installs the build toolchain into the project, if it is missing and only if allowed.
 *
 * `confirm` is the consent, injected rather than assumed: the CLI asks a human, a scripted setup
 * passes a flag, and CI without a terminal answers no. Nothing is downloaded before it returns
 * true, which is what keeps `init` a command that is always safe to run.
 *
 * The pixi version is the caller's requested pin, the installed pixi's version when one is already
 * present, and otherwise the newest release. Managed installs record that choice and the verified
 * archive digest in the workspace config; each scroll separately declares which resolver it uses.
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
    return {
      installed: [],
      missing: [],
      pixiVersion: pixi.version,
      condaPackVersion: CONDA_PACK_VERSION,
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
      log(`Newest pixi release is ${version}; recording it for the workspace toolchain.`);
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

  return {
    installed,
    missing: [],
    declined: false,
    pixiVersion: version,
    condaPackVersion: CONDA_PACK_VERSION,
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
