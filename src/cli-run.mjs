/**
 * The `run` command's deliberately thin edge over the Node consumer.
 *
 * Verification, extraction, execution, signals, and cleanup remain owned by `runBox`. This module
 * adds only terminal presentation and translates the child's terminal result into CLI process
 * semantics.
 *
 * Everything this module prints goes to stderr, because stdout belongs to the box. A box whose
 * output is piped into a file or another process must deliver exactly its own bytes; a status line
 * mixed into that stream corrupts it, and the box has no way to tell.
 */

import { runBox } from './consumer/index.mjs';

/** Formats a byte count for one short status line, never for a decision. */
function readableSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const gigabytes = bytes / 1024 ** 3;
  if (gigabytes >= 1) return `${gigabytes.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/**
 * Runs one local release through the consumer and applies its terminal result to this process.
 *
 * @param {string} releaseDocumentPath
 * @param {{
 *   publicPath: string,
 *   archive?: string | null,
 *   args?: readonly string[],
 *   run?: typeof runBox,
 *   log?: (message: string) => void,
 *   setExitCode?: (code: number) => void,
 *   terminate?: (signal: NodeJS.Signals) => void,
 * }} options
 * @returns {Promise<import('./consumer/run-extracted.mjs').BoxRunResult>}
 */
export async function runCliBox(releaseDocumentPath, {
  publicPath,
  archive = null,
  args = [],
  run = runBox,
  log = console.error,
  setExitCode = (code) => {
    process.exitCode = code;
  },
  terminate = (signal) => {
    process.kill(process.pid, signal);
  },
}) {
  const result = await run(releaseDocumentPath, {
    publicPath,
    archive,
    args,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    onPrepared: (prepared) => {
      log(
        `Running ${prepared.boxId} ${prepared.version} `
        + `(${prepared.targetId}, ${prepared.execution?.kind ?? 'library-only'})`,
      );
      // Printed on every run, not only for large boxes. `run` is one-shot by design, and a caller
      // who does not know that reads a repeated multi-gigabyte extraction as the tool being slow.
      // One line, always the same shape, so it stays skippable once it has been read.
      const size = readableSize(prepared.installedSizeBytes);
      log(`${size ? `${size} extracted` : 'Extracted'} to a temporary directory, deleted on exit.`);
    },
  });
  if (result.signal) terminate(result.signal);
  else setExitCode(result.exitCode ?? 1);
  return result;
}
