import { spawn, spawnSync } from 'node:child_process';
import {
  readFile,
  rm,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCliBox } from '../../src/cli-run.mjs';
import { boxTargetAdapters } from '../../src/contract/targets.mjs';
import { createConsumerBoxFixture } from '../helpers/consumer-box-fixture.mjs';

const prepared = {
  boxId: 'example-box',
  version: '1.2.3',
  targetId: 'linux-x86_64-cpu',
  installedSizeBytes: 3 * 1024 ** 3,
  execution: {
    kind: 'python-script',
    script: 'app.py',
    defaultArgs: [],
  },
};
const cli = fileURLToPath(new URL('../../src/cli.mjs', import.meta.url));
const created = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the run CLI edge', () => {
  it('requires exactly one release path before the application separator', () => {
    const missing = spawnSync(process.execPath, [cli, 'run'], { encoding: 'utf8' });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(
      'Usage: scrollcase run <release.json> [--archive <box.zip>] -- [application args]',
    );

    const extra = spawnSync(process.execPath, [
      cli,
      'run',
      'release.json',
      'application-arg-without-separator',
    ], { encoding: 'utf8' });
    expect(extra.status).toBe(1);
    expect(extra.stderr).toContain('Usage: scrollcase run');
  });

  it('delegates once to runBox, reports signed identity, and preserves the child exit code', async () => {
    const log = vi.fn();
    const setExitCode = vi.fn();
    const run = vi.fn(async (releasePath, options) => {
      expect(releasePath).toBe('release.json');
      await options.onPrepared(prepared);
      return { exitCode: 23, signal: null };
    });

    await expect(runCliBox('release.json', {
      publicPath: 'trusted.json',
      archive: 'box.zip',
      args: ['value with spaces', '$(touch never)'],
      run,
      log,
      setExitCode,
    })).resolves.toEqual({ exitCode: 23, signal: null });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('release.json', expect.objectContaining({
      publicPath: 'trusted.json',
      archive: 'box.zip',
      args: ['value with spaces', '$(touch never)'],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      onPrepared: expect.any(Function),
    }));
    expect(log).toHaveBeenCalledWith(
      'Running example-box 1.2.3 (linux-x86_64-cpu, python-script)',
    );
    expect(log).toHaveBeenCalledWith(
      '3.0 GB extracted to a temporary directory, deleted on exit.',
    );
    expect(setExitCode).toHaveBeenCalledWith(23);
  });

  it('announces the one-shot extraction even when the box carries no measured size', async () => {
    const log = vi.fn();
    const run = vi.fn(async (releasePath, options) => {
      await options.onPrepared({ ...prepared, installedSizeBytes: undefined });
      return { exitCode: 0, signal: null };
    });

    await runCliBox('release.json', {
      publicPath: 'trusted.json',
      run,
      log,
      setExitCode: vi.fn(),
    });

    expect(log).toHaveBeenCalledWith('Extracted to a temporary directory, deleted on exit.');
  });

  it('re-raises the child termination signal after runBox has cleaned up', async () => {
    const setExitCode = vi.fn();
    const terminate = vi.fn();
    const run = vi.fn().mockResolvedValue({ exitCode: null, signal: 'SIGINT' });

    await expect(runCliBox('release.json', {
      publicPath: 'trusted.json',
      args: [],
      run,
      log: vi.fn(),
      setExitCode,
      terminate,
    })).resolves.toEqual({ exitCode: null, signal: 'SIGINT' });

    expect(terminate).toHaveBeenCalledWith('SIGINT');
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')(
    'preserves application arguments and exit status through the real CLI',
    async () => {
      const sentinel = `never-${process.pid}`;
      const interpreterContents = [
        '#!/bin/sh',
        `exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"`,
        '',
      ].join('\n');
      const scriptContents = [
        "console.log(`APP_ARGS=${JSON.stringify(process.argv.slice(2))}`);",
        'process.exit(7);',
        '',
      ].join('\n');
      const fixture = await createConsumerBoxFixture({
        execution: {
          kind: 'python-script',
          script: 'app/main.mjs',
          defaultArgs: ['--default', 'value with spaces'],
        },
        interpreterContents,
        scriptContents,
      });
      created.push(fixture.root);
      const injection = `$(touch ${join(fixture.root, sentinel)})`;

      const result = spawnSync(process.execPath, [
        cli,
        'run',
        fixture.releasePath,
        '--archive', fixture.archivePath,
        '--public-key', fixture.publicPath,
        '--',
        '--caller',
        '"quoted"',
        injection,
      ], { encoding: 'utf8' });

      expect(result.status, result.stderr).toBe(7);
      // Scrollcase's own lines go to stderr and the box owns stdout, so a caller redirecting
      // stdout to a file receives the application's bytes and nothing else.
      expect(result.stderr).toContain('Running consumer-fixture 2.0.0');
      expect(result.stderr).toMatch(/extracted to a temporary directory, deleted on exit\./i);
      expect(result.stdout).not.toMatch(/Running consumer-fixture/);
      expect(result.stdout).toContain(`APP_ARGS=${JSON.stringify([
        '--default',
        'value with spaces',
        '--caller',
        '"quoted"',
        injection,
      ])}`);
      await expect(stat(join(fixture.root, sentinel))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'forwards Ctrl-C and cleans the temporary box before terminating by the same signal',
    async () => {
      const interpreterContents = [
        '#!/bin/sh',
        `exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"`,
        '',
      ].join('\n');
      const scriptContents = [
        "console.log(`READY_ROOT=${process.cwd()}`);",
        'setInterval(() => {}, 1000);',
        '',
      ].join('\n');
      const fixture = await createConsumerBoxFixture({
        execution: {
          kind: 'python-script',
          script: 'app/wait.mjs',
          defaultArgs: [],
        },
        interpreterContents,
        scriptContents,
      });
      created.push(fixture.root);
      const child = spawn(process.execPath, [
        cli,
        'run',
        fixture.releasePath,
        '--archive', fixture.archivePath,
        '--public-key', fixture.publicPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const preparedRoot = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`Timed out waiting for child readiness.\nstdout: ${stdout}\nstderr: ${stderr}`));
        }, 5000);
        const onEarlyClose = (code, signal) => {
          clearTimeout(timeout);
          reject(new Error(
            `CLI closed before readiness with code ${code}, signal ${signal}.\n`
            + `stdout: ${stdout}\nstderr: ${stderr}`,
          ));
        };
        const inspect = () => {
          const match = /READY_ROOT=([^\r\n]+)/.exec(stdout);
          if (!match) return;
          clearTimeout(timeout);
          child.stdout.removeListener('data', inspect);
          child.removeListener('close', onEarlyClose);
          resolve(match[1]);
        };
        child.stdout.on('data', inspect);
        child.once('close', onEarlyClose);
      });

      const terminalPromise = new Promise((resolve) => {
        child.once('close', (code, signal) => resolve({ code, signal }));
      });
      child.kill('SIGINT');
      const terminal = await terminalPromise;
      expect(terminal).toEqual({ code: null, signal: 'SIGINT' });
      await expect(stat(preparedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('rejects a library-only release and an unmaterialized on-demand asset', async () => {
    const library = await createConsumerBoxFixture({ execution: null });
    created.push(library.root);
    const libraryResult = spawnSync(process.execPath, [
      cli,
      'run',
      library.releasePath,
      '--archive', library.archivePath,
      '--public-key', library.publicPath,
    ], { encoding: 'utf8' });
    expect(libraryResult.status).toBe(1);
    expect(libraryResult.stderr).toMatch(/does not declare an execution entry point/);

    const bytes = Buffer.from('required');
    const assets = await createConsumerBoxFixture({
      requiredAsset: {
        url: 'https://assets.example.org/required.bin',
        relativePath: 'model-cache/consumer-fixture/required.bin',
        sizeBytes: bytes.length,
        sha256: 'a'.repeat(64),
      },
    });
    created.push(assets.root);
    const assetResult = spawnSync(process.execPath, [
      cli,
      'run',
      assets.releasePath,
      '--archive', assets.archivePath,
      '--public-key', assets.publicPath,
    ], { encoding: 'utf8' });
    expect(assetResult.status).toBe(1);
    expect(assetResult.stderr).toMatch(/Required on-demand asset is missing/);
  });

  it('rejects a release for a non-native target before spawning its interpreter', async () => {
    const adapter = boxTargetAdapters().find(({ host }) =>
      host.platform !== process.platform || host.arch !== process.arch);
    const fixture = await createConsumerBoxFixture({
      target: {
        platform: adapter.platform,
        arch: adapter.arch,
        accelerator: 'cpu',
      },
    });
    created.push(fixture.root);

    const result = spawnSync(process.execPath, [
      cli,
      'run',
      fixture.releasePath,
      '--archive', fixture.archivePath,
      '--public-key', fixture.publicPath,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/cannot run.*requires/);
    await expect(readFile(join(fixture.root, 'payload', 'app', 'main.py'), 'utf8'))
      .resolves.toContain('consumer fixture');
  });
});
