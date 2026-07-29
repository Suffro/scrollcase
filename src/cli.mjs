#!/usr/bin/env node

/**
 * The Scrollcase command line.
 *
 * One job: turn a scroll into a portable, locked, self-contained box and prove it works. `init`
 * prepares the workspace, `new scroll` authors one input, `doctor` checks the machine, `lock`
 * resolves dependencies once so a human can review and commit the result, `audit` reports what
 * licences that pulls in, `build` installs only from the lock, `verify` re-runs a consumer's
 * install-time checks, `run` executes one caller-supplied local release through that consumer, and
 * `keygen` produces the signing key that makes any of it trustworthy.
 *
 * Every command resolves its paths through the workspace, so the tool runs from anywhere against any
 * project that declares a scrollcase.config.json.
 */

import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { auditScroll } from './build/audit.mjs';
import {
  createScroll,
  ensureExampleScroll,
  EXAMPLE_PIXI_VERSION,
} from './build/authoring.mjs';
import { buildBox } from './build/box.mjs';
import { findPixi, pixiLockArguments } from './build/pixi.mjs';
import { fail, run } from './build/process.mjs';
import { diagnose, ensureToolchain, initProject } from './build/project.mjs';
import { scrollCandidates, readScroll } from './build/scroll.mjs';
import { verifyBox } from './build/verify.mjs';
import {
  configureWorkspace,
  getWorkspace,
  SCROLLCASE_CONFIG_FILENAME,
  workspaceOverridesFromFlags,
} from './build/workspace.mjs';
import { collectNewScrollOptions } from './cli-authoring.mjs';
import { parseArgs } from './cli-args.mjs';
import { chooseCliValue } from './cli-menu.mjs';
import { buildDistributionSummary, statusLine } from './cli-output.mjs';
import { runCliBox } from './cli-run.mjs';
import { ensureBuildSigningKeys } from './cli-signing.mjs';
import { chooseScroll, chooseTarget, nativeExampleTarget } from './cli-targets.mjs';
import { CHANNELS } from './contract/index.mjs';
import { generateSigningKey } from './sign/index.mjs';

const success = (message) => console.log(statusLine('success', message));
const step = (message) => console.log(statusLine('step', message));
const info = (message) => console.log(statusLine('info', message));
const warning = (message) => console.log(statusLine('warning', message));

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
 * `lock` — resolve the scroll's pixi manifest into a fully pinned lock file.
 *
 * Run by a human when dependencies change; the result is committed and reviewed. Builds then only
 * *install* from it, so what ships is exactly what was reviewed. The manifest pins the channels and
 * the single target platform, which is what makes resolution independent of the machine doing it.
 */
async function lock(name, flags) {
  const reference = await selectScrollReference(name, flags);
  const { dir, scroll } = await readScroll(reference);
  const pixi = findPixi({ requiredVersion: scroll.pixiVersion, path: text(flags, 'pixi') });
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
async function selectScrollReference(name, flags) {
  const candidates = await scrollCandidates(name);
  if (!name) return (await chooseScroll(candidates)).reference;
  return (await chooseTarget(candidates, { requested: text(flags, 'target') })).reference;
}

/**
 * `init` — scaffold the workspace and its disposable runnable example, then offer the toolchain.
 *
 * Real scroll creation remains separate: the fixed `example-box` is onboarding material, never a
 * guess at the project's identity. The toolchain step downloads only after explicit consent.
 */
async function init(flags) {
  const workspace = getWorkspace();
  const authoringFlags = [
    'target',
    'platform',
    'accelerator',
    'cuda-version',
    'box-id',
    'model-id',
    'runtime-id',
  ].filter((name) => flags.has(name));
  if (authoringFlags.length > 0) {
    fail(`init accepts only the fixed example; pass ${authoringFlags.map((name) => `--${name}`).join(', ')} to scrollcase new scroll.`);
  }
  const exampleTarget = flags.get('no-example') ? null : nativeExampleTarget();
  const result = await initProject({ root: workspace.root, scrollsDir: workspace.scrollsDir });
  for (const path of result.written) success(`Created ${path}`);
  for (const path of result.skipped) info(`Kept ${path} (already present)`);

  let example = null;
  const pixiVersion = text(flags, 'pixi-version')
    ?? (exampleTarget ? EXAMPLE_PIXI_VERSION : null);
  if (exampleTarget) {
    const initializedWorkspace = workspace.configPath
      ? workspace
      : { ...workspace, configPath: join(workspace.root, SCROLLCASE_CONFIG_FILENAME) };
    example = await ensureExampleScroll({
      workspace: initializedWorkspace,
      target: exampleTarget,
      pixiVersion,
    });
    if (example.created) {
      success(`Created example scroll ${example.scrollRef}`);
      for (const path of example.written) info(path);
    } else {
      info(`Kept example scroll ${example.scrollRef} (already present)`);
    }
  }

  const always = Boolean(flags.get('install-toolchain'));
  const never = Boolean(flags.get('no-install-toolchain'));
  const toolchain = await ensureToolchain({
    workspace,
    pixiVersion,
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
    if (toolchain.configPath) success(`Recorded the toolchain pins in ${toolchain.configPath}`);
  } else if (toolchain.unsupportedHost) {
    warning(`pixi publishes no build for ${toolchain.unsupportedHost}; install ${toolchain.missing.join(' and ')} manually.`);
  } else if (toolchain.missing.length > 0) {
    warning(`Skipped installing ${toolchain.missing.join(' and ')}.`);
    info('Install them yourself, or re-run with --install-toolchain. `scrollcase doctor` reports what is missing.');
  }

  success('Workspace initialized');
  if (example) step(`Example: scrollcase lock ${example.scrollRef}`);
  step(example ? 'Create your own: scrollcase new scroll' : 'Next: scrollcase new scroll');
}

/** `new scroll` — collect one complete authoring decision and create it atomically. */
async function newScroll(flags) {
  const workspace = getWorkspace();
  const options = await collectNewScrollOptions(flags);
  const result = await createScroll({ workspace, ...options });
  success(`Created scroll ${result.scrollRef}`);
  for (const path of result.written) info(path);
  step(`Next: scrollcase lock ${result.scrollRef}`);
}

/** `doctor` — report whether this machine can build a box. Reads only; never writes. */
async function doctor(flags) {
  let pixiVersion = text(flags, 'pixi-version');
  const scrollName = text(flags, 'scroll');
  if (!pixiVersion && scrollName) {
    const reference = await selectScrollReference(scrollName, flags);
    pixiVersion = (await readScroll(reference)).scroll.pixiVersion;
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
  const reference = await selectScrollReference(name, flags);
  const write = Boolean(flags.get('write'));
  const { summary, reviewed, written } = await auditScroll(reference, {
    write,
    namespace: text(flags, 'namespace') || undefined,
  });
  info(`${summary.packageCount} packages for ${summary.scrollId} (${summary.targetId})`);
  for (const entry of summary.licenses) console.log(`  ${String(entry.count).padStart(4)}  ${entry.license}`);
  if (written) success(`Wrote reviewed audit: ${reviewed}`);
  else if (reviewed) success(`Matches the reviewed audit: ${reviewed}`);
}

async function build(name, flags) {
  const reference = await selectScrollReference(name, flags);
  const signing = {
    ...keyPaths(flags),
    signerCommand: text(flags, 'signer-command'),
  };
  await ensureBuildSigningKeys(signing);
  // Asked at the CLI edge and passed down: buildBox never reads a terminal itself.
  const channel = await chooseCliValue(
    'channel',
    ['beta', ...CHANNELS.filter((value) => value !== 'beta')],
    { flag: text(flags, 'channel') },
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

async function runRelease(path, flags, args) {
  return runCliBox(path, {
    publicPath: keyPaths(flags).publicPath,
    archive: text(flags, 'archive'),
    args,
    log: step,
  });
}

function usage() {
  console.log(`Usage: scrollcase <command> [options]

Commands:
  init                       Initialize a workspace with a runnable example
  new scroll                 Create one guided target-specific scroll
  doctor                     Report whether this machine can build a box
  keygen                     Create a local ed25519 signing key
  lock [<scroll>]            Resolve the scroll's pixi manifest into pixi.lock
  audit <scroll>             Dependency licence inventory, derived from the lock
  build [<scroll>]           Build, self-test, archive, and sign a box
  verify <release.json>      Verify signature, archive hash, and layout
  run <release.json>         Verify, temporarily extract, and run a local box

Init options:
  --pixi-version <version>   Install this pixi release when setup is approved
  --no-example              Initialize an empty workspace without example-box
  --install-toolchain        Install missing pixi/conda-pack without asking
  --no-install-toolchain     Never install them; just report what is missing
                             With neither flag, init asks before downloading anything, and
                             installs into <toolchain> after a verified checksum check.

New scroll options:
  --target <targetId>        Complete target, including the CUDA ABI when applicable
  --box-id <id>              Box identity
  --model-id <id>            Packaged model identity
  --runtime-id <id>          Runtime identity
  --version <version>        Box version
  --scroll-version <version> Scroll authoring version
  --source-revision <rev>    Upstream source revision recorded in provenance
  --python-version <version> Python dependency version
  --pixi-version <version>   pixi resolver version
  --min-host-app-version <v> Minimum compatible host application version
  --asset-base-url <url>     Base URL used in built release documents
  --weights <mode>           embed or on-demand
  --execution <kind>         python-script, python-module, or library-only
  --script <path>            Existing project script for python-script
  --generate-script          Generate a minimal project script instead
  --script-destination <path> Payload path for the script (default entrypoint.py)
  --generated-script-path <path> Project path for a generated starter
  --module <name>            Dotted module name for python-module
  --default-args <json>      JSON array of default application arguments
  --max-host-app-version-exclusive <v>
  --min-macos-version <v>
  --min-ram-gb <number>
  --min-nvidia-driver-version <v>
                             Without a terminal, every material value must be supplied.

Doctor options:
  --scroll <name>            Take the required pixi version from this scroll
  --target <targetId>        Select a target when <name> is a box with several scrolls
  --pixi-version <version>   Check for this pixi release

Keygen options:
  --key-id <id>              Identifier recorded in signatures (default derived from key)
  --force                    Overwrite both named key files; unsafe for rotation

Audit options:
  --target <targetId>        Select a target when <scroll> names a box
  --write                    Write the inventory to the scroll's reviewed audit path
  --namespace <ns>           Document kind namespace (default scrollcase.box)

Build options:
  --target <targetId>        Select a target when <scroll> names a box
  --channel <name>           Channel the signed pointer names (nightly, beta, or stable;
                             default beta)
  --weights <mode>           embed (default: assets packed in, works air-gapped) or
                             on-demand (caller-materialized; verified before execution)
                             Without either flag, build shows an arrow-key menu. With no
                             terminal to ask, it says which default it took and carries on.
  --asset-base-url <url>     Override the scroll's published base URL
  --namespace <ns>           Document kind namespace (default scrollcase.box)
  --allow-dirty              Permit a build from an uncommitted source tree
  --pixi <path>              Use this pixi executable
  --conda-pack <path>        Use this conda-pack executable (managed installs pin 0.9.2)

Scroll targets:
  lock, audit and build accept either <boxId>/<targetId> or a box ID plus
  --target <targetId>. With only a box ID, a terminal shows an arrow-key menu.
  lock and build also let an interactive terminal choose from every workspace
  scroll when the argument is omitted; non-interactive callers must name one.
  A sole target for this host is the default; Metal is preferred on macOS.
  Without a terminal, any other ambiguous target is an error.

Verify options:
  --archive <path>           Archive to check, if not beside the release document
  --self-test                Extract and import with the box's own interpreter

Run:
  scrollcase run <release.json> [--archive <box.zip>] -- [application args]
  --archive <path>           Local archive, if not beside the release document
                             Uses --public-key from Signing below, attaches terminal stdio,
                             forwards signals, and exits with the application result.

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
  --scrolls-dir <dir>        Where scrolls live (default scrolls)
  --build-dir <dir>          Payload scratch space (default .scrollcase/build)
  --out-dir <dir>            Built artefacts (default .scrollcase/dist)
  --keys-dir <dir>           Local signing keys (default .scrollcase/keys)
  --toolchain-dir <dir>      Project-local pixi/conda-pack (default .scrollcase/toolchain)
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags, passthrough } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') return usage();
  // Resolve the workspace before any command touches a path, so flags win over the project config.
  configureWorkspace({ overrides: workspaceOverridesFromFlags(flags) });
  if (command === 'init') return init(flags);
  if (command === 'new') {
    if (positional[0] !== 'scroll' || positional.length !== 1) {
      fail('Usage: scrollcase new scroll [options]');
    }
    return newScroll(flags);
  }
  if (command === 'doctor') return doctor(flags);
  if (command === 'keygen') return keygen(flags);
  if (command === 'audit') return audit(positional[0] || fail('audit requires a scroll name.'), flags);
  if (command === 'lock') return lock(positional[0], flags);
  if (command === 'build') return build(positional[0], flags);
  if (command === 'verify') return verify(positional[0] || fail('verify requires a signed release document.'), flags);
  if (command === 'run') {
    if (positional.length !== 1) fail('Usage: scrollcase run <release.json> [--archive <box.zip>] -- [application args]');
    return runRelease(positional[0], flags, passthrough);
  }
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
