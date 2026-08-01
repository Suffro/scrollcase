/**
 * Reference implementation of the Scrollcase box-format target model.
 *
 * A target is the (platform, arch, accelerator) triple a box is built for, plus a CUDA ABI version
 * when the accelerator is CUDA. `boxTargetId()` turns it into the canonical slug that appears
 * in archive names, object keys, and registry routes, so every implementation of the format — this
 * one, a consumer's own client, a signer — must agree character for character. The golden cases in
 * `fixtures/target-id-contract.json` are what "agree" means, and are the fixtures other languages
 * validate their mirrors against.
 *
 * The adapters below describe what a target implies for the built payload: the Python layout inside
 * the box, the archive backend, how native libraries are inspected, and the environment a validation
 * run gets. They are part of the format because a consumer unpacking a box relies on that layout.
 */
/**
 * What a target implies for the built payload. Part of the format rather than an implementation
 * detail: a consumer unpacking a box relies on this layout.
 *
 * @typedef {object} BoxTargetAdapter
 * @property {string} id canonical adapter id, e.g. `macos-aarch64`
 * @property {'macos' | 'linux' | 'windows'} platform
 * @property {'aarch64' | 'x86_64'} arch
 * @property {{ platform: string, arch: string }} host the Node platform/arch a build must run on
 * @property {'osx-arm64' | 'linux-64' | 'win-64'} condaSubdir the scroll's pixi `platforms` value
 * @property {{ payloadRoot: string, entryPoint: string, scriptsDirectory: string,
 *   executableSuffix: string, launcherKind: string }} python layout of the interpreter in the box
 * @property {{ format: 'zip', writer: string, reader: string, assetTarReader: string,
 *   zip64: boolean }} archive the pinned archive backend
 * @property {{ command: string, argsPrefix: readonly string[],
 *   extensions: readonly string[] }} nativeLibraryInspection
 * @property {Readonly<Record<string, Readonly<Record<string, string>>>>} validationEnvironments
 *   the environment that forces a run onto one accelerator, keyed by accelerator
 * @property {string} selfTestPython the platform assertion prepended to every self-test
 */

const TARGET_ACCELERATORS = {
  macos: { aarch64: ['metal', 'cpu'] },
  linux: { x86_64: ['cpu', 'cuda'] },
  windows: { x86_64: ['cpu', 'cuda'] },
};
const CUDA_VERSION = /^[1-9][0-9]*\.[0-9]+$/;

// The exact libraries that wrote and read a box, so a consumer knows what produced the bytes it
// holds rather than inferring it. Each version is the one this package installs: they are pinned in
// `package.json` and `tests/unit/contract-targets.test.mjs` fails when the two drift, because a
// descriptor naming a release that never touched the archive is worse than no descriptor at all.
const ARCHIVE_BACKEND = Object.freeze({
  format: 'zip',
  writer: 'yazl@3.3.1',
  reader: 'yauzl@3.4.0',
  assetTarReader: 'tar@7.5.22',
  zip64: true,
});

const TARGET_ADAPTERS = Object.freeze([
  Object.freeze({
    id: 'macos-aarch64',
    platform: 'macos',
    arch: 'aarch64',
    host: Object.freeze({ platform: 'darwin', arch: 'arm64' }),
    // conda platform subdir: the `platforms` value in the scroll's pixi.toml.
    condaSubdir: 'osx-arm64',
    python: Object.freeze({
      payloadRoot: 'venv',
      entryPoint: 'venv/bin/python',
      scriptsDirectory: 'venv/bin',
      executableSuffix: '',
      launcherKind: 'posix-polyglot',
    }),
    archive: ARCHIVE_BACKEND,
    nativeLibraryInspection: Object.freeze({
      command: 'otool',
      argsPrefix: Object.freeze(['-L']),
      extensions: Object.freeze(['.dylib', '.so']),
    }),
    validationEnvironments: Object.freeze({
      cpu: Object.freeze({ CUDA_VISIBLE_DEVICES: '' }),
      metal: Object.freeze({ PYTORCH_ENABLE_MPS_FALLBACK: '0' }),
    }),
    selfTestPython: "import sys; assert sys.platform == 'darwin'",
  }),
  Object.freeze({
    id: 'linux-x86_64',
    platform: 'linux',
    arch: 'x86_64',
    host: Object.freeze({ platform: 'linux', arch: 'x64' }),
    condaSubdir: 'linux-64',
    python: Object.freeze({
      payloadRoot: 'venv',
      entryPoint: 'venv/bin/python',
      scriptsDirectory: 'venv/bin',
      executableSuffix: '',
      launcherKind: 'posix-polyglot',
    }),
    archive: ARCHIVE_BACKEND,
    nativeLibraryInspection: Object.freeze({
      command: 'ldd',
      argsPrefix: Object.freeze([]),
      extensions: Object.freeze(['.so']),
    }),
    validationEnvironments: Object.freeze({
      cpu: Object.freeze({ CUDA_VISIBLE_DEVICES: '' }),
      cuda: Object.freeze({ CUDA_VISIBLE_DEVICES: '0' }),
    }),
    selfTestPython: "import sys; assert sys.platform.startswith('linux')",
  }),
  Object.freeze({
    id: 'windows-x86_64',
    platform: 'windows',
    arch: 'x86_64',
    host: Object.freeze({ platform: 'win32', arch: 'x64' }),
    condaSubdir: 'win-64',
    python: Object.freeze({
      payloadRoot: 'venv',
      entryPoint: 'venv/python.exe',
      scriptsDirectory: 'venv/Scripts',
      executableSuffix: '.exe',
      launcherKind: 'uv-windows-pe',
    }),
    archive: ARCHIVE_BACKEND,
    nativeLibraryInspection: Object.freeze({
      command: 'dumpbin',
      argsPrefix: Object.freeze(['/DEPENDENTS']),
      extensions: Object.freeze(['.dll', '.pyd']),
    }),
    validationEnvironments: Object.freeze({
      cpu: Object.freeze({ CUDA_VISIBLE_DEVICES: '' }),
      cuda: Object.freeze({ CUDA_VISIBLE_DEVICES: '0' }),
    }),
    selfTestPython: "import sys; assert sys.platform == 'win32'",
  }),
]);

/**
 * Returns the canonical target slug used in box filenames, object keys, and routes.
 *
 * @param {import('./types/index.d.ts').BoxTarget} target
 * @returns {string} the canonical slug, e.g. `linux-x86_64-cuda12.4`
 * @throws {TypeError} when the target is outside the supported matrix, or its CUDA version is
 *   missing on a CUDA target or present on any other
 */
export function boxTargetId(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('Box target must be an object');
  }
  const accelerators = TARGET_ACCELERATORS[target?.platform]?.[target?.arch];
  if (!accelerators?.includes(target?.accelerator)) {
    throw new TypeError(
      `Unsupported box target: ${target?.platform}/${target?.arch}/${target?.accelerator}`,
    );
  }
  if (target.accelerator === 'cuda') {
    if (typeof target.cudaVersion !== 'string' || !CUDA_VERSION.test(target.cudaVersion)) {
      throw new TypeError('A CUDA box target requires a numeric major.minor CUDA version');
    }
    return `${target.platform}-${target.arch}-cuda${target.cudaVersion}`;
  }
  if (target.cudaVersion !== undefined) {
    throw new TypeError('Only CUDA box targets may declare a CUDA version');
  }
  return `${target.platform}-${target.arch}-${target.accelerator}`;
}

/**
 * Returns the native builder adapter for a validated box target.
 *
 * @param {import('./types/index.d.ts').BoxTarget} target
 * @returns {BoxTargetAdapter}
 * @throws {TypeError} when the target is unsupported
 */
export function boxTargetAdapter(target) {
  boxTargetId(target);
  const adapter = TARGET_ADAPTERS.find((candidate) =>
    candidate.platform === target.platform && candidate.arch === target.arch);
  if (!adapter) throw new TypeError(`No box target adapter exists for ${target.platform}/${target.arch}`);
  return adapter;
}

/**
 * Ensures a build or target lock runs on the OS and architecture it will ship for.
 *
 * @param {BoxTargetAdapter} adapter
 * @param {{ platform: string, arch: string }} [host] defaults to the current process
 * @returns {void}
 * @throws {TypeError} when the host is not the OS and architecture the box ships for
 */
export function assertNativeHost(adapter, host = process) {
  if (host.platform !== adapter.host.platform || host.arch !== adapter.host.arch) {
    throw new TypeError(
      `${adapter.id} boxes must be built natively on ${adapter.host.platform}/${adapter.host.arch}; `
      + `current host is ${host.platform}/${host.arch}`,
    );
  }
}

/**
 * Ensures the scroll entry point agrees with the adapter's standalone Python layout.
 *
 * @param {BoxTargetAdapter} adapter
 * @param {string} entryPoint
 * @returns {void}
 * @throws {TypeError} when the entry point does not match the adapter's layout
 */
export function assertPythonEntryPoint(adapter, entryPoint) {
  if (entryPoint !== adapter.python.entryPoint) {
    throw new TypeError(
      `${adapter.id} scrolls must use Python entry point ${adapter.python.entryPoint}`,
    );
  }
}

/**
 * Lists every adapter, for contract tests and for consumers enumerating supported targets.
 *
 * @returns {BoxTargetAdapter[]} every supported adapter, as a fresh array
 */
export function boxTargetAdapters() {
  return [...TARGET_ADAPTERS];
}

/**
 * Maps a validated box target to its conda platform subdir (the pixi `platforms` value).
 *
 * @param {import('./types/index.d.ts').BoxTarget} target
 * @returns {'osx-arm64' | 'linux-64' | 'win-64'} the pixi `platforms` value for the target
 */
export function condaSubdir(target) {
  const adapter = boxTargetAdapter(target);
  return adapter.condaSubdir;
}

/**
 * Returns the conda accelerator descriptor a scroll selects, rejecting target drift. `metal` and
 * `cpu` need no extra conda knobs (osx-arm64 ships MPS in the pytorch build; cpu is the default build); `cuda` pins a
 * `cuda-version` and declares a CUDA system requirement so the solver picks the GPU pytorch build.
 *
 * @param {Pick<import('./types/index.d.ts').BoxScroll, 'target'>} scroll
 * @returns {{ accelerator: 'cpu' | 'metal' | 'cuda', cudaVersion: string | null }}
 * @throws {TypeError} when the accelerator is unsupported, or a CUDA target lacks a version
 */
export function pixiAccelerator(scroll) {
  const accelerator = scroll?.target?.accelerator;
  if (accelerator === 'metal' || accelerator === 'cpu') {
    return Object.freeze({ accelerator, cudaVersion: null });
  }
  if (accelerator === 'cuda') {
    const cudaVersion = scroll?.target?.cudaVersion;
    if (typeof cudaVersion !== 'string' || !CUDA_VERSION.test(cudaVersion)) {
      throw new TypeError('A CUDA box target requires a numeric major.minor CUDA version');
    }
    return Object.freeze({ accelerator, cudaVersion });
  }
  throw new TypeError(`Unsupported box accelerator: ${accelerator}`);
}
