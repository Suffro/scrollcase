/**
 * Interactive and scripted input collection for `scrollcase new scroll`.
 *
 * This is a CLI-edge module: finite decisions use the shared navigable menu, free-form values use
 * explicit text prompts, and a non-terminal process must provide every material value as a flag.
 * The build layer receives one complete object and never reads a terminal.
 */

import { createInterface } from 'node:readline/promises';
import { fail } from './build/process.mjs';
import { chooseCliValue } from './cli-menu.mjs';
import { chooseTarget, cliTargetFamilies, parseCliTarget } from './cli-targets.mjs';

const flagText = (flags, name) => {
  if (!flags.has(name)) return null;
  const value = flags.get(name);
  if (typeof value !== 'string' || value.trim() === '') fail(`--${name} requires a value.`);
  return value.trim();
};

async function promptText(question, {
  defaultValue = null,
  optional = false,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const readline = createInterface({ input, output });
  try {
    const suffix = defaultValue === null ? '' : ` [${defaultValue}]`;
    const value = (await readline.question(`${question}${suffix}: `)).trim();
    if (value) return value;
    if (defaultValue !== null) return defaultValue;
    if (optional) return null;
    fail(`${question} is required.`);
  } finally {
    readline.close();
  }
}

function parseDefaultArgs(value) {
  if (value === null) return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail('--default-args must be a JSON array of strings.');
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    fail('--default-args must be a JSON array of strings.');
  }
  return parsed;
}

async function collectTarget(flags, { terminal, ask, chooseTargetValue }) {
  const requested = flagText(flags, 'target');
  if (requested) return parseCliTarget(requested);
  if (!terminal) fail('new scroll requires --target <targetId> without a terminal.');

  const selected = await chooseTargetValue(cliTargetFamilies(), { terminal: true });
  if (selected.target.accelerator !== 'cuda') return parseCliTarget(selected.targetId);
  const cudaVersion = await ask('CUDA version (major.minor)');
  return parseCliTarget(`${selected.targetId}${cudaVersion}`);
}

/**
 * Collects a complete `createScroll` argument object from flags or interactive prompts.
 *
 * @param {ReadonlyMap<string, unknown>} flags
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function collectNewScrollOptions(flags, {
  terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  ask = promptText,
  choose = chooseCliValue,
  chooseTargetValue = chooseTarget,
} = {}) {
  const required = async (flag, question, defaultValue = null) => {
    const supplied = flagText(flags, flag);
    if (supplied !== null) return supplied;
    if (!terminal) fail(`new scroll requires --${flag} <value> without a terminal.`);
    return ask(question, { defaultValue });
  };
  const optional = async (flag, question) => {
    const supplied = flagText(flags, flag);
    if (supplied !== null) return supplied;
    if (!terminal) return null;
    return ask(question, { optional: true });
  };
  const finite = async (flag, question, choices) => {
    const supplied = flagText(flags, flag);
    if (!supplied && !terminal) {
      fail(`new scroll requires --${flag} <${choices.join('|')}> without a terminal.`);
    }
    return choose(question, choices, { flag: supplied, terminal });
  };

  const target = await collectTarget(flags, { terminal, ask, chooseTargetValue });
  const boxId = await required('box-id', 'Box ID');
  const modelId = await required('model-id', 'Model ID');
  const runtimeId = await required('runtime-id', 'Runtime ID');
  const version = await required('version', 'Box version', '1.0.0');
  const scrollVersion = await required('scroll-version', 'Scroll version', '1.0.0');
  const sourceRevision = await required('source-revision', 'Upstream source revision');
  const pythonVersion = await required('python-version', 'Python version', '3.11');
  const pixiVersion = await required('pixi-version', 'pixi version');
  const minHostAppVersion = await required(
    'min-host-app-version',
    'Minimum host application version',
    '1.0.0',
  );
  const compatibility = { minHostAppVersion };
  const maxHostAppVersionExclusive = await optional(
    'max-host-app-version-exclusive',
    'Maximum host application version (exclusive, optional)',
  );
  if (maxHostAppVersionExclusive) compatibility.maxHostAppVersionExclusive = maxHostAppVersionExclusive;
  if (target.platform === 'macos') {
    const minMacosVersion = await optional('min-macos-version', 'Minimum macOS version (optional)');
    if (minMacosVersion) compatibility.minMacosVersion = minMacosVersion;
  }
  const minRam = await optional('min-ram-gb', 'Minimum RAM in GB (optional)');
  if (minRam !== null) {
    const minRamGb = Number(minRam);
    if (!Number.isFinite(minRamGb) || minRamGb <= 0) fail('--min-ram-gb must be a positive number.');
    compatibility.minRamGb = minRamGb;
  }
  if (target.accelerator === 'cuda') {
    const minNvidiaDriverVersion = await optional(
      'min-nvidia-driver-version',
      'Minimum NVIDIA driver version (optional)',
    );
    if (minNvidiaDriverVersion) compatibility.minNvidiaDriverVersion = minNvidiaDriverVersion;
  }
  const assetBaseUrl = await required('asset-base-url', 'Asset base URL');
  const weights = await finite('weights', 'weights mode', ['embed', 'on-demand']);
  const executionKind = await finite(
    'execution',
    'execution kind',
    ['python-script', 'python-module', 'library-only'],
  );
  const defaultArgs = parseDefaultArgs(flagText(flags, 'default-args'));

  const result = {
    boxId,
    target,
    modelId,
    runtimeId,
    version,
    scrollVersion,
    sourceRevision,
    pythonVersion,
    pixiVersion,
    compatibility,
    assetBaseUrl,
    weights,
    executionKind,
    defaultArgs,
  };
  if (executionKind === 'python-module') {
    result.module = await required('module', 'Python module');
  } else if (executionKind === 'python-script') {
    const existing = flagText(flags, 'script');
    const generateScript = Boolean(flags.get('generate-script'));
    if (existing && generateScript) {
      fail('Choose either --script <path> or --generate-script, not both.');
    }
    if (existing) result.scriptSourcePath = existing;
    else if (generateScript) result.generateScript = true;
    else if (!terminal) {
      fail('python-script execution requires --script <path> or --generate-script without a terminal.');
    } else {
      const source = await choose(
        'script source',
        ['existing project script', 'generate starter script'],
        { terminal: true },
      );
      if (source === 'existing project script') {
        result.scriptSourcePath = await ask('Project-relative script path');
      } else result.generateScript = true;
    }
    result.scriptRelativePath = flagText(flags, 'script-destination') ?? 'entrypoint.py';
    const generatedScriptSourcePath = flagText(flags, 'generated-script-path');
    if (generatedScriptSourcePath) result.generatedScriptSourcePath = generatedScriptSourcePath;
  }
  return result;
}
