import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachExtractedBox,
  runBox,
  runExtractedBox,
  verifyAndExtractBox,
  verifyExtractedPayload,
} from '../../src/consumer/index.mjs';
import { PAYLOAD_DIGEST_FILE } from '../../src/contract/payload-digest.mjs';
import {
  createConsumerBoxFixture,
  writeSignedRelease,
} from '../helpers/consumer-box-fixture.mjs';

const created = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function scratch(label = 'consumer') {
  const path = await mkdtemp(join(tmpdir(), `scrollcase-${label}-`));
  created.push(path);
  return path;
}

async function boxFixture(options = {}) {
  const fixture = await createConsumerBoxFixture(options);
  created.push(fixture.root);
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

  it('refuses a destination that is a dangling symbolic link', async () => {
    // A caller-supplied path is made absolute lexically, never resolved. Resolving would follow
    // this broken link to a name the caller never asked for and install into it — the Python
    // consumer once did exactly that, and the two implementations may not disagree.
    const fixture = await boxFixture();
    const destination = join(fixture.root, 'dangling');
    await symlink(join(fixture.root, 'nowhere'), destination);

    await expect(verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination,
    })).rejects.toThrow(/Destination already exists/);
    await expect(stat(join(fixture.root, 'nowhere'))).rejects.toThrow();
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

describe('Node consumer re-attachment', () => {
  async function installed(options = {}) {
    const fixture = await boxFixture(options);
    const root = join(fixture.root, 'installed');
    await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: root,
    });
    return { fixture, root };
  }

  it('mints a receipt from an existing directory, marked for what it did not check', async () => {
    const { fixture, root } = await installed();
    const attached = await attachExtractedBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root,
    });

    // Everything the release states is carried over; only the status differs, because attaching
    // proved the document and the shape of the directory, never the bytes inside it.
    expect(attached).toMatchObject({
      status: 'attached',
      root,
      boxId: 'consumer-fixture',
      version: '2.0.0',
      execution: fixture.release.execution,
      archiveSha256: fixture.release.archive.sha256,
    });
    expect(Object.isFrozen(attached)).toBe(true);
  });

  it('produces a receipt execution accepts on equal terms', async () => {
    const { fixture, root } = await installed();
    const attached = await attachExtractedBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root,
    });
    const { spawn, calls } = fakeSpawn();
    const result = await runExtractedBox(attached, { args: ['--once'], spawn });

    // The load-bearing case: a box installed by one process is executable by the next, with the
    // same argument ordering and the same working directory as a freshly prepared one.
    expect(result).toMatchObject({ exitCode: 0, signal: null });
    expect(calls[0].args).toEqual([
      join(root, 'app', 'main.py'),
      ...fixture.release.execution.defaultArgs,
      '--once',
    ]);
    expect(calls[0].options.cwd).toBe(root);
    expect(calls[0].options.shell).toBe(false);
  });

  it('ignores whatever appeared in the box root after installation', async () => {
    const { fixture, root } = await installed();
    await writeFile(join(root, 'output.log'), 'the application wrote this');
    await mkdir(join(root, '__pycache__'));
    await writeFile(join(root, '__pycache__', 'x.pyc'), 'compiled');

    await expect(attachExtractedBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root,
    })).resolves.toMatchObject({ status: 'attached' });
  });

  it('refuses a root that is missing, a file, or a symbolic link', async () => {
    const { fixture, root } = await installed();
    const options = (target) => ({ publicPath: fixture.publicPath, root: target });

    await expect(attachExtractedBox(fixture.releasePath, options(join(fixture.root, 'nope'))))
      .rejects.toThrow(/is not an extracted box directory/);
    await expect(attachExtractedBox(fixture.releasePath, options(fixture.archivePath)))
      .rejects.toThrow(/is not an extracted box directory/);

    // A link would satisfy a naive directory check and then be refused by execution, leaving the
    // caller holding a receipt that can never run.
    const link = join(fixture.root, 'linked');
    await symlink(root, link);
    await expect(attachExtractedBox(fixture.releasePath, options(link)))
      .rejects.toThrow(/is not an extracted box directory/);
  });

  it('refuses a directory that is not the box the release describes', async () => {
    const { fixture, root } = await installed();
    await rm(join(root, 'app', 'main.py'));
    await expect(attachExtractedBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root,
    })).rejects.toThrow(/Execution script is missing/);

    const bare = await scratch('bare');
    await expect(attachExtractedBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root: bare,
    })).rejects.toThrow(/Attached box is missing/);
  });

  it('re-checks on-demand assets a caller was told to materialize', async () => {
    const assetBytes = Buffer.from('signed weights');
    const requiredAsset = {
      url: 'https://assets.example.org/weights.bin',
      relativePath: 'model-cache/weights.bin',
      sizeBytes: assetBytes.length,
      sha256: createHash('sha256').update(assetBytes).digest('hex'),
    };
    const { fixture, root } = await installed({ requiredAsset });
    const assetPath = join(root, 'model-cache', 'weights.bin');
    await mkdir(dirname(assetPath), { recursive: true });

    await expect(attachExtractedBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root,
    })).rejects.toThrow(/Required on-demand asset is missing/);

    await writeFile(assetPath, 'wrong bytes entirely');
    await expect(attachExtractedBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root,
    })).rejects.toThrow(/Required on-demand asset size mismatch/);

    await writeFile(assetPath, assetBytes);
    await expect(attachExtractedBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root,
    })).resolves.toMatchObject({ status: 'attached', requiredAssets: [requiredAsset] });
  });
});

describe('Node consumer payload verification', () => {
  async function installed(options = {}) {
    const fixture = await boxFixture(options);
    const root = join(fixture.root, 'installed');
    await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: root,
    });
    return { fixture, root };
  }

  const verify = (fixture, root) => verifyExtractedPayload(fixture.releasePath, {
    publicPath: fixture.publicPath,
    root,
  });

  it('walks the signed list and reports what it checked', async () => {
    const { fixture, root } = await installed();
    const verified = await verify(fixture, root);
    expect(verified).toMatchObject({
      status: 'verified',
      root,
      boxId: 'consumer-fixture',
      version: '2.0.0',
    });
    expect(verified.entryCount).toBeGreaterThan(0);
  });

  it('walks the list and not the directory, so later files are invisible', async () => {
    const { fixture, root } = await installed();
    // Everything an installed box legitimately grows: the app's own output in its working
    // directory, Python's caches, and a model cache filled after extraction.
    await writeFile(join(root, 'output.log'), 'the application wrote this');
    await mkdir(join(root, 'model-cache'), { recursive: true });
    await writeFile(join(root, 'model-cache', 'weights.bin'), 'downloaded later');
    await mkdir(join(root, '__pycache__'));
    await writeFile(join(root, '__pycache__', 'x.pyc'), 'compiled');

    await expect(verify(fixture, root)).resolves.toMatchObject({ status: 'verified' });
  });

  it('ignores a changed mode and a changed timestamp', async () => {
    const { fixture, root } = await installed();
    const script = join(root, 'app', 'main.py');
    // Modes are synthesised by the archive writer and never restored on Windows; timestamps are
    // stamped at build and restored by no extractor. Covering either would fail honest boxes.
    await chmod(script, 0o600);
    await utimes(script, new Date(0), new Date(0));
    await expect(verify(fixture, root)).resolves.toMatchObject({ status: 'verified' });
  });

  it('names the entry that no longer matches', async () => {
    const { fixture, root } = await installed();
    const script = join(root, 'app', 'main.py');
    await writeFile(script, `${await readFile(script, 'utf8')} `);
    await expect(verify(fixture, root))
      .rejects.toThrow(/Payload does not match the signed release: app\/main\.py/);

    await rm(script);
    await expect(verify(fixture, root))
      .rejects.toThrow(/app\/main\.py is missing/);
  });

  it('refuses a list that is absent, altered, or unsigned by this release', async () => {
    const { fixture, root } = await installed();
    const listPath = join(root, PAYLOAD_DIGEST_FILE);

    await writeFile(listPath, `${await readFile(listPath, 'utf8')}`.replace('box.json', 'box.jsoX'));
    await expect(verify(fixture, root))
      .rejects.toThrow(/Payload digest list does not match the signed release/);

    await rm(listPath);
    await expect(verify(fixture, root))
      .rejects.toThrow(/missing its payload digest list/);
  });

  it('refuses a release that commits to nothing rather than reporting success', async () => {
    const { fixture, root } = await installed({ payloadDigest: false });
    await expect(verify(fixture, root))
      .rejects.toThrow(/does not commit to a payload digest/);
  });
});

describe('Node consumer execution', () => {
  it('returns one masked provenance report from verify, attach, and execution', async () => {
    const name = 'SCROLLCASE_ENV_REPORT_TEST';
    vi.stubEnv(name, 'host-secret');
    vi.stubEnv('PYTHONPATH', '/host/code');
    const fixture = await boxFixture({
      environment: {
        [name]: 'release-value',
        SCROLLCASE_RELEASE_ONLY: 'public-value',
      },
    });
    const prepared = await verifyAndExtractBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      archive: fixture.archivePath,
      destination: join(fixture.root, 'prepared-environment'),
    });
    expect(prepared.environmentReport).toMatchObject({
      mode: 'summary',
      hostValuesRevealed: false,
      releaseVariableCount: 2,
      dangerousHostVariables: expect.arrayContaining(['PYTHONPATH']),
    });
    expect(prepared.environmentReport.variables.find((entry) => entry.name === name))
      .toMatchObject({ source: 'release', value: 'release-value', conflict: true });
    expect(prepared.environmentReport.variables
      .find((entry) => entry.name === name).sources[0].value).toBe('<masked>');

    const attached = await attachExtractedBox(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root: prepared.root,
      envReport: true,
    });
    expect(attached.environmentReport.mode).toBe('full');

    const verified = await verifyExtractedPayload(fixture.releasePath, {
      publicPath: fixture.publicPath,
      root: prepared.root,
      envReport: true,
    });
    expect(verified.environmentReport.mode).toBe('full');

    const callback = vi.fn();
    const fake = fakeSpawn();
    const result = await runExtractedBox(attached, {
      env: { [name]: 'caller-value' },
      envReportValues: true,
      onEnvironmentReport: callback,
      spawn: fake.spawn,
    });
    expect(fake.calls[0].options.env[name]).toBe('release-value');
    expect(result.environmentReport).toMatchObject({
      mode: 'full',
      hostValuesRevealed: true,
      releaseVariableCount: 2,
    });
    const resolved = result.environmentReport.variables.find((entry) => entry.name === name);
    expect(resolved).toMatchObject({ source: 'release', value: 'release-value', conflict: true });
    expect(resolved.sources.map((source) => source.source))
      .toEqual(['host', 'caller', 'release']);
    expect(resolved.sources[0].value).toBe('host-secret');
    expect(callback).toHaveBeenCalledWith(result.environmentReport);
  });

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

    expect(result).toMatchObject({ exitCode: 17, signal: null });
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
    })).resolves.toMatchObject({ exitCode: 0, signal: null });
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
      })).resolves.toMatchObject({ exitCode: 7, signal: null });
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
      .resolves.toMatchObject({ exitCode: 0, signal: null });
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

    await expect(running).resolves.toMatchObject({ exitCode: null, signal: 'SIGTERM' });
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
    })).resolves.toMatchObject({ exitCode: 23, signal: null });
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

    await expect(running).resolves.toMatchObject({ exitCode: null, signal: 'SIGINT' });
    await expect(readdir(temporaryDirectory)).resolves.toEqual([]);
  });
});
