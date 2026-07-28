import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseCliValue } from '../../src/cli-menu.mjs';
import { chooseTarget, parseCliTarget, selectTargetMenu } from '../../src/cli-targets.mjs';
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

  it.skipIf(process.platform !== 'darwin')('uses Metal for non-terminal init on macOS', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-cli-target-'));
    created.push(root);
    const result = spawnSync(process.execPath, [
      cli,
      'init',
      '--project-root', root,
      '--no-install-toolchain',
    ], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const scroll = JSON.parse(await readFile(
      join(root, 'scrolls', 'example-box', 'macos-aarch64-metal', 'scroll.json'),
      'utf8',
    ));
    expect(scroll.target.accelerator).toBe('metal');
  });

  it('scaffolds the exact nested target supplied to non-terminal init', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-cli-target-'));
    created.push(root);
    const adapter = boxTargetAdapters().find(({ host }) =>
      host.platform === process.platform && host.arch === process.arch);
    const targetId = `${adapter.platform}-${adapter.arch}-cpu`;
    const result = spawnSync(process.execPath, [
      cli,
      'init',
      '--project-root', root,
      '--target', targetId,
      '--pixi-version', '0.73.0',
      '--no-install-toolchain',
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
    expect(result.stdout).toContain(`scrollcase build example-box/${targetId}`);
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
