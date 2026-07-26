/**
 * Returns the canonical target slug used in box filenames, object keys, and routes.
 *
 * @param {import('./types/index.d.ts').BoxTarget} target
 * @returns {string} the canonical slug, e.g. `linux-x86_64-cuda12.4`
 * @throws {TypeError} when the target is outside the supported matrix, or its CUDA version is
 *   missing on a CUDA target or present on any other
 */
export function boxTargetId(target: import("./types/index.d.ts").BoxTarget): string;
/**
 * Returns the native builder adapter for a validated box target.
 *
 * @param {import('./types/index.d.ts').BoxTarget} target
 * @returns {BoxTargetAdapter}
 * @throws {TypeError} when the target is unsupported
 */
export function boxTargetAdapter(target: import("./types/index.d.ts").BoxTarget): BoxTargetAdapter;
/**
 * Ensures a build or target lock runs on the OS and architecture it will ship for.
 *
 * @param {BoxTargetAdapter} adapter
 * @param {{ platform: string, arch: string }} [host] defaults to the current process
 * @returns {void}
 * @throws {TypeError} when the host is not the OS and architecture the box ships for
 */
export function assertNativeHost(adapter: BoxTargetAdapter, host?: {
    platform: string;
    arch: string;
}): void;
/**
 * Ensures the recipe entry point agrees with the adapter's standalone Python layout.
 *
 * @param {BoxTargetAdapter} adapter
 * @param {string} entryPoint
 * @returns {void}
 * @throws {TypeError} when the entry point does not match the adapter's layout
 */
export function assertPythonEntryPoint(adapter: BoxTargetAdapter, entryPoint: string): void;
/**
 * Lists every adapter, for contract tests and for consumers enumerating supported targets.
 *
 * @returns {BoxTargetAdapter[]} every supported adapter, as a fresh array
 */
export function boxTargetAdapters(): BoxTargetAdapter[];
/**
 * Maps a validated box target to its conda platform subdir (the pixi `platforms` value).
 *
 * @param {import('./types/index.d.ts').BoxTarget} target
 * @returns {'osx-arm64' | 'linux-64' | 'win-64'} the pixi `platforms` value for the target
 */
export function condaSubdir(target: import("./types/index.d.ts").BoxTarget): "osx-arm64" | "linux-64" | "win-64";
/**
 * Returns the conda accelerator descriptor a recipe selects, rejecting target drift. `metal` and
 * `cpu` need no extra conda knobs (osx-arm64 ships MPS in the pytorch build; cpu is the default build); `cuda` pins a
 * `cuda-version` and declares a CUDA system requirement so the solver picks the GPU pytorch build.
 *
 * @param {Pick<import('./types/index.d.ts').BoxRecipe, 'target'>} recipe
 * @returns {{ accelerator: 'cpu' | 'metal' | 'cuda', cudaVersion: string | null }}
 * @throws {TypeError} when the accelerator is unsupported, or a CUDA target lacks a version
 */
export function pixiAccelerator(recipe: Pick<import("./types/index.d.ts").BoxRecipe, "target">): {
    accelerator: "cpu" | "metal" | "cuda";
    cudaVersion: string | null;
};
/**
 * What a target implies for the built payload. Part of the format rather than an implementation
 * detail: a consumer unpacking a box relies on this layout.
 */
export type BoxTargetAdapter = {
    /**
     * canonical adapter id, e.g. `macos-aarch64`
     */
    id: string;
    platform: "macos" | "linux" | "windows";
    arch: "aarch64" | "x86_64";
    /**
     * the Node platform/arch a build must run on
     */
    host: {
        platform: string;
        arch: string;
    };
    /**
     * the recipe's pixi `platforms` value
     */
    condaSubdir: "osx-arm64" | "linux-64" | "win-64";
    /**
     * layout of the interpreter in the box
     */
    python: {
        payloadRoot: string;
        entryPoint: string;
        scriptsDirectory: string;
        executableSuffix: string;
        launcherKind: string;
    };
    /**
     * the pinned archive backend
     */
    archive: {
        format: "zip";
        writer: string;
        reader: string;
        assetTarReader: string;
        zip64: boolean;
    };
    nativeLibraryInspection: {
        command: string;
        argsPrefix: readonly string[];
        extensions: readonly string[];
    };
    /**
     *   the environment that forces a run onto one accelerator, keyed by accelerator
     */
    validationEnvironments: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /**
     * the platform assertion prepended to every self-test
     */
    selfTestPython: string;
};
