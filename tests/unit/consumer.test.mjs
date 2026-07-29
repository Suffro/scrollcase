import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeterministicZip } from '../../src/build/archive.mjs';
import { payloadSize, sha256File } from '../../src/build/filesystem.mjs';
import {
  runBox,
  runExtractedBox,
  verifyAndExtractBox,
} from '../../src/consumer/index.mjs';
import { boxTargetAdapter } from '../../src/contract/targets.mjs';
import { documentKinds } from '../../src/contract/documents.mjs';
import { generateSigningKey, signDocument } from '../../src/sign/index.mjs';

const created = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function scratch(label = 'consumer') {
  const path = await mkdtemp(join(tmpdir(), `scrollcase-${label}-`));
  created.push(path);
  return path;
}

function nativeTarget() {
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

async function writeSignedRelease(fixture, release) {
  const signed = await signDocument(release, {
    privatePath: fixture.privatePath,
    publicPath: fixture.publicPath,
  });
  await writeFile(fixture.releasePath, `${JSON.stringify(signed, null, 2)}\n`);
}

async function boxFixture({
  execution = {
    kind: 'python-script',
    script: 'app/main.py',
    defaultArgs: ['--default', 'value with spaces'],
  },
  requiredAsset = null,
  interpreterContents = 'test interpreter placeholder',
  scriptContents = 'print("consumer fixture")\n',
} = {}) {
  const root = await scratch('consumer-fixture');
  const payload = join(root, 'payload');
  await mkdir(payload);
  const target = nativeTarget();
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

function fakeSpawn({
  exitCode = 0,
  signal = null,
  error = null,
  closeAutomatically = true,
} = {}) {
  const calls = [];
  const children = [];
  const spawn = vi.fn((command, args, options) => {
    const child = new EventEmitter();
    child.kill = vi.fn((forwardedSignal) => {
      queueMicrotask(() => child.emit('close', null, forwardedSignal));
      return true;
    });
    calls.push({ command, args, options });
    children.push(child);
    if (closeAutomatically) {
      queueMicrotask(() => {
        if (error) child.emit('error', error);
        else child.emit('close', exitCode, signal);
      });
    }
    return child;
  });
  return { spawn, calls, children };
}

describe('Node consumer preparation', () => {
  it('verifies, extracts through staging, and returns an immutable typed receipt', async () => {
    const fixture = await boxFixture();
    const destination = join(fixture.root, 'installed');
    const prepared = await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination,
    });

    expect(prepared).toMatchObject({
      status: 'prepared',
      root: destination,
      boxId: 'consumer-fixture',
      targetId: expect.any(String),
      execution: fixture.release.execution,
      requiredAssets: [],
      releasePayloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      archiveSha256: fixture.release.archive.sha256,
      installedSizeBytes: fixture.release.installedSizeBytes,
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(JSON.parse(await readFile(join(destination, 'box.json'), 'utf8')).boxId)
      .toBe('consumer-fixture');
    expect((await readdir(fixture.root)).some((name) => name.startsWith('.scrollcase-prepare-')))
      .toBe(false);
  });

  it('refuses an existing destination without altering it', async () => {
    const fixture = await boxFixture();
    const destination = join(fixture.root, 'existing');
    await mkdir(destination);
    await writeFile(join(destination, 'marker'), 'keep');

    await expect(verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination,
    })).rejects.toThrow(/Destination already exists/);
    await expect(readFile(join(destination, 'marker'), 'utf8')).resolves.toBe('keep');
  });

  it('removes staging and publishes no destination when logical size disagrees', async () => {
    const fixture = await boxFixture();
    await writeSignedRelease(fixture, {
      ...fixture.release,
      installedSizeBytes: fixture.release.installedSizeBytes + 1,
    });
    const destination = join(fixture.root, 'rejected');

    await expect(verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination,
    })).rejects.toThrow(/payload size does not match/);
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(fixture.root)).some((name) => name.startsWith('.scrollcase-prepare-')))
      .toBe(false);
  });

  it('rejects an unsafe signed on-demand asset path before extraction', async () => {
    const fixture = await boxFixture({
      requiredAsset: {
        url: 'https://assets.example.org/escape.bin',
        relativePath: '../escape.bin',
        sizeBytes: 1,
        sha256: 'a'.repeat(64),
      },
    });
    const destination = join(fixture.root, 'unsafe-assets');

    await expect(verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination,
    })).rejects.toThrow(/Unsafe relative path/);
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an invalid signed-envelope shape even when its payload signature verifies', async () => {
    const fixture = await boxFixture();
    const signed = JSON.parse(await readFile(fixture.releasePath, 'utf8'));
    signed.signatures[0].algorithm = 'rsa';
    await writeFile(fixture.releasePath, `${JSON.stringify(signed, null, 2)}\n`);

    await expect(verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: join(fixture.root, 'invalid-envelope'),
    })).rejects.toThrow(/Invalid signed document/);
  });
});

describe('Node consumer execution', () => {
  it('accepts only an authentic prepared receipt and preserves shell-free argument ordering', async () => {
    const fixture = await boxFixture();
    const prepared = await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: join(fixture.root, 'prepared'),
    });
    await expect(runExtractedBox({ ...prepared })).rejects.toThrow(/Expected a PreparedBox/);

    const fake = fakeSpawn({ exitCode: 17 });
    const stdin = new EventEmitter();
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    await expect(runExtractedBox(prepared, {
      args: [42],
      spawn: fake.spawn,
    })).rejects.toThrow(/array of strings/);
    const result = await runExtractedBox(prepared, {
      args: ['--caller', '$(touch never)', 'semi;colon'],
      env: { CONSUMER_FIXTURE: 'yes' },
      stdin,
      stdout,
      stderr,
      spawn: fake.spawn,
    });

    expect(result).toEqual({ exitCode: 17, signal: null });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].command).toBe(join(prepared.root, ...prepared.pythonEntryPoint.split('/')));
    expect(fake.calls[0].args).toEqual([
      join(prepared.root, 'app/main.py'),
      '--default',
      'value with spaces',
      '--caller',
      '$(touch never)',
      'semi;colon',
    ]);
    expect(fake.calls[0].options).toMatchObject({
      cwd: prepared.root,
      shell: false,
      stdio: [stdin, stdout, stderr],
    });
    expect(fake.calls[0].options.env.CONSUMER_FIXTURE).toBe('yes');
  });

  it('invokes a declared module through Python -m before signed and caller arguments', async () => {
    const fixture = await boxFixture({
      execution: {
        kind: 'python-module',
        module: 'example.application',
        defaultArgs: ['--signed-default'],
      },
    });
    const prepared = await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: join(fixture.root, 'prepared-module'),
    });
    const fake = fakeSpawn();

    await expect(runExtractedBox(prepared, {
      args: ['--caller'],
      spawn: fake.spawn,
    })).resolves.toEqual({ exitCode: 0, signal: null });
    expect(fake.calls[0].args).toEqual([
      '-m',
      'example.application',
      '--signed-default',
      '--caller',
    ]);
  });

  it.skipIf(process.platform === 'win32')(
    'executes the real child path with cwd, arguments, and exit code intact',
    async () => {
      const marker = 'actual-run.json';
      const interpreterContents = [
        '#!/bin/sh',
        `exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"`,
        '',
      ].join('\n');
      const scriptContents = [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync('${marker}', JSON.stringify(process.argv.slice(2)));`,
        'process.exit(7);',
        '',
      ].join('\n');
      const fixture = await boxFixture({
        execution: {
          kind: 'python-script',
          script: 'app/main.mjs',
          defaultArgs: ['--default', 'value with spaces'],
        },
        interpreterContents,
        scriptContents,
      });
      const prepared = await verifyAndExtractBox(fixture.releasePath, {
        publicPath: fixture.publicPath,
        archive: fixture.archivePath,
        destination: join(fixture.root, 'prepared-real-child'),
      });

      await expect(runExtractedBox(prepared, {
        args: ['--caller', '$(touch never)'],
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      })).resolves.toEqual({ exitCode: 7, signal: null });
      await expect(readFile(join(prepared.root, marker), 'utf8'))
        .resolves.toBe(JSON.stringify([
          '--default',
          'value with spaces',
          '--caller',
          '$(touch never)',
        ]));
      await expect(stat(join(prepared.root, 'never'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('rejects a prepared root that was replaced after verification', async () => {
    const fixture = await boxFixture();
    const prepared = await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: join(fixture.root, 'prepared-replaced'),
    });
    await rename(prepared.root, `${prepared.root}-original`);
    await mkdir(prepared.root);

    await expect(runExtractedBox(prepared, { spawn: fakeSpawn().spawn }))
      .rejects.toThrow(/no longer matches the prepared box/);
  });

  it('verifies every caller-materialized on-demand asset before spawning', async () => {
    const bytes = Buffer.from('trusted on-demand bytes');
    const requiredAsset = {
      url: 'https://assets.example.org/weights.bin',
      relativePath: 'model-cache/consumer-fixture/weights.bin',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const fixture = await boxFixture({ requiredAsset });
    const prepared = await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: join(fixture.root, 'prepared-assets'),
    });
    const fake = fakeSpawn();

    await expect(runExtractedBox(prepared, { spawn: fake.spawn }))
      .rejects.toThrow(/asset is missing/);
    const assetPath = join(prepared.root, ...requiredAsset.relativePath.split('/'));
    await mkdir(dirname(assetPath), { recursive: true });
    await writeFile(assetPath, bytes.subarray(1));
    await expect(runExtractedBox(prepared, { spawn: fake.spawn }))
      .rejects.toThrow(/asset size mismatch/);
    await writeFile(assetPath, Buffer.alloc(bytes.length, 0x78));
    await expect(runExtractedBox(prepared, { spawn: fake.spawn }))
      .rejects.toThrow(/asset SHA-256 mismatch/);
    await writeFile(assetPath, bytes);
    await expect(runExtractedBox(prepared, { spawn: fake.spawn }))
      .resolves.toEqual({ exitCode: 0, signal: null });
    expect(fake.spawn).toHaveBeenCalledTimes(1);
  });

  it('forwards termination signals and removes every parent listener', async () => {
    const fixture = await boxFixture();
    const prepared = await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: join(fixture.root, 'prepared-signal'),
    });
    const fake = fakeSpawn({ closeAutomatically: false });
    const signalSource = new EventEmitter();
    const running = runExtractedBox(prepared, {
      spawn: fake.spawn,
      signalSource,
    });
    while (fake.spawn.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    signalSource.emit('SIGTERM');

    await expect(running).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' });
    expect(fake.children[0].kill).toHaveBeenCalledWith('SIGTERM');
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      expect(signalSource.listenerCount(signal)).toBe(0);
    }
  });

  it('fails clearly when a prepared library-only box has no execution entry point', async () => {
    const fixture = await boxFixture({ execution: null });
    const prepared = await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: join(fixture.root, 'prepared-library'),
    });
    await expect(runExtractedBox(prepared)).rejects.toThrow(/does not declare an execution/);
  });
});

describe('one-shot Node consumer execution', () => {
  it('preserves a non-zero child exit code and removes its temporary extraction', async () => {
    const fixture = await boxFixture();
    const temporaryDirectory = await scratch('consumer-run');
    const fake = fakeSpawn({ exitCode: 23 });

    await expect(runBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      temporaryDirectory,
      spawn: fake.spawn,
      args: ['--one-shot'],
    })).resolves.toEqual({ exitCode: 23, signal: null });
    await expect(readdir(temporaryDirectory)).resolves.toEqual([]);
  });

  it('removes its temporary extraction when the child cannot start', async () => {
    const fixture = await boxFixture();
    const temporaryDirectory = await scratch('consumer-run-error');
    const fake = fakeSpawn({ error: new Error('spawn failed') });

    await expect(runBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      temporaryDirectory,
      spawn: fake.spawn,
    })).rejects.toThrow(/spawn failed/);
    await expect(readdir(temporaryDirectory)).resolves.toEqual([]);
  });

  it('removes its temporary extraction after forwarding a child signal', async () => {
    const fixture = await boxFixture();
    const temporaryDirectory = await scratch('consumer-run-signal');
    const fake = fakeSpawn({ closeAutomatically: false });
    const signalSource = new EventEmitter();
    const running = runBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      temporaryDirectory,
      spawn: fake.spawn,
      signalSource,
    });
    while (fake.spawn.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    signalSource.emit('SIGINT');

    await expect(running).resolves.toEqual({ exitCode: null, signal: 'SIGINT' });
    await expect(readdir(temporaryDirectory)).resolves.toEqual([]);
  });
});
