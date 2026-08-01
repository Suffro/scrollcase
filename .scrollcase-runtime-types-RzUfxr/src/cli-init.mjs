/**
 * Orders the optional work performed by `scrollcase init`.
 *
 * Every answer is collected before the first installer runs. Besides making the interaction easier
 * to review, this prevents an early download or package install from interrupting the remaining
 * questions and leaving the user's choices only half collected.
 */

export async function resolvePythonConsumerSource({
  selectedSource,
  condaAvailable,
  confirmPyPIFallback,
}) {
  if (selectedSource !== 'conda-forge' || condaAvailable) return selectedSource;
  return await confirmPyPIFallback() ? 'pypi' : null;
}

export async function runInitDependencySetup({
  hasExample,
  confirmTypeScript,
  confirmPython,
  choosePythonSource,
  installToolchain,
  installTypeScript,
  installPython,
}) {
  let shouldInstallTypeScript = false;
  let pythonSource = null;

  if (hasExample) {
    shouldInstallTypeScript = await confirmTypeScript();
    if (await confirmPython()) pythonSource = await choosePythonSource();
  }

  const toolchain = await installToolchain();
  const typescript = shouldInstallTypeScript ? installTypeScript() : null;
  const python = pythonSource ? installPython(pythonSource) : null;

  return {
    installTypeScript: shouldInstallTypeScript,
    pythonSource,
    toolchain,
    typescript,
    python,
  };
}
