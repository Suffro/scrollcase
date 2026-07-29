/**
 * The `run` command's deliberately thin edge over the Node consumer.
 *
 * Verification, extraction, execution, signals, and cleanup remain owned by `runBox`. This module
 * adds only terminal presentation and translates the child's terminal result into CLI process
 * semantics.
 */

import { runBox } from './consumer/index.mjs';

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
  log = console.log,
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
    },
  });
  if (result.signal) terminate(result.signal);
  else setExitCode(result.exitCode ?? 1);
  return result;
}
