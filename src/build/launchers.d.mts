/**
 * Makes generated POSIX console scripts resolve Python relative to their own installed path.
 *
 * @param {import('../contract/targets.mjs').BoxTargetAdapter} adapter
 * @param {string} payloadDir
 * @param {readonly string[]} forbiddenPaths
 * @returns {Promise<void>}
 */
export function repairPosixLaunchers(adapter: import("../contract/targets.mjs").BoxTargetAdapter, payloadDir: string, forbiddenPaths: readonly string[]): Promise<void>;
