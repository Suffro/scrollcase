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
export function fail(message: unknown): never;
/**
 * Runs a subprocess without interpreting its result.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {RunOptions} [options]
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function runResult(command: string, args: readonly string[], options?: RunOptions): import("node:child_process").SpawnSyncReturns<string>;
/**
 * Runs a subprocess and throws when it cannot start or exits unsuccessfully.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {RunOptions} [options]
 * @returns {string}
 */
export function run(command: string, args: readonly string[], options?: RunOptions): string;
/**
 * Subprocess options shared by the library surface and its injected test seams.
 */
export type RunOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string | Uint8Array;
    maxBuffer?: number;
    capture?: boolean;
};
