import { spawnSync } from 'node:child_process';

/** Throws a consistent CLI error from validation helpers. */
export function fail(message) {
  throw new Error(message);
}

/** Runs a subprocess without interpreting its result. */
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

/** Runs a subprocess and throws when it cannot start or exits unsuccessfully. */
export function run(command, args, options = {}) {
  const result = runResult(command, args, options);
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    fail(`${command} exited with status ${result.status}${detail}`);
  }
  return (result.stdout ?? '').trim();
}
