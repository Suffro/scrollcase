import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseTarget, parseCliTarget } from '../../src/cli-targets.mjs';
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

  it('refuses an ambiguous non-terminal selection when the host can build several targets', async () => {
    await expect(chooseTarget([
      candidate('macos-aarch64-cpu', macos),
      candidate('macos-aarch64-metal', macos),
    ], { terminal: false, host: macos })).rejects.toThrow(/more than one available target.*--target/);
  });

  it('offers no interactive default when several targets match the host', async () => {
    const answers = ['', 'macos-aarch64-cpu'];
    const ask = vi.fn(async () => answers.shift());
    const log = vi.fn();
    const selected = await chooseTarget([
      candidate('macos-aarch64-cpu', macos),
      candidate('macos-aarch64-metal', macos),
    ], { terminal: true, host: macos, ask, log });
    expect(selected.targetId).toBe('macos-aarch64-cpu');
    expect(ask.mock.calls[0][0]).not.toMatch(/\(.*\)/);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Choose one/));
  });

  it('honours an explicit target and rejects one outside the available recipes', async () => {
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

  it('makes non-terminal init fail before writing when the host has several target choices', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-cli-target-'));
    created.push(root);
    const result = spawnSync(process.execPath, [
      cli,
      'init',
      '--project-root', root,
      '--no-install-toolchain',
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/more than one available target.*--target/);
    await expect(readFile(join(root, 'scrollcase.config.json'), 'utf8')).rejects.toThrow();
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
    const recipePath = join(root, 'recipes', 'example-box', targetId, 'recipe.json');
    const recipe = JSON.parse(await readFile(recipePath, 'utf8'));
    expect(recipe.recipeId).toBeUndefined();
    expect(recipe.target).toEqual({
      platform: adapter.platform,
      arch: adapter.arch,
      accelerator: 'cpu',
    });
    expect(result.stdout).toContain(`scrollcase build example-box/${targetId}`);
  });
});
