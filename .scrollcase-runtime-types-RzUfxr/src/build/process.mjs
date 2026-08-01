/**
 * Error and subprocess primitives for the whole tool.
 *
 * Every validation failure funnels through `fail`, and every external command through `run` /
 * `runResult` — which is also the seam the tests use: injecting a fake runner is how the pipeline
 * suite builds boxes without pixi or conda-pack installed.
 */
import { spawnSync } from 'node:child_process';

/**
 * Subprocess options shared by the library surface and its injected test seams.
 *
 * @typedef {object} RunOptions
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string | Uint8Array} [input]
 * @property {number} [maxBuffer]
 * @property {boolean} [capture]
 */

/**
 * Throws a consistent CLI error from validation helpers.
 *
 * @param {unknown} message
 * @returns {never}
 */
export function fail(message) {
  throw new Error(message);
}

/**
 * Runs a subprocess without interpreting its result.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {RunOptions} [options]
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function runResult(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.capture ? 'pipe' : ['pipe', 'inherit', 'inherit'],
  });
}

/**
 * Runs a subprocess and throws when it cannot start or exits unsuccessfully.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {RunOptions} [options]
 * @returns {string}
 */
export function run(command, args, options = {}) {
  const result = runResult(command, args, options);
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    fail(`${command} exited with status ${result.status}${detail}`);
  }
  return (result.stdout ?? '').trim();
}
