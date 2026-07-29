import {
  mkdir,
  mkdtemp,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createDeterministicZip } from '../../src/build/archive.mjs';
import { payloadSize, sha256File } from '../../src/build/filesystem.mjs';
import { documentKinds } from '../../src/contract/documents.mjs';
import { boxTargetAdapter } from '../../src/contract/targets.mjs';
import { generateSigningKey, signDocument } from '../../src/sign/index.mjs';

export function nativeTarget() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' };
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' };
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return { platform: 'windows', arch: 'x86_64', accelerator: 'cpu' };
  }
  throw new Error(`Unsupported test host: ${process.platform}/${process.arch}`);
}

export async function writeSignedRelease(fixture, release) {
  const signed = await signDocument(release, {
    privatePath: fixture.privatePath,
    publicPath: fixture.publicPath,
  });
  await writeFile(fixture.releasePath, `${JSON.stringify(signed, null, 2)}\n`);
}

export async function createConsumerBoxFixture({
  target = nativeTarget(),
  execution = {
    kind: 'python-script',
    script: 'app/main.py',
    defaultArgs: ['--default', 'value with spaces'],
  },
  requiredAsset = null,
  interpreterContents = 'test interpreter placeholder',
  scriptContents = 'print("consumer fixture")\n',
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'scrollcase-consumer-fixture-'));
  const payload = join(root, 'payload');
  await mkdir(payload);
  const adapter = boxTargetAdapter(target);
  const pythonPath = join(payload, ...adapter.python.entryPoint.split('/'));
  await mkdir(dirname(pythonPath), { recursive: true });
  await writeFile(pythonPath, interpreterContents);

  if (execution?.kind === 'python-script') {
    const scriptPath = join(payload, ...execution.script.split('/'));
    await mkdir(dirname(scriptPath), { recursive: true });
    await writeFile(scriptPath, scriptContents);
  } else if (execution?.kind === 'python-module') {
    const modulePath = join(payload, `${execution.module.split('.').join('/')}.py`);
    await mkdir(dirname(modulePath), { recursive: true });
    await writeFile(modulePath, 'print("consumer fixture")\n');
  }

  const shared = {
    schemaVersion: 2,
    boxId: 'consumer-fixture',
    modelId: 'example-consumer-model',
    runtimeId: 'example-consumer-runtime',
    version: '2.0.0',
    target,
    pythonEntryPoint: adapter.python.entryPoint,
    modelCacheSubdir: 'model-cache/consumer-fixture',
    selfTest: {
      pythonImports: ['json'],
      timeoutSeconds: 30,
    },
    ...(execution ? { execution } : {}),
    provenance: {
      scrollId: 'consumer-fixture-scroll',
      scrollVersion: '2.0.0',
      builderRevision: '0123456789abcdef0123456789abcdef01234567',
      sourceTreeDirty: false,
      sourceRevision: 'fedcba9876543210',
      pythonVersion: '3.11.15',
      pixiVersion: '0.73.0',
      dependencyLockSha256: 'a'.repeat(64),
      builtAt: '2026-07-29T00:00:00.000Z',
    },
    ...(requiredAsset ? {
      weights: 'on-demand',
      assets: [requiredAsset],
    } : {}),
  };
  await writeFile(join(payload, 'box.json'), `${JSON.stringify(shared, null, 2)}\n`);
  const installedSizeBytes = await payloadSize(payload);
  const archivePath = join(root, 'box.zip');
  await createDeterministicZip(payload, archivePath, adapter);
  const archiveMetadata = await stat(archivePath);
  const release = {
    ...shared,
    kind: documentKinds().release,
    compatibility: { hostEnvironments: ['native'] },
    archive: {
      format: 'zip',
      url: 'https://assets.example.org/consumer-fixture.zip',
      sha256: await sha256File(archivePath),
      sizeBytes: archiveMetadata.size,
    },
    installedSizeBytes,
  };
  const privatePath = join(root, 'private.pem');
  const publicPath = join(root, 'public.json');
  await generateSigningKey({ privatePath, publicPath });
  const releasePath = join(root, 'release.json');
  const fixture = {
    root,
    archivePath,
    privatePath,
    publicPath,
    releasePath,
    release,
  };
  await writeSignedRelease(fixture, release);
  return fixture;
}
