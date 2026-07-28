/**
 * Target choices at the CLI edge.
 *
 * Modules beneath the CLI receive a resolved recipe or target and never read a terminal. This file
 * owns the one interactive policy: a sole target for the current host may be the default, while two
 * host-buildable targets are a real choice and therefore have no default. Non-interactive callers
 * get the same decision without ever blocking.
 */

import { createInterface } from 'node:readline/promises';
import { boxTargetAdapters, boxTargetId } from './contract/targets.mjs';
import { compareStableStrings } from './build/filesystem.mjs';
import { fail } from './build/process.mjs';

/** Parses a complete canonical target ID back into the target it names. */
export function parseCliTarget(value) {
  const targetId = String(value);
  for (const adapter of boxTargetAdapters()) {
    for (const accelerator of Object.keys(adapter.validationEnvironments)) {
      const target = { platform: adapter.platform, arch: adapter.arch, accelerator };
      if (accelerator === 'cuda') {
        const prefix = `${adapter.platform}-${adapter.arch}-cuda`;
        if (!targetId.startsWith(prefix)) continue;
        target.cudaVersion = targetId.slice(prefix.length);
      }
      try {
        if (boxTargetId(target) === targetId) return target;
      } catch {
        // Keep looking. A partial CUDA ID reaches here, then receives the one canonical error below.
      }
    }
  }
  return fail(
    `Invalid target ${targetId}; specify a complete target such as `
    + 'macos-aarch64-metal or linux-x86_64-cuda12.4.',
  );
}

/**
 * Lists target families for `init`. CUDA is shown without an ABI version; selecting it is followed
 * by the separate version question that turns it into a complete canonical target.
 */
export function cliTargetFamilies(platform) {
  const families = [];
  for (const adapter of boxTargetAdapters()) {
    if (platform && adapter.platform !== platform) continue;
    for (const accelerator of Object.keys(adapter.validationEnvironments)) {
      families.push({
        adapter,
        target: { platform: adapter.platform, arch: adapter.arch, accelerator },
        targetId: `${adapter.platform}-${adapter.arch}-${accelerator}`,
      });
    }
  }
  return families.sort((left, right) => compareStableStrings(left.targetId, right.targetId));
}

/**
 * Chooses one target candidate under the CLI's terminal policy.
 *
 * @template {{ targetId: string, adapter: { host: { platform: string, arch: string } } }} T
 * @param {T[]} candidates
 * @param {{ requested?: string | null, terminal?: boolean,
 *   host?: { platform: string, arch: string }, ask?: (prompt: string) => Promise<string>,
 *   log?: (message: string) => void }} [options]
 * @returns {Promise<T>}
 */
export async function chooseTarget(candidates, {
  requested = null,
  terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  host = { platform: process.platform, arch: process.arch },
  ask = null,
  log = console.log,
} = {}) {
  if (candidates.length === 0) fail('No supported targets are available.');
  const choices = [...candidates]
    .sort((left, right) => compareStableStrings(left.targetId, right.targetId));
  if (new Set(choices.map(({ targetId }) => targetId)).size !== choices.length) {
    fail('Target choices must have unique canonical IDs.');
  }

  if (requested) {
    const selected = choices.find((candidate) => candidate.targetId === requested);
    if (!selected) {
      fail(`Target ${requested} is not available; choose one of ${choices.map(({ targetId }) => targetId).join(', ')}.`);
    }
    return selected;
  }
  if (choices.length === 1) return choices[0];

  const native = choices.filter(({ adapter }) =>
    adapter.host.platform === host.platform && adapter.host.arch === host.arch);
  const fallback = native.length === 1 ? native[0] : null;
  if (!terminal) {
    if (fallback) {
      log(`scrollcase: no terminal to ask which target; using host target ${fallback.targetId}.`);
      return fallback;
    }
    if (native.length > 1) {
      fail(
        `This host can build more than one available target (${native.map(({ targetId }) => targetId).join(', ')}); `
        + 'specify --target <targetId>.',
      );
    }
    fail(
      `No available target is an unambiguous match for this host; specify --target <targetId> `
      + `from ${choices.map(({ targetId }) => targetId).join(', ')}.`,
    );
  }

  const readline = ask ? null : createInterface({ input: process.stdin, output: process.stdout });
  const question = ask ?? ((prompt) => readline.question(prompt));
  try {
    for (;;) {
      const suffix = fallback ? ` (${fallback.targetId})` : '';
      const answer = (await question(`Which target? [${choices.map(({ targetId }) => targetId).join('/')}]${suffix} `)).trim();
      if (!answer && fallback) return fallback;
      if (!answer) {
        log('Choose one target; this host has no unambiguous default.');
        continue;
      }
      const selected = choices.find(({ targetId }) => targetId === answer);
      if (selected) return selected;
      log(`Not one of ${choices.map(({ targetId }) => targetId).join(', ')}.`);
    }
  } finally {
    readline?.close();
  }
}
