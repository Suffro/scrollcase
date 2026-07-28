/**
 * Reading a recipe, and the provenance of the build that reads it.
 *
 * A recipe is the only input a build accepts, so it is validated before anything is installed. In
 * the nested layout, the meaningful declarations police the path: `boxId` names the parent and the
 * canonical target names the child. The old flat layout remains readable, but its directory is not
 * treated as a second source of identity. Python layout is checked against the target in either case.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { assertPythonEntryPoint, boxTargetAdapter, boxTargetId } from '../contract/targets.mjs';
import { compareStableStrings, fileExists, safeRelativePath } from './filesystem.mjs';
import { fail, runResult } from './process.mjs';
import { schemaValidationError } from './schema-validation.mjs';
import { getWorkspace } from './workspace.mjs';

const recipeSchemaUrl = new URL('../contract/schema/recipe.schema.json', import.meta.url);
const targetSchemaUrl = new URL('../contract/schema/target.schema.json', import.meta.url);
let recipeSchemas;

async function loadRecipeSchemas() {
  recipeSchemas ??= Promise.all([recipeSchemaUrl, targetSchemaUrl]
    .map(async (url) => JSON.parse(await readFile(url, 'utf8'))));
  return recipeSchemas;
}

/** Resolves an exact recipe reference to its directory, refusing anything outside the recipes root. */
export function recipeDirectory(reference) {
  const root = getWorkspace().recipesDir;
  const normalized = safeRelativePath(reference);
  const path = resolve(root, ...normalized.split('/'));
  if (path === root || !path.startsWith(`${root}${sep}`)) fail(`Invalid recipe: ${reference}`);
  return path;
}

/** Loads one exact flat or nested recipe reference and normalises its provenance identity. */
async function readExactRecipe(reference) {
  const normalized = safeRelativePath(reference);
  const parts = normalized.split('/');
  if (parts.length > 2) fail(`Invalid recipe reference ${reference}; use <boxId>/<targetId>.`);
  const dir = recipeDirectory(normalized);
  const recipe = JSON.parse(await readFile(resolve(dir, 'recipe.json'), 'utf8'));
  const [recipeSchema, targetSchema] = await loadRecipeSchemas();
  const validationError = schemaValidationError(recipe, recipeSchema, [targetSchema]);
  if (validationError) fail(`Invalid recipe ${normalized}: ${validationError}.`);
  if (recipe.weights === 'on-demand' && (recipe.assetArchives ?? []).length > 0) {
    fail('on-demand weights cannot be combined with assetArchives, which are expanded at build time.');
  }
  const payloadPaths = [
    recipe.modelCacheSubdir,
    ...recipe.assets.map((asset) => asset.relativePath),
    ...(recipe.assetArchives ?? []).flatMap((archive) => [archive.relativePath, archive.destination]),
    ...(recipe.localFiles ?? []).flatMap((file) => [file.sourcePath, file.relativePath]),
    ...(recipe.prunePaths ?? []),
    ...recipe.selfTest.files,
    ...(recipe.parity ? [recipe.parity.script] : []),
    ...(recipe.condaDependencyLicenseAudit ? [recipe.condaDependencyLicenseAudit] : []),
  ];
  for (const path of payloadPaths) safeRelativePath(path);
  const adapter = boxTargetAdapter(recipe.target);
  const targetId = boxTargetId(recipe.target);
  if (parts.length === 2) {
    const [boxDirectory, targetDirectory] = parts;
    if (boxDirectory !== recipe.boxId) {
      fail(`Nested recipe box directory ${boxDirectory} does not match recipe boxId ${recipe.boxId}.`);
    }
    if (targetDirectory !== targetId) {
      fail(`Nested recipe target directory ${targetDirectory} does not match declared target ${targetId}.`);
    }
  }
  assertPythonEntryPoint(adapter, recipe.pythonEntryPoint);
  return {
    adapter,
    dir,
    recipe: {
      ...recipe,
      // `recipeId` remains required in release provenance schema v1. New recipes do not repeat a
      // directory name just to populate it; the stable semantic identity is derived instead.
      recipeId: recipe.recipeId ?? `${recipe.boxId}-${targetId}`,
    },
    reference: normalized,
    targetId,
  };
}

/**
 * Lists the recipes named by a CLI/library reference.
 *
 * A direct `recipes/<name>/recipe.json` wins for compatibility with flat projects. Otherwise a
 * single box name expands to its `recipes/<boxId>/<targetId>/` children. Every child is validated
 * before it is offered, so a misleading directory never becomes a selectable target.
 */
export async function recipeCandidates(name) {
  const reference = safeRelativePath(name);
  const direct = recipeDirectory(reference);
  if (await fileExists(join(direct, 'recipe.json'))) return [await readExactRecipe(reference)];
  if (reference.includes('/')) fail(`Recipe not found: ${reference}.`);

  let entries;
  try {
    entries = await readdir(direct, { withFileTypes: true });
  } catch {
    return fail(`Recipe or box not found: ${reference}.`);
  }
  const candidates = [];
  for (const entry of entries.sort((left, right) => compareStableStrings(left.name, right.name))) {
    if (!entry.isDirectory()) continue;
    const nestedReference = `${reference}/${entry.name}`;
    if (await fileExists(join(recipeDirectory(nestedReference), 'recipe.json'))) {
      candidates.push(await readExactRecipe(nestedReference));
    }
  }
  if (candidates.length === 0) fail(`Box ${reference} contains no target recipes.`);
  return candidates;
}

/**
 * Loads a recipe without prompting.
 *
 * Library callers may select a target explicitly. An unambiguous box shorthand is also accepted;
 * ambiguity is a hard error here because only the CLI edge is allowed to ask a person.
 */
export async function readRecipe(name, { targetId = null } = {}) {
  let candidates = await recipeCandidates(name);
  if (targetId) {
    candidates = candidates.filter((candidate) => candidate.targetId === targetId);
    if (candidates.length === 0) {
      fail(`Target ${targetId} is not available for ${name}.`);
    }
  }
  if (candidates.length > 1) {
    fail(
      `Box ${name} has multiple recipe targets (${candidates.map((candidate) => candidate.targetId).join(', ')}); `
      + 'use <boxId>/<targetId> or select a target explicitly.',
    );
  }
  return candidates[0];
}

/**
 * Build timestamp taken from the HEAD commit rather than the clock, so rebuilding the same commit
 * produces the same provenance. Falls back to the epoch outside a git checkout — deliberately a
 * constant, since a wall-clock fallback would reintroduce the nondeterminism this avoids.
 */
export function sourceBuildTime(cwd) {
  const result = runResult('git', ['show', '-s', '--format=%cI', 'HEAD'], { capture: true, cwd });
  return result.status === 0 ? result.stdout.trim() : new Date(0).toISOString();
}

/**
 * The commit a box was built from, and whether the tree had uncommitted changes at the time.
 *
 * Outside a git checkout there is no revision to record, which callers must handle explicitly rather
 * than inventing one: an unversioned build is reproducible by nobody.
 */
export function sourceBuildState(cwd) {
  const revision = runResult('git', ['rev-parse', 'HEAD'], { capture: true, cwd });
  if (revision.status !== 0) return null;
  const status = runResult('git', ['status', '--porcelain', '--untracked-files=all'], { capture: true, cwd });
  return { revision: revision.stdout.trim(), dirty: status.stdout.trim().length > 0 };
}
