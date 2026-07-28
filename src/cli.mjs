#!/usr/bin/env node

/**
 * The Scrollcase command line.
 *
 * One job: turn a recipe into a portable, locked, self-contained box and prove it works. `init` and
 * `doctor` get a machine ready, `lock` resolves dependencies once so a human can review and commit
 * the result, `audit` reports what licences that pulls in, `build` installs only from the lock,
 * `verify` re-runs a consumer's install-time checks, and `keygen` produces the signing key that makes
 * any of it trustworthy.
 *
 * Every command resolves its paths through the workspace, so the tool runs from anywhere against any
 * project that declares a scrollcase.config.json.
 */

import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { auditRecipe } from './build/audit.mjs';
import { buildBox } from './build/box.mjs';
import { findPixi, pixiLockArguments } from './build/pixi.mjs';
import { fail, run } from './build/process.mjs';
import { diagnose, ensureToolchain, initProject } from './build/project.mjs';
import { recipeCandidates, readRecipe } from './build/recipe.mjs';
import { verifyBox } from './build/verify.mjs';
import { configureWorkspace, getWorkspace, workspaceOverridesFromFlags } from './build/workspace.mjs';
import { chooseCliValue } from './cli-menu.mjs';
import { buildDistributionSummary, statusLine } from './cli-output.mjs';
import { ensureBuildSigningKeys } from './cli-signing.mjs';
import { chooseTarget, cliTargetFamilies, parseCliTarget } from './cli-targets.mjs';
import { generateSigningKey } from './sign/index.mjs';

const success = (message) => console.log(statusLine('success', message));
const step = (message) => console.log(statusLine('step', message));
const info = (message) => console.log(statusLine('info', message));
const warning = (message) => console.log(statusLine('warning', message));

/** Minimal flag parser supporting `--name=value`, `--name value`, and bare `--name` (true). */
function parseArgs(values) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const [name, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) flags.set(name, inline);
    else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      flags.set(name, values[index + 1]);
      index += 1;
    } else flags.set(name, true);
  }
  return { positional, flags };
}

const text = (flags, name) => (flags.has(name) ? String(flags.get(name)) : null);

/** Signing key locations, defaulting into the workspace's key directory. */
function keyPaths(flags) {
  const keysDir = getWorkspace().keysDir;
  return {
    privatePath: resolve(text(flags, 'private-key') || join(keysDir, 'signing-private.pem')),
    publicPath: resolve(text(flags, 'public-key') || join(keysDir, 'signing-public.json')),
  };
}

async function keygen(flags) {
  const { privatePath, publicPath } = keyPaths(flags);
  const created = await generateSigningKey({
    privatePath,
    publicPath,
    keyId: text(flags, 'key-id'),
    force: Boolean(flags.get('force')),
  });
  success(`Created signing key ${created.keyId}`);
  info(`Private: ${created.privatePath}`);
  info(`Public:  ${created.publicPath}`);
}

/**
 * `lock` — resolve the recipe's pixi manifest into a fully pinned lock file.
 *
 * Run by a human when dependencies change; the result is committed and reviewed. Builds then only
 * *install* from it, so what ships is exactly what was reviewed. The manifest pins the channels and
 * the single target platform, which is what makes resolution independent of the machine doing it.
 */
async function lock(name, flags) {
  const reference = await selectRecipeReference(name, flags);
  const { dir, recipe } = await readRecipe(reference);
  const pixi = findPixi({ requiredVersion: recipe.pixiVersion, path: text(flags, 'pixi') });
  run(pixi, pixiLockArguments(join(dir, 'pixi.toml')));
  success(`Updated ${join(dir, 'pixi.lock')}`);
}

/**
 * Asks a yes/no question, defaulting to no.
 *
 * Only ever asks when both ends are a terminal. Without one — CI, a pipe — there is nobody to
 * answer, and silence must not be read as consent, so the answer is no.
 */
async function confirm(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await readline.question(`${question} [y/N] `)).trim());
  } finally {
    readline.close();
  }
}

/** Resolves a box shorthand at the CLI edge, where an ambiguous target can be asked about. */
async function selectRecipeReference(name, flags) {
  const candidates = await recipeCandidates(name);
  return (await chooseTarget(candidates, { requested: text(flags, 'target') })).reference;
}

/** Completes a CUDA target with the ABI version that is part of its canonical identity. */
async function completeCudaTarget(targetFamily, flags) {
  const supplied = text(flags, 'cuda-version');
  if (supplied) return parseCliTarget(`${targetFamily.targetId}${supplied}`);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(`Target ${targetFamily.targetId} requires --cuda-version <major.minor> without a terminal.`);
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const version = (await readline.question('Which CUDA version? (major.minor) ')).trim();
      if (!version) {
        console.log('A CUDA version is required because it is part of the target identity.');
        continue;
      }
      try {
        return parseCliTarget(`${targetFamily.targetId}${version}`);
      } catch (error) {
        console.log(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    readline.close();
  }
}

/**
 * Resolves the target `init` will scaffold.
 *
 * `--target` is the complete scripted form. The older component flags remain supported, but a
 * missing accelerator is a choice rather than an assumed CPU/Metal policy.
 */
async function initTarget(flags) {
  const requested = text(flags, 'target');
  if (requested) {
    if (['platform', 'accelerator', 'cuda-version'].some((name) => flags.has(name))) {
      fail('--target cannot be combined with --platform, --accelerator or --cuda-version.');
    }
    return parseCliTarget(requested);
  }

  const hostPlatform = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform];
  const platform = text(flags, 'platform') || hostPlatform
    || fail(`No supported target platform for this host: ${process.platform}/${process.arch}.`);
  const accelerator = text(flags, 'accelerator') || (flags.has('cuda-version') ? 'cuda' : null);
  let candidates = cliTargetFamilies(platform);
  if (accelerator) candidates = candidates.filter((candidate) => candidate.target.accelerator === accelerator);
  if (candidates.length === 0) {
    fail(`No supported target matches platform ${platform}${accelerator ? ` and accelerator ${accelerator}` : ''}.`);
  }
  const selected = await chooseTarget(candidates);
  if (selected.target.accelerator === 'cuda') return completeCudaTarget(selected, flags);
  if (flags.has('cuda-version')) fail('--cuda-version is valid only for a CUDA target.');
  return parseCliTarget(selected.targetId);
}

/**
 * `init` — scaffold a project, then offer to install the toolchain it needs.
 *
 * Scaffolding writes files and touches nothing else. The toolchain step downloads only after an
 * explicit yes: `--install-toolchain` for a scripted setup, `--no-install-toolchain` to skip, and
 * otherwise a prompt. With no terminal to prompt, nothing is installed.
 */
async function init(flags) {
  const workspace = getWorkspace();
  const target = await initTarget(flags);
  const explicitBoxId = text(flags, 'box-id');
  const legacyBoxId = text(flags, 'recipe-id');
  if (explicitBoxId && legacyBoxId && explicitBoxId !== legacyBoxId) {
    fail('--box-id and the legacy --recipe-id alias cannot name different boxes.');
  }
  const result = await initProject({
    root: workspace.root,
    target,
    pixiVersion: text(flags, 'pixi-version'),
    boxId: explicitBoxId || legacyBoxId || 'example-box',
  });
  for (const path of result.written) success(`Created ${path}`);
  for (const path of result.skipped) info(`Kept ${path} (already present)`);

  const always = Boolean(flags.get('install-toolchain'));
  const never = Boolean(flags.get('no-install-toolchain'));
  const toolchain = await ensureToolchain({
    workspace,
    pixiVersion: text(flags, 'pixi-version'),
    recipePath: join(result.recipeDir, 'recipe.json'),
    confirm: async (missing) => {
      if (never) return false;
      if (always) return true;
      console.log(`\nThis project needs ${missing.join(' and ')} to build a box.`);
      return confirm(`Install ${missing.length > 1 ? 'them' : 'it'} into ${workspace.toolchainDir}?`);
    },
  });

  if (toolchain.installed.length > 0) {
    success(`Installed ${toolchain.installed.join(' and ')} into ${workspace.toolchainDir}`);
    info('Nothing was added to PATH; scrollcase finds them there on its own.');
    if (toolchain.pinnedRecipe) success(`Pinned pixi ${toolchain.pixiVersion} in ${result.recipeDir}/recipe.json`);
    if (toolchain.configPath) success(`Recorded the toolchain pins in ${toolchain.configPath}`);
  } else if (toolchain.unsupportedHost) {
    warning(`pixi publishes no build for ${toolchain.unsupportedHost}; install ${toolchain.missing.join(' and ')} manually.`);
  } else if (toolchain.missing.length > 0) {
    warning(`Skipped installing ${toolchain.missing.join(' and ')}.`);
    info('Install them yourself, or re-run with --install-toolchain. `scrollcase doctor` reports what is missing.');
  }

  if (!text(flags, 'pixi-version') && !toolchain.pinnedRecipe) {
    warning(`Set pixiVersion in ${result.recipeDir}/recipe.json to the pixi release you build with.`);
  }
  console.log('\nNext:');
  console.log(`  scrollcase lock ${result.recipeRef}`);
  console.log(`  scrollcase keygen`);
  console.log(`  scrollcase build ${result.recipeRef}`);
}

/** `doctor` — report whether this machine can build a box. Reads only; never writes. */
async function doctor(flags) {
  let pixiVersion = text(flags, 'pixi-version');
  const recipeName = text(flags, 'recipe');
  if (!pixiVersion && recipeName) {
    const reference = await selectRecipeReference(recipeName, flags);
    pixiVersion = (await readRecipe(reference)).recipe.pixiVersion;
  }
  const { checks, ok } = await diagnose({
    workspace: getWorkspace(),
    pixiVersion,
    pixiPath: text(flags, 'pixi'),
    condaPackPath: text(flags, 'conda-pack'),
  });
  for (const check of checks) {
    console.log(statusLine(check.ok ? 'success' : 'error', `${check.name.padEnd(11)} ${check.detail}`));
    if (!check.ok && check.remedy) console.log(`  ${statusLine('step', check.remedy)}`);
  }
  if (!ok) fail('Some checks failed; see the remedies above.');
}

/** `audit` — the dependency licence inventory, derived from the lock without building. */
async function audit(name, flags) {
  const reference = await selectRecipeReference(name, flags);
  const write = Boolean(flags.get('write'));
  const { summary, reviewed, written } = await auditRecipe(reference, {
    write,
    namespace: text(flags, 'namespace') || undefined,
  });
  info(`${summary.packageCount} packages for ${summary.recipeId} (${summary.targetId})`);
  for (const entry of summary.licenses) console.log(`  ${String(entry.count).padStart(4)}  ${entry.license}`);
  if (written) success(`Wrote reviewed audit: ${reviewed}`);
  else if (reviewed) success(`Matches the reviewed audit: ${reviewed}`);
}

async function build(name, flags) {
  const reference = await selectRecipeReference(name, flags);
  const signing = {
    ...keyPaths(flags),
    signerCommand: text(flags, 'signer-command'),
  };
  await ensureBuildSigningKeys(signing);
  // Asked at the CLI edge and passed down: buildBox never reads a terminal itself.
  const channel = await chooseCliValue(
    'channel',
    ['beta', 'stable', 'nightly'],
    { flag: text(flags, 'channel'), open: true },
  );
  const weights = await chooseCliValue(
    'weights mode',
    ['embed', 'on-demand'],
    { flag: text(flags, 'weights') },
  );
  step(`Building ${reference} (${channel}, ${weights})`);
  const built = await buildBox(reference, {
    ...signing,
    allowDirty: Boolean(flags.get('allow-dirty')),
    channel,
    weights,
    assetBaseUrl: text(flags, 'asset-base-url'),
    namespace: text(flags, 'namespace') || undefined,
    pixiPath: text(flags, 'pixi'),
    condaPackPath: text(flags, 'conda-pack'),
    log: (message) => {
      if (!message || /^(Box:|Release:|Channel:|Publish:| {9}then )/.test(message)) return;
      step(message);
    },
  });
  const workspace = getWorkspace();
  success(buildDistributionSummary(built, workspace.distDir));
}

async function verify(path, flags) {
  await verifyBox(path, {
    publicPath: keyPaths(flags).publicPath,
    archive: text(flags, 'archive'),
    selfTest: Boolean(flags.get('self-test')),
  });
}

function usage() {
  console.log(`Usage: scrollcase <command> [options]

Commands:
  init                       Scaffold a config, an example recipe, and ignore rules
  doctor                     Report whether this machine can build a box
  keygen                     Create a local ed25519 signing key
  lock <recipe>              Resolve the recipe's pixi manifest into pixi.lock
  audit <recipe>             Dependency licence inventory, derived from the lock
  build <recipe>             Build, self-test, archive, and sign a box
  verify <release.json>      Verify signature, archive hash, and layout

Init options:
  --target <targetId>        Complete target, for example macos-aarch64-metal or
                             linux-x86_64-cuda12.4
  --platform <name>          Restrict the target choice to macos, linux or windows
  --accelerator <name>       Restrict the target choice to cpu, metal or cuda
  --cuda-version <version>   CUDA major.minor ABI when selecting a CUDA target
  --pixi-version <version>   Pin the example recipe to this pixi release
  --box-id <name>            Name the example box (default example-box)
  --recipe-id <name>         Legacy alias for --box-id
  --install-toolchain        Install missing pixi/conda-pack without asking
  --no-install-toolchain     Never install them; just report what is missing
                             With neither flag, init asks before downloading anything, and
                             installs into <toolchain> after a verified checksum check.

Doctor options:
  --recipe <name>            Take the required pixi version from this recipe
  --target <targetId>        Select a target when <name> is a box with several recipes
  --pixi-version <version>   Check for this pixi release

Keygen options:
  --key-id <id>              Identifier recorded in signatures (default derived from key)
  --force                    Overwrite both named key files; unsafe for rotation

Audit options:
  --target <targetId>        Select a target when <recipe> names a box
  --write                    Write the inventory to the recipe's reviewed audit path
  --namespace <ns>           Document kind namespace (default scrollcase.box)

Build options:
  --target <targetId>        Select a target when <recipe> names a box
  --channel <name>           Channel the signed pointer names (menu: beta/stable/nightly;
                             default beta; explicit custom names are supported)
  --weights <mode>           embed (default: assets packed in, works air-gapped) or
                             on-demand (fetched by the consumer at install time)
                             Without either flag, build shows an arrow-key menu. With no
                             terminal to ask, it says which default it took and carries on.
  --asset-base-url <url>     Override the recipe's published base URL
  --namespace <ns>           Document kind namespace (default scrollcase.box)
  --allow-dirty              Permit a build from an uncommitted source tree
  --pixi <path>              Use this pixi executable
  --conda-pack <path>        Use this conda-pack executable (managed installs pin 0.9.2)

Recipe targets:
  lock, audit and build accept either <boxId>/<targetId> or a box ID plus
  --target <targetId>. With only a box ID, a terminal shows an arrow-key menu.
  A sole target for this host is the default; Metal is preferred on macOS.
  Without a terminal, any other ambiguous target is an error.

Verify options:
  --archive <path>           Archive to check, if not beside the release document
  --self-test                Extract and import with the box's own interpreter

Signing:
  --private-key <path>       Local signing key (default <keys>/signing-private.pem)
  --public-key <path>        Trusted key set (default <keys>/signing-public.json)
  --signer-command <cmd>     Sign through an external command instead of a local key.
                             It receives the payload on stdin and returns the signed
                             document as JSON on stdout; the result is verified locally.
                             Before build work starts, missing local keys fail with an
                             explicit instruction to run scrollcase keygen.

Workspace:
  Paths come from scrollcase.config.json at the project root, discovered by walking
  up from the working directory, and can be overridden per invocation:
  --config <file>            Use this workspace config explicitly
  --project-root <dir>       Treat this directory as the project root
  --recipes-dir <dir>        Where recipes live (default recipes)
  --build-dir <dir>          Payload scratch space (default .scrollcase/build)
  --out-dir <dir>            Built artefacts (default .scrollcase/dist)
  --keys-dir <dir>           Local signing keys (default .scrollcase/keys)
  --toolchain-dir <dir>      Project-local pixi/conda-pack (default .scrollcase/toolchain)
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') return usage();
  // Resolve the workspace before any command touches a path, so flags win over the project config.
  configureWorkspace({ overrides: workspaceOverridesFromFlags(flags) });
  if (command === 'init') return init(flags);
  if (command === 'doctor') return doctor(flags);
  if (command === 'keygen') return keygen(flags);
  if (command === 'audit') return audit(positional[0] || fail('audit requires a recipe name.'), flags);
  if (command === 'lock') return lock(positional[0] || fail('lock requires a recipe name.'), flags);
  if (command === 'build') return build(positional[0] || fail('build requires a recipe name.'), flags);
  if (command === 'verify') return verify(positional[0] || fail('verify requires a signed release document.'), flags);
  fail(`Unknown command: ${command}`);
}

// Single failure path: every `fail()` anywhere lands here as a one-line message and a non-zero exit
// code, so CI and shell callers can rely on the status.
main().catch((error) => {
  console.error(statusLine(
    'error',
    `scrollcase: ${error instanceof Error ? error.message : String(error)}`,
    { stream: process.stderr },
  ));
  process.exitCode = 1;
});
