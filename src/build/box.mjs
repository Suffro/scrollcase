/**
 * `build` — assemble the environment, prove it works, archive it, sign it.
 *
 * In order: solve and pack the conda-forge environment from the committed lock, fetch and unpack the
 * declared assets, prune what is not needed at run time, audit dependency licences, self-test with
 * the payload's *own* interpreter, normalise timestamps, zip deterministically, and emit a signed
 * release plus a signed channel pointer.
 *
 * The self-test is the step that earns the box its name. The builder runs target, import, optional
 * Python-code, and file assertions; schema version 1 signs the import subset that a consumer can
 * repeat after extraction. The distinction is deliberate rather than pretending the narrower
 * consumer check reproduces recipe-only assertions it cannot see.
 *
 * The archive is content-addressed by its own hash, so the release document can commit to it and any
 * consumer can verify it byte for byte.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertNativeHost, boxTargetId } from '../contract/targets.mjs';
import { documentKinds } from '../contract/documents.mjs';
import { signDocument } from '../sign/index.mjs';
import { copyVerifiedLocalFile, downloadVerified, expandAssetArchive, moveIntoPlace } from './assets.mjs';
import { createDeterministicZip } from './archive.mjs';
import { fileExists, normalizeTree, payloadSize, safeRelativePath, sha256File } from './filesystem.mjs';
import { boxReleaseObjectPrefix, boxReleaseStem, builderVersionFields } from './identity.mjs';
import { createCondaDependencyLicenseAudit, validateCondaDependencyLicenseAudit } from './licenses.mjs';
import { checkParity } from './parity.mjs';
import { findCondaPack, findPixi, installAndPackPixiEnvironment } from './pixi.mjs';
import { fail, run as runProcess } from './process.mjs';
import { readRecipe, sourceBuildState, sourceBuildTime } from './recipe.mjs';
import { getWorkspace } from './workspace.mjs';

const SELF_TEST_TIMEOUT_SECONDS = 180;
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Runs the recipe's self-test with the payload's own interpreter, under the target's environment. */
function runSelfTest({ interpreter, adapter, recipe, payloadDir, run }) {
  const imports = `import ${recipe.selfTest.imports.join(', ')}`;
  const code = recipe.selfTest.pythonCode
    ? `${adapter.selfTestPython}\n${imports}\n${recipe.selfTest.pythonCode}`
    : `${adapter.selfTestPython}\n${imports}`;
  run(interpreter, ['-c', code], {
    cwd: payloadDir,
    env: adapter.validationEnvironments[recipe.target.accelerator],
  });
}

/** Writes the licence inventory the box ships, after proving it still matches the reviewed one. */
async function writeLicenceAudit({ recipe, lockPath, payloadDir, projectRoot }) {
  if (!recipe.condaDependencyLicenseAudit) return;
  const actual = createCondaDependencyLicenseAudit({
    lockBytes: await readFile(lockPath),
    targetId: boxTargetId(recipe.target),
  });
  const reviewedPath = join(projectRoot, safeRelativePath(recipe.condaDependencyLicenseAudit));
  const reviewed = JSON.parse(await readFile(reviewedPath, 'utf8'));
  validateCondaDependencyLicenseAudit(reviewed, actual);
  const auditPath = join(payloadDir, 'THIRD_PARTY_NOTICES', 'conda-distributions.json');
  await mkdir(dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify(actual, null, 2)}\n`);
}

/**
 * Builds, self-tests, archives, and signs the box a recipe describes — the whole pipeline the
 * module header narrates. `name` is the recipe directory under the workspace's recipes root;
 * options override signing, channel, weights mode, namespace, and toolchain paths. `run`,
 * `runResult`, and `fetchImpl` are the injection seams the tests use to substitute the toolchain
 * and asset transport.
 */
export async function buildBox(name, options = {}) {
  const {
    allowDirty = false,
    channel = 'beta',
    weights = null,
    assetBaseUrl: assetBaseUrlOverride = null,
    namespace,
    signerCommand = null,
    privatePath,
    publicPath,
    pixiPath = null,
    condaPackPath = null,
    run = runProcess,
    runResult = null,
    fetchImpl = fetch,
    log = console.log,
  } = options;
  // Tool discovery probes with its own runner; a caller may substitute one to drive a build without
  // the real toolchain on PATH.
  const probe = runResult ? { runResult } : {};
  const workspace = getWorkspace();
  const { adapter, dir, recipe } = await readRecipe(name);
  const weightsMode = weights || recipe.weights || 'embed';
  if (weightsMode !== 'embed' && weightsMode !== 'on-demand') {
    fail(`Unsupported weights mode: ${weightsMode}. Use embed or on-demand.`);
  }
  if (weightsMode === 'on-demand' && (recipe.assetArchives ?? []).length > 0) {
    fail('on-demand weights cannot be combined with assetArchives, which are expanded at build time.');
  }
  // Wheels, native libraries, and the interpreter are proven on the exact OS/architecture they ship for.
  assertNativeHost(adapter);
  const pixi = findPixi({ requiredVersion: recipe.pixiVersion, path: pixiPath, ...probe });
  const condaPack = findCondaPack({ path: condaPackPath, ...probe });
  const lockPath = join(dir, 'pixi.lock');
  // A build installs from the lock and never resolves, so a missing lock is a hard error rather than
  // an invitation to resolve dependencies on the fly.
  if (!await fileExists(lockPath)) fail(`Missing dependency lock: ${lockPath}`);
  const lockSha = await sha256File(lockPath);

  const source = sourceBuildState(workspace.root);
  if (!source) fail('A box records the commit it was built from; run inside a git checkout.');
  // If the tree is dirty that record is a lie — the artefact would not be reproducible from that
  // revision — so refuse unless the caller explicitly accepts it for local development.
  if (source.dirty && !allowDirty) {
    fail('Refusing to build from a dirty source tree. Commit first, or pass --allow-dirty for local development.');
  }

  const buildDir = join(workspace.buildDir, recipe.recipeId);
  const payloadDir = join(buildDir, 'payload');
  // `dist` is laid out as the two things a publisher does with it, and nothing else. `boxes/` is
  // the tree that goes under the asset base URL verbatim — the same prefix the signed documents
  // write into their own URLs, so uploading it is a copy rather than a mapping. `channels/` is
  // separate because a channel is not part of any one version: it is a pointer that moves to the
  // next one, and filing it under 1.0.0 would leave a stale copy claiming to be current the moment
  // 1.0.1 ships. Nothing is written twice: what is on disk here is what gets published.
  const objectPrefix = boxReleaseObjectPrefix(recipe);
  const objectDir = join(workspace.distDir, ...objectPrefix.split('/'));
  const archivePath = join(buildDir, `${boxReleaseStem(recipe)}.zip`);
  // Always start from an empty tree: leftovers from a previous build would end up in the archive.
  await rm(buildDir, { recursive: true, force: true });
  await rm(objectDir, { recursive: true, force: true });
  await mkdir(payloadDir, { recursive: true });

  const { interpreter } = await installAndPackPixiEnvironment({
    pixi,
    condaPack,
    manifestPath: join(dir, 'pixi.toml'),
    lockPath,
    buildDir,
    payloadDir,
    adapter,
    run,
  });

  // `embed` packs the assets into the archive, so an installed box needs no network and works
  // air-gapped. `on-demand` leaves them out and lets the consumer fetch them at install time from the
  // descriptors carried in the signed release — the declared hash is what keeps that safe. The choice
  // trades archive size against an install-time dependency on the asset host, so it is the project's
  // to make, per build.
  const embedded = weightsMode === 'embed';
  for (const asset of embedded ? recipe.assets : []) {
    log(`Downloading ${asset.relativePath}`);
    await downloadVerified(asset, join(payloadDir, safeRelativePath(asset.relativePath)), {
      fetchImpl,
      log,
    });
  }
  const deferredAssets = new Set(embedded ? [] : recipe.assets.map((asset) => asset.relativePath));
  for (const file of recipe.localFiles ?? []) {
    await copyVerifiedLocalFile(file, payloadDir, workspace.root);
  }
  for (const archive of embedded ? recipe.assetArchives ?? [] : []) {
    await expandAssetArchive(payloadDir, archive);
  }
  // Drops what is only needed to build (tests, docs, bundled sample data). A box is a multi-gigabyte
  // download for an end user, so pruning is a user-facing concern rather than tidiness.
  for (const prunePath of recipe.prunePaths ?? []) {
    await rm(join(payloadDir, safeRelativePath(prunePath)), { recursive: true, force: true });
  }
  await writeLicenceAudit({ recipe, lockPath, payloadDir, projectRoot: workspace.root });
  // Guards against over-pruning: the files the box needs at run time must still be there.
  for (const requiredFile of recipe.selfTest.files ?? []) {
    // A deferred asset is legitimately absent from the payload; anything else missing means pruning
    // removed something the box needs at run time.
    if (deferredAssets.has(requiredFile)) continue;
    if (!await fileExists(join(payloadDir, safeRelativePath(requiredFile)))) {
      fail(`Missing self-test file: ${requiredFile}`);
    }
  }
  runSelfTest({ interpreter, adapter, recipe, payloadDir, run });
  // Parity runs after the self-test, on the same payload: there is no point comparing accelerators
  // in a box that cannot import its dependencies in the first place.
  const parity = await checkParity({
    parity: recipe.parity,
    adapter,
    interpreter,
    payloadDir,
    run,
  });
  if (parity) {
    log(`Parity passed on ${parity.comparisons.map((c) => c.accelerator).join(', ')} against ${parity.comparisons[0].reference}`);
  }

  // Everything needed to answer "where did this box come from, and could I rebuild it?".
  const provenance = {
    recipeId: recipe.recipeId,
    recipeVersion: recipe.recipeVersion,
    builderRevision: source.revision,
    sourceTreeDirty: source.dirty,
    sourceRevision: recipe.sourceRevision,
    pythonVersion: recipe.pythonVersion,
    ...builderVersionFields(recipe),
    dependencyLockSha256: lockSha,
    builtAt: sourceBuildTime(workspace.root),
  };
  const selfTest = {
    pythonImports: recipe.selfTest.imports,
    timeoutSeconds: SELF_TEST_TIMEOUT_SECONDS,
  };
  // Descriptors travel with the box only when the consumer has to fetch the assets itself.
  const deferred = embedded ? {} : {
    weights: 'on-demand',
    assets: recipe.assets.map(({ url, relativePath, sizeBytes, sha256 }) => ({
      url, relativePath, sizeBytes, sha256,
    })),
  };
  const identity = {
    boxId: recipe.boxId,
    modelId: recipe.modelId,
    runtimeId: recipe.runtimeId,
    version: recipe.version,
  };
  // box.json travels *inside* the archive. A consumer compares it field by field against the signed
  // release, which is what binds the archive's contents to its signed metadata.
  await writeFile(join(payloadDir, 'box.json'), `${JSON.stringify({
    schemaVersion: 1,
    ...identity,
    target: recipe.target,
    pythonEntryPoint: recipe.pythonEntryPoint,
    modelCacheSubdir: recipe.modelCacheSubdir,
    selfTest,
    ...deferred,
    provenance,
  }, null, 2)}\n`);
  await normalizeTree(payloadDir);
  const installedSizeBytes = await payloadSize(payloadDir);
  await mkdir(workspace.distDir, { recursive: true });
  await createDeterministicZip(payloadDir, archivePath, adapter);

  const archiveSha = await sha256File(archivePath);
  const archiveSize = (await stat(archivePath)).size;
  // Content-addressed: the object is named after its own hash, so publishing is idempotent and an
  // object can never be replaced with different bytes under the same URL.
  const archiveObject = `${objectPrefix}/${archiveSha}.zip`;
  const assetBaseUrl = String(assetBaseUrlOverride || recipe.assetBaseUrl || '').replace(/\/$/, '');
  if (!assetBaseUrl) fail('No asset base URL: declare assetBaseUrl in the recipe or pass --asset-base-url.');
  const kinds = documentKinds(namespace);
  const signing = { signerCommand, privatePath, publicPath };

  const release = {
    schemaVersion: 1,
    kind: kinds.release,
    ...identity,
    target: recipe.target,
    compatibility: recipe.compatibility,
    archive: { format: 'zip', url: `${assetBaseUrl}/${archiveObject}`, sha256: archiveSha, sizeBytes: archiveSize },
    installedSizeBytes,
    pythonEntryPoint: recipe.pythonEntryPoint,
    modelCacheSubdir: recipe.modelCacheSubdir,
    selfTest,
    ...deferred,
    provenance,
  };
  // Written beside the archive, under the same scratch rule: named for its own hash once it has one.
  const stagedReleasePath = join(buildDir, 'release.json');
  await writeFile(stagedReleasePath, `${JSON.stringify(await signDocument(release, signing), null, 2)}\n`);

  // The channel points at the release document by *its* hash too, so the whole chain is
  // content-addressed: channel -> release document -> archive.
  const releaseDocumentSha = await sha256File(stagedReleasePath);
  const channelDocument = {
    schemaVersion: 1,
    kind: kinds.channel,
    channel,
    boxId: recipe.boxId,
    target: recipe.target,
    updatedAt: provenance.builtAt,
    // Derived from box and version rather than random, so rebuilding the same release reproduces the
    // same cohort assignment instead of reshuffling which users receive it.
    cohortSalt: sha256Hex(Buffer.from(`${recipe.boxId}:${recipe.version}`)).slice(0, 32),
    // A freshly built channel goes out at 100%; a staged rollout is arranged by editing this document
    // rather than by the builder.
    releases: [{
      version: recipe.version,
      releaseManifestUrl: `${assetBaseUrl}/${objectPrefix}/${releaseDocumentSha}.release.json`,
      rolloutPercentage: 100,
    }],
  };
  // One file per channel per target, filed by channel rather than by version: it is a pointer, and
  // the next release moves it rather than adding a second one.
  const channelDir = join(workspace.distDir, 'channels', recipe.boxId, channel);
  const channelPath = join(channelDir, `${boxTargetId(recipe.target)}.json`);
  await mkdir(channelDir, { recursive: true });
  await writeFile(channelPath, `${JSON.stringify(await signDocument(channelDocument, signing), null, 2)}\n`);

  // Both documents move — not copy — into the tree a publisher uploads, so the only copy that
  // exists is the one that gets published and there is no second name for the same bytes.
  await mkdir(objectDir, { recursive: true });
  const publishedArchive = join(objectDir, `${archiveSha}.zip`);
  const publishedRelease = join(objectDir, `${releaseDocumentSha}.release.json`);
  await moveIntoPlace(archivePath, publishedArchive);
  await moveIntoPlace(stagedReleasePath, publishedRelease);
  log(`Box:     ${publishedArchive}`);
  log(`Release: ${publishedRelease}`);
  log(`Channel: ${channelPath}`);
  log('');
  log(`Publish: upload ${join(workspace.distDir, 'boxes')} under ${assetBaseUrl}, keeping its paths,`);
  log('         then publish the channel document where your clients look for it.');
  return {
    archivePath: publishedArchive,
    releasePath: publishedRelease,
    channelPath,
    archiveSha256: archiveSha,
    installedSizeBytes,
    weights: weightsMode,
    parity,
  };
}
