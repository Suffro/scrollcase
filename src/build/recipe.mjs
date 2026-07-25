/**
 * Reading a recipe, and the provenance of the build that reads it.
 *
 * A recipe is the only input a build accepts, so it is validated before anything is installed: its
 * declared identity must match the directory it lives in, and its Python entry point must match the
 * layout its target implies. Both checks exist so a recipe cannot quietly build something other than
 * what its name says.
 */

import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { assertPythonEntryPoint, boxTargetAdapter } from '../contract/targets.mjs';
import { fail, runResult } from './process.mjs';
import { getWorkspace } from './workspace.mjs';

/** Resolves a recipe name to its directory, refusing anything that escapes the recipes root. */
export function recipeDirectory(name) {
  const root = getWorkspace().recipesDir;
  const path = resolve(root, name);
  if (path !== root && !path.startsWith(`${root}${sep}`)) fail(`Invalid recipe: ${name}`);
  return path;
}

/** Loads and sanity-checks a recipe, returning it with the target adapter it resolves to. */
export async function readRecipe(name) {
  const dir = recipeDirectory(name);
  const recipe = JSON.parse(await readFile(resolve(dir, 'recipe.json'), 'utf8'));
  if (recipe.schemaVersion !== 1) fail(`Unsupported recipe schemaVersion: ${recipe.schemaVersion}`);
  if (recipe.recipeId !== name) fail(`Recipe ID ${recipe.recipeId} does not match directory ${name}`);
  if (!recipe.pixiVersion) fail(`Recipe ${name} does not declare a pixiVersion.`);
  const adapter = boxTargetAdapter(recipe.target);
  assertPythonEntryPoint(adapter, recipe.pythonEntryPoint);
  return { adapter, dir, recipe };
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
  const status = runResult('git', ['status', '--porcelain', '--untracked-files=no'], { capture: true, cwd });
  return { revision: revision.stdout.trim(), dirty: status.stdout.trim().length > 0 };
}
