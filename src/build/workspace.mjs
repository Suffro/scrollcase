/**
 * Scrollcase workspace resolution.
 *
 * Where a project keeps its recipes, and where the tool writes what it builds, is the project's
 * decision, not the tool's. A workspace is declared by a `scrollcase.config.json` at the project
 * root, discovered by walking up from the working directory and overridable per invocation by CLI
 * flags. A project that declares nothing gets the defaults below.
 *
 * Precedence, highest first: CLI flag, then `scrollcase.config.json`, then the built-in default.
 * Flag values resolve against the current working directory (what a shell user expects); config
 * values resolve against the project root (so a config file is portable).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, parse as parsePath, resolve } from 'node:path';
import { fail } from './process.mjs';

/**
 * The absolute layout a command works against. Every path is resolved and the object is frozen.
 *
 * @typedef {object} Workspace
 * @property {string} root the project root the config was found in, and the git checkout provenance
 *   is recorded from
 * @property {string | null} configPath the config that produced it, or null when defaults applied
 * @property {string} recipesDir
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
 * @property {string} [recipes]
 * @property {string} [build]
 * @property {string} [dist]
 * @property {string} [keys]
 * @property {string} [toolchain]
 */

export const SCROLLCASE_CONFIG_FILENAME = 'scrollcase.config.json';

/**
 * The layout a project gets when it declares nothing. A project that already keeps its recipes
 * elsewhere — or that adopted the tool after building its own convention — overrides these in its
 * config rather than moving its files.
 */
export const DEFAULT_WORKSPACE_PATHS = Object.freeze({
  recipes: 'recipes',
  build: '.scrollcase/build',
  dist: '.scrollcase/dist',
  keys: '.scrollcase/keys',
  toolchain: '.scrollcase/toolchain',
});

/** Config path key -> resolved workspace field. */
const PATH_FIELDS = Object.freeze({
  recipes: 'recipesDir',
  build: 'buildDir',
  dist: 'distDir',
  keys: 'keysDir',
  toolchain: 'toolchainDir',
});

/** CLI flag -> config path key. */
const PATH_FLAGS = Object.freeze({
  'recipes-dir': 'recipes',
  'build-dir': 'build',
  'out-dir': 'dist',
  'keys-dir': 'keys',
  'toolchain-dir': 'toolchain',
});

/**
 * Walks up from `startDir` to the filesystem root looking for a workspace config.
 *
 * @param {string} startDir
 * @returns {string | null} the nearest config path, or null at the filesystem root
 */
export function findWorkspaceConfig(startDir) {
  let current = resolve(startDir);
  const { root } = parsePath(current);
  for (;;) {
    const candidate = resolve(current, SCROLLCASE_CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    if (current === root) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Reads and shape-checks a config file; an unreadable or malformed config is a hard error. */
function readWorkspaceConfig(configPath) {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    return fail(`Invalid ${SCROLLCASE_CONFIG_FILENAME} at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return fail(`Invalid ${SCROLLCASE_CONFIG_FILENAME} at ${configPath}: expected a JSON object`);
  }
  if (config.version !== undefined && config.version !== 1) {
    return fail(`Unsupported ${SCROLLCASE_CONFIG_FILENAME} version ${config.version} at ${configPath}; this builder understands version 1`);
  }
  const paths = config.paths ?? {};
  if (typeof paths !== 'object' || paths === null || Array.isArray(paths)) {
    return fail(`Invalid ${SCROLLCASE_CONFIG_FILENAME} at ${configPath}: "paths" must be an object`);
  }
  for (const [key, value] of Object.entries(paths)) {
    if (!(key in PATH_FIELDS)) {
      fail(`Unknown "paths" entry "${key}" in ${configPath}; expected one of ${Object.keys(PATH_FIELDS).join(', ')}`);
    }
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`Invalid "paths.${key}" in ${configPath}: expected a non-empty path string`);
    }
  }
  return { ...config, paths };
}

/**
 * Collects workspace overrides from an already-parsed CLI flag map.
 *
 * @param {ReadonlyMap<string, unknown> | null | undefined} flags
 * @returns {WorkspaceOverrides}
 */
export function workspaceOverridesFromFlags(flags) {
  const overrides = {};
  const stringFlag = (name) => {
    const value = flags?.get(name);
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim() === '') fail(`--${name} requires a path value`);
    return value;
  };
  const projectRoot = stringFlag('project-root');
  if (projectRoot !== undefined) overrides.projectRoot = projectRoot;
  const config = stringFlag('config');
  if (config !== undefined) overrides.config = config;
  for (const [flag, key] of Object.entries(PATH_FLAGS)) {
    const value = stringFlag(flag);
    if (value !== undefined) overrides[key] = value;
  }
  return overrides;
}

/**
 * Collects workspace overrides directly from raw arguments, for entry points that parse the rest of
 * their command line themselves. Only the workspace flags are read, in `--name value` or
 * `--name=value` form; anything else is left untouched for the caller's own parser.
 *
 * @param {readonly string[]} values
 * @returns {WorkspaceOverrides}
 */
export function workspaceOverridesFromArgv(values) {
  const flags = new Map();
  const known = new Set(['project-root', 'config', ...Object.keys(PATH_FLAGS)]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== 'string' || !value.startsWith('--')) continue;
    const [name, inline] = value.slice(2).split('=', 2);
    if (!known.has(name)) continue;
    if (inline !== undefined) flags.set(name, inline);
    else if (values[index + 1] !== undefined) flags.set(name, values[index + 1]);
    else fail(`--${name} requires a path value`);
  }
  return workspaceOverridesFromFlags(flags);
}

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
export function resolveWorkspace({ cwd = process.cwd(), overrides = {} } = {}) {
  const base = resolve(cwd);
  let configPath = null;
  let root;
  if (overrides.config !== undefined) {
    // An explicitly named config must exist: silently ignoring it would hide a typo behind defaults.
    configPath = resolve(base, overrides.config);
    if (!existsSync(configPath)) fail(`Workspace config not found: ${configPath}`);
    root = overrides.projectRoot !== undefined ? resolve(base, overrides.projectRoot) : dirname(configPath);
  } else if (overrides.projectRoot !== undefined) {
    root = resolve(base, overrides.projectRoot);
    const candidate = resolve(root, SCROLLCASE_CONFIG_FILENAME);
    configPath = existsSync(candidate) ? candidate : null;
  } else {
    configPath = findWorkspaceConfig(base);
    root = configPath ? dirname(configPath) : base;
  }
  const config = configPath ? readWorkspaceConfig(configPath) : { paths: {} };
  const workspace = { root, configPath };
  for (const [key, field] of Object.entries(PATH_FIELDS)) {
    const override = overrides[key];
    if (override !== undefined) {
      // A flag is typed by a user standing in some directory, so it resolves from there.
      workspace[field] = isAbsolute(override) ? override : resolve(base, override);
      continue;
    }
    const declared = config.paths[key];
    // Config and default values belong to the project, so they resolve from its root.
    workspace[field] = resolve(root, declared ?? DEFAULT_WORKSPACE_PATHS[key]);
  }
  return Object.freeze(workspace);
}

let current = null;

/**
 * Installs the workspace for this process. Entry points call this once, before any other work, so
 * every module downstream observes the same resolved layout.
 *
 * @param {{ cwd?: string, overrides?: WorkspaceOverrides }} [options]
 * @returns {Workspace}
 */
export function configureWorkspace(options = {}) {
  current = resolveWorkspace(options);
  return current;
}

/**
 * Returns the process workspace, resolving a flag-free default on first use. Modules read paths
 * through this rather than at import time, so an entry point can still configure them from flags.
 *
 * @returns {Workspace} resolving a flag-free default on first use
 */
export function getWorkspace() {
  if (!current) current = resolveWorkspace();
  return current;
}

/** Test seam: forgets the resolved workspace so the next read re-resolves it. */
export function resetWorkspace() {
  current = null;
}
