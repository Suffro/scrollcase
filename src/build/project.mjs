/**
 * Setting a project up, and telling it what is wrong.
 *
 * `init` scaffolds files; `doctor` inspects and never writes. Keeping that line sharp is what makes
 * `doctor` safe to run at any time, including inside CI, and what stops `init` from being the
 * command nobody dares re-run.
 *
 * `init` may also install the build toolchain, but only after asking: scaffolding never reaches for
 * the network on its own, and the download is verified against a pinned checksum. See
 * `ensureToolchain` below and `toolchain.mjs` for why the consent and the pin are the design rather
 * than a nicety.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boxTargetAdapters, condaSubdir } from '../contract/targets.mjs';
import { fileExists } from './filesystem.mjs';
import { findCondaPack, findPixi, probeCondaPack, probePixi } from './pixi.mjs';
import { fail, run as defaultRun, runResult as defaultRunResult } from './process.mjs';
import { installCondaPack, installPixi, latestPixiVersion, pixiReleaseAsset } from './toolchain.mjs';
import { DEFAULT_WORKSPACE_PATHS, SCROLLCASE_CONFIG_FILENAME } from './workspace.mjs';

const GITIGNORE_MARKER = '# Scrollcase build state';

/** The example a new project starts from: an environment with nothing in it but Python. */
function exampleRecipe(recipeId, target) {
  return {
    schemaVersion: 1,
    recipeId,
    recipeVersion: '1.0.0',
    boxId: 'example-box',
    modelId: 'example-org-example-model',
    runtimeId: 'example-box-runtime',
    version: '1.0.0',
    sourceRevision: 'example-v1',
    target,
    compatibility: { minHostAppVersion: '1.0.0' },
    pythonVersion: '3.11',
    pixiVersion: null,
    pythonEntryPoint: boxTargetAdapters().find((adapter) => adapter.platform === target.platform).python.entryPoint,
    modelCacheSubdir: 'model-cache/example',
    assetBaseUrl: 'https://example.org/boxes',
    assets: [],
    selfTest: { imports: ['json'], files: [] },
  };
}

function exampleManifest(recipeId, target) {
  return `# Solved by \`scrollcase lock\` into pixi.lock, which is committed and reviewed.
# \`platforms\` must equal the target's conda subdirectory, or the solve produces an environment
# that cannot run on the machine the box is for.
[workspace]
name = "${recipeId}"
channels = ["conda-forge"]
platforms = ["${condaSubdir(target)}"]

[dependencies]
python = "3.11.*"
`;
}

/**
 * Scaffolds a project: a workspace config, one example recipe, and the ignore rules for generated
 * state. Existing files are never overwritten — the command reports what it skipped and why, so a
 * half-configured project can be completed by running it again.
 */
export async function initProject({ root, target, pixiVersion = null, recipeId = 'example-box-local' }) {
  const written = [];
  const skipped = [];
  const write = async (path, contents) => {
    if (await fileExists(path)) return skipped.push(path);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, contents);
    return written.push(path);
  };

  await write(join(root, SCROLLCASE_CONFIG_FILENAME), `${JSON.stringify({
    version: 1,
    paths: { ...DEFAULT_WORKSPACE_PATHS },
  }, null, 2)}\n`);

  const recipeDir = join(root, DEFAULT_WORKSPACE_PATHS.recipes, recipeId);
  const recipe = exampleRecipe(recipeId, target);
  if (pixiVersion) recipe.pixiVersion = pixiVersion;
  await write(join(recipeDir, 'recipe.json'), `${JSON.stringify(recipe, null, 2)}\n`);
  await write(join(recipeDir, 'pixi.toml'), exampleManifest(recipeId, target));

  // Build state is regenerated on every build and must never be committed; the lock and the recipe
  // must be. Appending rather than rewriting leaves an existing .gitignore alone.
  const gitignorePath = join(root, '.gitignore');
  const existing = await fileExists(gitignorePath) ? await readFile(gitignorePath, 'utf8') : '';
  if (!existing.includes(GITIGNORE_MARKER)) {
    const rules = `${existing.endsWith('\n') || existing === '' ? '' : '\n'}${GITIGNORE_MARKER}\n.scrollcase/\n`;
    await writeFile(gitignorePath, `${existing}${rules}`);
    written.push(gitignorePath);
  } else {
    skipped.push(gitignorePath);
  }
  return { written, skipped, recipeId, recipeDir };
}

/**
 * Diagnoses whether this machine can build a box, and says what to do when it cannot.
 *
 * Every check reports rather than throws, so one missing tool does not hide the next problem: a
 * user with neither pixi nor conda-pack should learn both in one run, not one per attempt.
 */
export async function diagnose({ workspace, pixiVersion = null, pixiPath = null, condaPackPath = null, runResult = defaultRunResult }) {
  const checks = [];
  const record = (name, ok, detail, remedy = null) => checks.push({ name, ok, detail, remedy });

  record('workspace', true, workspace.configPath
    ? `config ${workspace.configPath}`
    : `no ${SCROLLCASE_CONFIG_FILENAME} found; using defaults under ${workspace.root}`);
  record('recipes', await fileExists(workspace.recipesDir), workspace.recipesDir,
    `Create it, or point "paths.recipes" at where your recipes live.`);

  const git = runResult('git', ['rev-parse', 'HEAD'], { capture: true, cwd: workspace.root });
  record('git', git.status === 0,
    git.status === 0 ? `HEAD ${git.stdout.trim().slice(0, 12)}` : 'not a git checkout',
    'A box records the commit it was built from. Initialise a repository and commit your recipes.');

  if (pixiVersion) {
    try {
      const pixi = findPixi({ requiredVersion: pixiVersion, path: pixiPath, runResult });
      record('pixi', true, `${pixi} at ${pixiVersion}`);
    } catch (error) {
      record('pixi', false, error.message,
        `Install pixi ${pixiVersion} from https://pixi.sh/, or pass --pixi <path>.`);
    }
  } else {
    record('pixi', true, 'not checked: pass --pixi-version, or run doctor with a recipe');
  }

  try {
    const condaPack = findCondaPack({ path: condaPackPath, runResult });
    record('conda-pack', true, condaPack);
  } catch (error) {
    record('conda-pack', false, error.message,
      'Install it with `pixi global install conda-pack`, or pass --conda-pack <path>.');
  }

  return { checks, ok: checks.every((check) => check.ok) };
}
