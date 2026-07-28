/**
 * Target choices at the CLI edge.
 *
 * Modules beneath the CLI receive a resolved recipe or target and never read a terminal. This file
 * owns the one interactive policy: choices are made through a keyboard menu, with a sole native
 * target as the default and Metal preferred on macOS. Non-interactive callers get the same
 * decision without ever blocking.
 */

import { emitKeypressEvents } from 'node:readline';
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

/** Shows a raw-key target menu and resolves to the selected index. */
export function selectTargetMenu(targetIds, {
  initialIndex = null,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    fail('Target selection requires an interactive terminal.');
  }

  return new Promise((resolve, reject) => {
    let selectedIndex = initialIndex;
    const previousRawMode = Boolean(input.isRaw);
    const frameLines = targetIds.length + 1;
    let firstFrame = true;

    const render = () => {
      if (!firstFrame) output.write(`\x1b[${frameLines}A`);
      for (let index = 0; index < targetIds.length; index += 1) {
        const marker = index === selectedIndex ? '❯' : ' ';
        output.write(`\x1b[2K\r${marker} ${targetIds[index]}\n`);
      }
      output.write('\x1b[2K\rUse ↑/↓ to move, Enter to select.\n');
      firstFrame = false;
    };

    const cleanup = () => {
      input.removeListener('keypress', onKeypress);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write('\x1b[?25h');
    };

    const onKeypress = (_character, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Target selection cancelled.'));
        return;
      }
      if (key.name === 'up') {
        selectedIndex = selectedIndex === null
          ? targetIds.length - 1
          : (selectedIndex - 1 + targetIds.length) % targetIds.length;
        render();
      } else if (key.name === 'down') {
        selectedIndex = selectedIndex === null ? 0 : (selectedIndex + 1) % targetIds.length;
        render();
      } else if ((key.name === 'return' || key.name === 'enter') && selectedIndex !== null) {
        cleanup();
        resolve(selectedIndex);
      }
    };

    emitKeypressEvents(input);
    input.on('keypress', onKeypress);
    input.setRawMode(true);
    input.resume();
    output.write('Which target?\n\x1b[?25l');
    render();
  });
}

/**
 * Chooses one target candidate under the CLI's terminal policy.
 *
 * @template {{ targetId: string, adapter: { host: { platform: string, arch: string } } }} T
 * @param {T[]} candidates
 * @param {{ requested?: string | null, terminal?: boolean,
 *   host?: { platform: string, arch: string },
 *   menu?: (targetIds: string[], options: { initialIndex: number | null }) => Promise<number>,
 *   log?: (message: string) => void }} [options]
 * @returns {Promise<T>}
 */
export async function chooseTarget(candidates, {
  requested = null,
  terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  host = { platform: process.platform, arch: process.arch },
  menu = selectTargetMenu,
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
  const macMetal = host.platform === 'darwin'
    ? native.find(({ targetId }) => targetId.endsWith('-metal'))
    : null;
  const fallback = native.length === 1 ? native[0] : macMetal;
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

  const selectedIndex = await menu(choices.map(({ targetId }) => targetId), {
    initialIndex: fallback ? choices.indexOf(fallback) : null,
  });
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= choices.length) {
    fail('Target menu returned an invalid selection.');
  }
  return choices[selectedIndex];
}
