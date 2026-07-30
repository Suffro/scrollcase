/**
 * Optional dependencies for the generated consumer templates.
 *
 * These installations belong to the initialized project, not Scrollcase's managed build
 * toolchain. Every command therefore runs from the workspace root, beside
 * `scrollcase.config.json`. Node uses the root package and `node_modules`; Python uses the
 * interpreter selected from the caller's environment. Consent and the Python package source are
 * chosen at the CLI edge and passed in explicitly.
 */

import { readFileSync } from 'node:fs';
import { fail, run as defaultRun, runResult as defaultRunResult } from './process.mjs';

const packageJson = JSON.parse(readFileSync(
  new URL('../../package.json', import.meta.url),
  'utf8',
));

export const SCROLLCASE_NPM_VERSION = packageJson.version;

export function installTypeScriptConsumerDependencies({
  root,
  scrollcaseVersion = SCROLLCASE_NPM_VERSION,
  platform = process.platform,
  comspec = process.env.ComSpec || 'cmd.exe',
  run = defaultRun,
}) {
  const runNpm = (args) => {
    if (platform === 'win32') {
      // npm is a .cmd shim on Windows, which spawnSync cannot execute directly.
      run(comspec, ['/d', '/s', '/c', 'npm', ...args], { cwd: root });
      return;
    }
    run('npm', args, { cwd: root });
  };
  runNpm(['install', `scrollcase@${scrollcaseVersion}`]);
  runNpm(['install', '--save-dev', 'tsx', 'typescript']);
  return { scrollcaseVersion };
}

function findPython({ root, runResult }) {
  for (const command of ['python', 'python3', 'py']) {
    const result = runResult(command, ['--version'], { capture: true, cwd: root });
    if (!result.error && result.status === 0) return command;
  }
  fail('Python was not found. Install Python 3.10 or newer, then re-run scrollcase init.');
}

export function isCondaAvailable({
  root,
  runResult = defaultRunResult,
}) {
  const result = runResult('conda', ['--version'], { capture: true, cwd: root });
  return !result.error && result.status === 0;
}

export function installPythonConsumerDependency({
  root,
  source,
  run = defaultRun,
  runResult = defaultRunResult,
}) {
  if (!['pypi', 'conda-forge'].includes(source)) {
    fail(`Unsupported Python consumer source ${source}.`);
  }

  if (source === 'pypi') {
    const command = findPython({ root, runResult });
    const args = ['-m', 'pip', 'install', 'scrollcase-consumer'];
    const result = runResult(command, args, { capture: true, cwd: root });
    if (result.error) fail(`${command} failed to start: ${result.error.message}`);
    if (result.status === 0) return { source, command };

    const detail = `${result.stderr || ''}\n${result.stdout || ''}`;
    if (/externally-managed-environment/i.test(detail)) {
      // PEP 668 blocks even user installs unless pip receives the override. Pairing it with
      // --user keeps package files out of Homebrew's or the distribution's managed prefix.
      run(
        command,
        [
          '-m',
          'pip',
          'install',
          '--user',
          '--break-system-packages',
          'scrollcase-consumer',
        ],
        { cwd: root },
      );
      return { source, command };
    }
    fail(`${command} exited with status ${result.status}\n${detail.trim()}`);
  }

  if (!isCondaAvailable({ root, runResult })) {
    fail('Conda is not installed. Re-run scrollcase init and choose PyPI with pip.');
  }
  run(
    'conda',
    [
      'install',
      '--yes',
      '--channel',
      'conda-forge',
      'scrollcase-consumer',
    ],
    { cwd: root },
  );
  return { source, command: 'python' };
}
