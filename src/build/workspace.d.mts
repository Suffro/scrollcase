/**
 * Walks up from `startDir` to the filesystem root looking for a workspace config.
 *
 * @param {string} startDir
 * @returns {string | null} the nearest config path, or null at the filesystem root
 */
export function findWorkspaceConfig(startDir: string): string | null;
/**
 * Collects workspace overrides from an already-parsed CLI flag map.
 *
 * @param {ReadonlyMap<string, unknown> | null | undefined} flags
 * @returns {WorkspaceOverrides}
 */
export function workspaceOverridesFromFlags(flags: ReadonlyMap<string, unknown> | null | undefined): WorkspaceOverrides;
/**
 * Collects workspace overrides directly from raw arguments, for entry points that parse the rest of
 * their command line themselves. Only the workspace flags are read, in `--name value` or
 * `--name=value` form; anything else is left untouched for the caller's own parser.
 *
 * @param {readonly string[]} values
 * @returns {WorkspaceOverrides}
 */
export function workspaceOverridesFromArgv(values: readonly string[]): WorkspaceOverrides;
/**
 * Resolves the absolute workspace layout.
 *
 * Root selection, highest precedence first: `--project-root`, the directory of an explicit
 * `--config`, the nearest `scrollcase.config.json` above the working directory, and finally the
 * working directory itself.
 *
 * @param {{ cwd?: string, overrides?: WorkspaceOverrides }} [options]
 * @returns {Workspace} frozen, with every path absolute
 * @throws {Error} when a named config is missing or malformed
 */
export function resolveWorkspace({ cwd, overrides }?: {
    cwd?: string;
    overrides?: WorkspaceOverrides;
}): Workspace;
/**
 * Installs the workspace for this process. Entry points call this once, before any other work, so
 * every module downstream observes the same resolved layout.
 *
 * @param {{ cwd?: string, overrides?: WorkspaceOverrides }} [options]
 * @returns {Workspace}
 */
export function configureWorkspace(options?: {
    cwd?: string;
    overrides?: WorkspaceOverrides;
}): Workspace;
/**
 * Returns the process workspace, resolving a flag-free default on first use. Modules read paths
 * through this rather than at import time, so an entry point can still configure them from flags.
 *
 * @returns {Workspace} resolving a flag-free default on first use
 */
export function getWorkspace(): Workspace;
/** Test seam: forgets the resolved workspace so the next read re-resolves it. */
export function resetWorkspace(): void;
/**
 * The absolute layout a command works against. Every path is resolved and the object is frozen.
 *
 * @typedef {object} Workspace
 * @property {string} root the project root the config was found in, and the git checkout provenance
 *   is recorded from
 * @property {string | null} configPath the config that produced it, or null when defaults applied
 * @property {string} scrollsDir
 * @property {string} buildDir
 * @property {string} distDir
 * @property {string} keysDir
 * @property {string} toolchainDir
 */
/**
 * Per-invocation overrides, highest precedence in workspace resolution.
 *
 * @typedef {object} WorkspaceOverrides
 * @property {string} [projectRoot]
 * @property {string} [config]
 * @property {string} [scrolls]
 * @property {string} [build]
 * @property {string} [dist]
 * @property {string} [keys]
 * @property {string} [toolchain]
 */
export const SCROLLCASE_CONFIG_FILENAME: "scrollcase.config.json";
/**
 * The layout a project gets when it declares nothing. A project that already keeps its scrolls
 * elsewhere — or that adopted the tool after building its own convention — overrides these in its
 * config rather than moving its files.
 */
export const DEFAULT_WORKSPACE_PATHS: Readonly<{
    scrolls: "scrolls";
    build: ".scrollcase/build";
    dist: ".scrollcase/dist";
    keys: ".scrollcase/keys";
    toolchain: ".scrollcase/toolchain";
}>;
/**
 * The absolute layout a command works against. Every path is resolved and the object is frozen.
 */
export type Workspace = {
    /**
     * the project root the config was found in, and the git checkout provenance
     * is recorded from
     */
    root: string;
    /**
     * the config that produced it, or null when defaults applied
     */
    configPath: string | null;
    scrollsDir: string;
    buildDir: string;
    distDir: string;
    keysDir: string;
    toolchainDir: string;
};
/**
 * Per-invocation overrides, highest precedence in workspace resolution.
 */
export type WorkspaceOverrides = {
    projectRoot?: string;
    config?: string;
    scrolls?: string;
    build?: string;
    dist?: string;
    keys?: string;
    toolchain?: string;
};
