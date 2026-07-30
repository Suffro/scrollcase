/**
 * Optional dependencies for the generated consumer templates.
 *
 * These installations belong to the initialized project, not Scrollcase's managed build
 * toolchain. Every command therefore runs from the workspace root, beside
 * `scrollcase.config.json`. Python uses the conventional project-local `.venv`, avoiding any
 * externally managed system interpreter; Node uses the root package and `node_modules`. Consent
 * and the Python package source are chosen at the CLI edge and passed in explicitly.
 */

import { existsSync, readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
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

export function installPythonConsumerDependency({
  root,
  source,
  platform = process.platform,
  run = defaultRun,
  runResult = defaultRunResult,
  exists = existsSync,
}) {
  if (!['pypi', 'conda-forge'].includes(source)) {
    fail(`Unsupported Python consumer source ${source}.`);
  }

  const paths = platform === 'win32' ? win32 : posix;
  const environmentDir = paths.join(root, '.venv');
  const venvPython = platform === 'win32'
    ? paths.join(environmentDir, 'Scripts', 'python.exe')
    : paths.join(environmentDir, 'bin', 'python');
  const condaMetadata = paths.join(environmentDir, 'conda-meta');
  const condaPython = platform === 'win32'
    ? paths.join(environmentDir, 'python.exe')
    : paths.join(environmentDir, 'bin', 'python');

  if (source === 'pypi') {
    let environmentPython = venvPython;
    if (exists(condaMetadata)) environmentPython = condaPython;
    else if (!exists(venvPython)) {
      const command = findPython({ root, runResult });
      run(command, ['-m', 'venv', '.venv'], { cwd: root });
    }
    run(
      environmentPython,
      ['-m', 'pip', 'install', 'scrollcase-consumer'],
      { cwd: root },
    );
    return { source, command: environmentPython, environmentDir };
  }

  if (exists(venvPython) && !exists(condaMetadata)) {
    fail(`${environmentDir} already exists and is not a conda environment.`);
  }
  const action = exists(condaMetadata) ? 'install' : 'create';
  run(
    'conda',
    [
      action,
      '--yes',
      '--prefix',
      environmentDir,
      '--channel',
      'conda-forge',
      'scrollcase-consumer',
    ],
    { cwd: root },
  );
  return { source, command: condaPython, environmentDir };
}
