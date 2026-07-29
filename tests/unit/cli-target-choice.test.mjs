import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseCliValue } from '../../src/cli-menu.mjs';
import {
  chooseScroll,
  chooseTarget,
  nativeExampleTarget,
  parseCliTarget,
  selectTargetMenu,
} from '../../src/cli-targets.mjs';
import { boxTargetAdapters } from '../../src/contract/targets.mjs';

const macos = { platform: 'darwin', arch: 'arm64' };
const linux = { platform: 'linux', arch: 'x64' };
const candidate = (targetId, host) => ({ targetId, adapter: { host } });
const cli = fileURLToPath(new URL('../../src/cli.mjs', import.meta.url));
const created = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('CLI target selection', () => {
  it('uses the sole host target without a terminal when other-platform targets also exist', async () => {
    const log = vi.fn();
    const selected = await chooseTarget([
      candidate('macos-aarch64-metal', macos),
      candidate('linux-x86_64-cpu', linux),
    ], { terminal: false, host: macos, log });
    expect(selected.targetId).toBe('macos-aarch64-metal');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/no terminal.*macos-aarch64-metal/));
  });

  it('refuses an ambiguous non-terminal selection without a platform default', async () => {
    await expect(chooseTarget([
      candidate('linux-x86_64-cpu', linux),
      candidate('linux-x86_64-cuda12.4', linux),
    ], { terminal: false, host: linux })).rejects.toThrow(/more than one available target.*--target/);
  });

  it('uses Metal by default for non-terminal macOS selection', async () => {
    const log = vi.fn();
    const selected = await chooseTarget([
      candidate('macos-aarch64-cpu', macos),
      candidate('macos-aarch64-metal', macos),
    ], { terminal: false, host: macos, log });
    expect(selected.targetId).toBe('macos-aarch64-metal');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('macos-aarch64-metal'));
  });

  it('preselects Metal in the interactive macOS menu', async () => {
    const menu = vi.fn().mockResolvedValue(0);
    const selected = await chooseTarget([
      candidate('macos-aarch64-cpu', macos),
      candidate('macos-aarch64-metal', macos),
    ], { terminal: true, host: macos, menu });
    expect(selected.targetId).toBe('macos-aarch64-cpu');
    expect(menu).toHaveBeenCalledWith(
      ['macos-aarch64-cpu', 'macos-aarch64-metal'],
      { initialIndex: 1 },
    );
  });

  it('provides a navigable keyboard menu', async () => {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = vi.fn();
    const output = new PassThrough();
    let rendered = '';
    output.on('data', (chunk) => {
      rendered += chunk.toString();
    });

    const selection = selectTargetMenu(
      ['macos-aarch64-cpu', 'macos-aarch64-metal'],
      { input, output, initialIndex: 1 },
    );
    input.write('\x1b[A');
    input.write('\r');

    await expect(selection).resolves.toBe(0);
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(rendered).toContain('Use ↑/↓');
    expect(rendered).toContain('❯ macos-aarch64-cpu');
  });

  it('honours an explicit target and rejects one outside the available scrolls', async () => {
    const candidates = [
      candidate('macos-aarch64-cpu', macos),
      candidate('macos-aarch64-metal', macos),
    ];
    await expect(chooseTarget(candidates, { requested: 'macos-aarch64-metal' }))
      .resolves.toMatchObject({ targetId: 'macos-aarch64-metal' });
    await expect(chooseTarget(candidates, { requested: 'linux-x86_64-cpu' }))
      .rejects.toThrow(/not available.*macos-aarch64-cpu, macos-aarch64-metal/);
  });

  it('selects an omitted scroll through the navigable terminal menu', async () => {
    const menu = vi.fn().mockResolvedValue(1);
    const selected = await chooseScroll([
      { reference: 'alpha/linux-x86_64-cpu' },
      { reference: 'beta/linux-x86_64-cpu' },
    ], { terminal: true, menu });

    expect(selected.reference).toBe('beta/linux-x86_64-cpu');
    expect(menu).toHaveBeenCalledWith(
      'scroll',
      ['alpha/linux-x86_64-cpu', 'beta/linux-x86_64-cpu'],
      { initialIndex: 0 },
    );
  });

  it('requires an explicit scroll when no terminal can ask', async () => {
    await expect(chooseScroll([
      { reference: 'example-box/linux-x86_64-cpu' },
    ], { terminal: false })).rejects.toThrow(/scroll.*interactive terminal/);
  });

  it('parses complete canonical targets, including the CUDA ABI version', () => {
    expect(parseCliTarget('macos-aarch64-metal')).toEqual({
      platform: 'macos',
      arch: 'aarch64',
      accelerator: 'metal',
    });
    expect(parseCliTarget('linux-x86_64-cuda12.4')).toEqual({
      platform: 'linux',
      arch: 'x86_64',
      accelerator: 'cuda',
      cudaVersion: '12.4',
    });
    expect(() => parseCliTarget('linux-x86_64-cuda')).toThrow(/complete target/);
  });

  it.each([
    [{ platform: 'darwin', arch: 'arm64' }, 'macos-aarch64-metal'],
    [{ platform: 'linux', arch: 'x64' }, 'linux-x86_64-cpu'],
    [{ platform: 'win32', arch: 'x64' }, 'windows-x86_64-cpu'],
  ])('chooses the portable init example target for %j', (host, targetId) => {
    expect(nativeExampleTarget(host)).toEqual(parseCliTarget(targetId));
  });

  it('creates a runnable example scroll for the native host by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-cli-target-'));
    created.push(root);
    const result = spawnSync(process.execPath, [
      cli,
      'init',
      '--project-root', root,
      '--no-install-toolchain',
    ], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(await readFile(join(root, 'scrollcase.config.json'), 'utf8'))).toMatchObject({
      version: 1,
    });
    const adapter = boxTargetAdapters().find(({ host }) =>
      host.platform === process.platform && host.arch === process.arch);
    const accelerator = adapter.platform === 'macos' ? 'metal' : 'cpu';
    const targetId = `${adapter.platform}-${adapter.arch}-${accelerator}`;
    const scroll = JSON.parse(await readFile(
      join(root, 'scrolls', 'example-box', targetId, 'scroll.json'),
      'utf8',
    ));
    expect(scroll).toMatchObject({
      schemaVersion: 2,
      boxId: 'example-box',
      target: {
        platform: adapter.platform,
        arch: adapter.arch,
        accelerator,
      },
      execution: {
        kind: 'python-script',
        script: 'entrypoint.py',
      },
      localFiles: [{
        sourcePath: `box-entrypoints/example-box/${targetId}/entrypoint.py`,
        relativePath: 'entrypoint.py',
      }],
    });
    expect(await readFile(
      join(root, 'box-entrypoints', 'example-box', targetId, 'entrypoint.py'),
      'utf8',
    )).toContain('Scrollcase box is ready.');
    expect(await readFile(
      join(root, 'consumer-templates', 'run-box.ts'),
      'utf8',
    )).toContain('runBox(releaseToRun');
    const pythonConsumer = await readFile(
      join(root, 'consumer-templates', 'run_box.py'),
      'utf8',
    );
    expect(pythonConsumer).toContain('from scrollcase_consumer import');
    expect(pythonConsumer).toContain('run_box');
    expect(pythonConsumer).toContain(
      'npm install scrollcase does not install this Python package',
    );
    const pyproject = await readFile(
      fileURLToPath(new URL('../../python/pyproject.toml', import.meta.url)),
      'utf8',
    );
    const pythonPackageVersion = pyproject.match(/^version = "([^"]+)"$/m)?.[1];
    expect(pythonPackageVersion).toBeTruthy();
    expect(pythonConsumer).toContain(
      `pip install scrollcase-consumer==${pythonPackageVersion}`,
    );
    expect(pythonConsumer).toContain('python consumer-templates/run_box.py');
    expect(pythonConsumer).not.toContain('.scrollcase/python-consumer');
    expect(await readdir(root)).not.toContain('consumer-examples');
    expect(result.stdout).toContain('Workspace initialized');
    expect(result.stdout).toContain(`Example: scrollcase lock example-box/${targetId}`);
    expect(result.stdout).toContain('Create your own: scrollcase new scroll');
  });

  it('supports an explicitly empty workspace with --no-example', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-cli-target-'));
    created.push(root);
    const result = spawnSync(process.execPath, [
      cli,
      'init',
      '--project-root', root,
      '--no-example',
      '--no-install-toolchain',
    ], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(await readdir(join(root, 'scrolls'))).toEqual([]);
    expect(result.stdout).toContain('Workspace initialized');
    expect(result.stdout).toContain('Next: scrollcase new scroll');
  });

  it.each(['lock', 'build'])(
    'routes an omitted %s scroll to terminal selection',
    async (command) => {
      const root = await mkdtemp(join(tmpdir(), 'scrollcase-cli-target-'));
      created.push(root);
      const initialized = spawnSync(process.execPath, [
        cli,
        'init',
        '--project-root', root,
        '--no-install-toolchain',
      ], { encoding: 'utf8' });
      expect(initialized.status, initialized.stderr).toBe(0);

      const result = spawnSync(process.execPath, [
        cli,
        command,
        '--project-root', root,
      ], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/scroll selection requires an interactive terminal/);
    },
  );

  it('creates the exact nested target supplied to non-terminal new scroll', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-cli-target-'));
    created.push(root);
    const initialized = spawnSync(process.execPath, [
      cli,
      'init',
      '--project-root', root,
      '--no-example',
      '--no-install-toolchain',
    ], { encoding: 'utf8' });
    expect(initialized.status, initialized.stderr).toBe(0);
    const adapter = boxTargetAdapters().find(({ host }) =>
      host.platform === process.platform && host.arch === process.arch);
    const targetId = `${adapter.platform}-${adapter.arch}-cpu`;
    const result = spawnSync(process.execPath, [
      cli,
      'new',
      'scroll',
      '--project-root', root,
      '--target', targetId,
      '--box-id', 'example-box',
      '--model-id', 'example-org-example-model',
      '--runtime-id', 'example-runtime',
      '--version', '1.0.0',
      '--scroll-version', '1.0.0',
      '--source-revision', 'upstream-v1',
      '--python-version', '3.11.15',
      '--pixi-version', '0.73.0',
      '--min-host-app-version', '1.0.0',
      '--asset-base-url', 'https://assets.example.org',
      '--weights', 'embed',
      '--execution', 'library-only',
    ], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const scrollPath = join(root, 'scrolls', 'example-box', targetId, 'scroll.json');
    const scroll = JSON.parse(await readFile(scrollPath, 'utf8'));
    expect(scroll.scrollId).toBeUndefined();
    expect(scroll.target).toEqual({
      platform: adapter.platform,
      arch: adapter.arch,
      accelerator: 'cpu',
    });
    expect(scroll.execution).toBeUndefined();
    expect(result.stdout).toContain(`Created scroll example-box/${targetId}`);
    expect(result.stdout).toContain(`Next: scrollcase lock example-box/${targetId}`);
  });

  it('fails non-terminal missing input before writing anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-cli-target-'));
    created.push(root);
    const result = spawnSync(process.execPath, [
      cli,
      'new',
      'scroll',
      '--project-root', root,
      '--box-id', 'incomplete',
    ], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/new scroll requires --target/);
    expect(await readdir(root)).toEqual([]);
  });
});

describe('CLI build choices', () => {
  it('shows beta, stable, and nightly in the navigable channel menu', async () => {
    const menu = vi.fn().mockResolvedValue(2);
    await expect(chooseCliValue(
      'channel',
      ['beta', 'stable', 'nightly'],
      { terminal: true, menu },
    )).resolves.toBe('nightly');
    expect(menu).toHaveBeenCalledWith(
      'channel',
      ['beta', 'stable', 'nightly'],
      { initialIndex: 0 },
    );
  });

  it('selects on-demand weights through the same navigable menu', async () => {
    const menu = vi.fn().mockResolvedValue(1);
    await expect(chooseCliValue(
      'weights mode',
      ['embed', 'on-demand'],
      { terminal: true, menu },
    )).resolves.toBe('on-demand');
  });

  it('rejects a channel outside the v2 contract', async () => {
    await expect(chooseCliValue(
      'channel',
      ['beta', 'stable', 'nightly'],
      { flag: 'internal' },
    )).rejects.toThrow(/Unsupported channel/);
  });
});
