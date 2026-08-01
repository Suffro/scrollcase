/**
 * Static execution prerequisites shared by the builder and verifier.
 *
 * Execution metadata is not a command string: it names either one regular payload file or one
 * dotted Python module. Checking the archive file set proves those names can resolve without
 * importing a package, running an `__init__.py`, or starting the application. The later consumer
 * may therefore launch only after the complete trust chain has passed.
 */

import { safeRelativePath } from './filesystem.mjs';
import { fail } from './process.mjs';

function pythonMajorMinor(version) {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
  if (!match) fail(`Invalid Python version for execution discovery: ${version}.`);
  return `${match[1]}.${match[2]}`;
}

function moduleEntryPoints({ adapter, module, pythonVersion }) {
  const modulePath = module.split('.').join('/');
  const relativeCandidates = [`${modulePath}.py`, `${modulePath}/__main__.py`];
  const standardLibrary = adapter.platform === 'windows'
    ? 'venv/Lib'
    : `venv/lib/python${pythonMajorMinor(pythonVersion)}`;
  const roots = ['', standardLibrary, `${standardLibrary}/site-packages`];
  return roots.flatMap((root) =>
    relativeCandidates.map((path) => (root ? `${root}/${path}` : path)));
}

/**
 * Confirms that optional execution metadata names runnable regular files in a payload/archive.
 *
 * `files` must contain only regular archive entries. Both collectFiles() during build and the ZIP
 * entry classifier during verify provide exactly that representation.
 */
export function assertExecutionFiles({
  execution,
  adapter,
  pythonVersion,
  files,
}) {
  if (!execution) return;
  if (execution.kind === 'python-script') {
    const script = safeRelativePath(execution.script);
    if (!files.has(script)) fail(`Execution script is missing from the box: ${script}.`);
    return;
  }
  if (execution.kind === 'python-module') {
    const candidates = moduleEntryPoints({
      adapter,
      module: execution.module,
      pythonVersion,
    });
    if (!candidates.some((path) => files.has(path))) {
      fail(`Execution module is not discoverable in the box: ${execution.module}.`);
    }
    return;
  }
  fail(`Unsupported execution kind: ${String(execution.kind)}.`);
}
