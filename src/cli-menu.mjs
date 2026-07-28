/**
 * Navigable choices at the CLI edge.
 *
 * Closed choices use one raw-key menu instead of several subtly different text prompts. Free-form
 * values and safety consent remain explicit flags or text input: a menu must not pretend they are
 * finite choices.
 */

import { emitKeypressEvents } from 'node:readline';
import { fail } from './build/process.mjs';

/** Shows a raw-key menu and resolves to the selected index. */
export function selectCliMenu(question, choices, {
  initialIndex = null,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    fail(`${question} selection requires an interactive terminal.`);
  }

  return new Promise((resolve, reject) => {
    let selectedIndex = initialIndex;
    const previousRawMode = Boolean(input.isRaw);
    const frameLines = choices.length + 1;
    let firstFrame = true;

    const render = () => {
      if (!firstFrame) output.write(`\x1b[${frameLines}A`);
      for (let index = 0; index < choices.length; index += 1) {
        const marker = index === selectedIndex ? '❯' : ' ';
        output.write(`\x1b[2K\r${marker} ${choices[index]}\n`);
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
        reject(new Error(`${question} selection cancelled.`));
        return;
      }
      if (key.name === 'up') {
        selectedIndex = selectedIndex === null
          ? choices.length - 1
          : (selectedIndex - 1 + choices.length) % choices.length;
        render();
      } else if (key.name === 'down') {
        selectedIndex = selectedIndex === null ? 0 : (selectedIndex + 1) % choices.length;
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
    output.write(`Which ${question}?\n\x1b[?25l`);
    render();
  });
}

/**
 * Resolves a CLI choice from a flag, a menu, or the reported non-terminal default.
 *
 * `open` applies only to explicit flags; custom values cannot be represented by a finite menu.
 */
export async function chooseCliValue(question, choices, {
  flag = null,
  open = false,
  terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  menu = selectCliMenu,
  log = console.log,
} = {}) {
  const [fallback] = choices;
  if (flag) {
    if (!open && !choices.includes(flag)) {
      fail(`Unsupported ${question}: ${flag}. Use ${choices.join(' or ')}.`);
    }
    return flag;
  }
  if (!terminal) {
    log(`scrollcase: no terminal to ask which ${question}; using ${fallback}.`);
    return fallback;
  }
  const selectedIndex = await menu(question, choices, { initialIndex: 0 });
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= choices.length) {
    fail(`${question} menu returned an invalid selection.`);
  }
  return choices[selectedIndex];
}
