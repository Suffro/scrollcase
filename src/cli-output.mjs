/**
 * Restrained terminal presentation for the human CLI.
 *
 * Symbols keep redirected logs readable on their own; ANSI colour is an optional enhancement only
 * for a real terminal, and `NO_COLOR` always wins. The library modules remain presentation-free.
 */

import { dirname, relative, sep } from 'node:path';

const styles = Object.freeze({
  success: { symbol: '✓', ansi: 32 },
  step: { symbol: '→', ansi: 36 },
  info: { symbol: '·', ansi: 90 },
  warning: { symbol: '⚠', ansi: 33 },
  error: { symbol: '✗', ansi: 31 },
});

/** Formats one CLI status line, colouring only its symbol when the terminal supports it. */
export function statusLine(kind, message, {
  stream = process.stdout,
  env = process.env,
} = {}) {
  const style = styles[kind];
  const colour = Boolean(stream.isTTY && !Object.hasOwn(env, 'NO_COLOR') && env.TERM !== 'dumb');
  const symbol = colour ? `\x1b[${style.ansi}m${style.symbol}\x1b[0m` : style.symbol;
  return `${symbol} ${message}`;
}

/** Builds the concise, relative distribution instruction printed after a successful build. */
export function buildDistributionSummary({ archivePath, channelPath }, distDir) {
  const displayPath = (path) => relative(distDir, path).split(sep).join('/');
  return `Build complete — you can distribute the 2 files under ${displayPath(dirname(archivePath))}/ `
    + `and ${displayPath(channelPath)}`;
}
