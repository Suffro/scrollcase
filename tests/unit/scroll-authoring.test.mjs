import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copyVerifiedLocalFile } from '../../src/build/assets.mjs';
import { createScroll } from '../../src/build/authoring.mjs';
import { fileExists, sha256File } from '../../src/build/filesystem.mjs';
import { initProject } from '../../src/build/project.mjs';
import { readScroll } from '../../src/build/scroll.mjs';
import { configureWorkspace, getWorkspace, resetWorkspace } from '../../src/build/workspace.mjs';
import { collectNewScrollOptions } from '../../src/cli-authoring.mjs';

const TARGET = { platform: 'macos', arch: 'aarch64', accelerator: 'metal' };
const BASE = {
  boxId: 'example-model',
  target: TARGET,
  modelId: 'example-org-example-model',
  runtimeId: 'example-model-runtime',
  version: '1.0.0',
  scrollVersion: '1.0.0',
  sourceRevision: 'upstream-v1',
  pythonVersion: '3.11.15',
  pixiVersion: '0.73.0',
  compatibility: { minHostAppVersion: '1.0.0' },
  assetBaseUrl: 'https://assets.example.org',
  weights: 'embed',
};

describe('scroll authoring', () => {
  const created = [];

  afterEach(async () => {
    resetWorkspace();
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function workspace() {
    const root = await mkdtemp(join(tmpdir(), 'scrollcase-authoring-'));
    created.push(root);
    await initProject({ root });
    configureWorkspace({ cwd: root });
    return getWorkspace();
  }

  it('creates a complete library-only scroll without execution metadata', async () => {
    const current = await workspace();
    const result = await createScroll({
      workspace: current,
      ...BASE,
      executionKind: 'library-only',
    });

    expect(result.scrollRef).toBe('example-model/macos-aarch64-metal');
    expect(result.scroll.execution).toBeUndefined();
    expect(result.scroll.localFiles).toBeUndefined();
    expect(await readScroll(result.scrollRef)).toMatchObject({
      scroll: { boxId: BASE.boxId, target: TARGET, pixiVersion: BASE.pixiVersion },
    });
    expect(await readFile(join(result.scrollDir, 'pixi.toml'), 'utf8'))
      .toContain('platforms = ["osx-arm64"]');
  });

  it('turns interactive wizard answers into a complete valid scroll', async () => {
    const current = await workspace();
    const answers = new Map([
      ['Box ID', BASE.boxId],
      ['Model ID', BASE.modelId],
      ['Runtime ID', BASE.runtimeId],
      ['Box version', BASE.version],
      ['Scroll version', BASE.scrollVersion],
      ['Upstream source revision', BASE.sourceRevision],
      ['Python version', BASE.pythonVersion],
      ['pixi version', BASE.pixiVersion],
      ['Minimum host application version', BASE.compatibility.minHostAppVersion],
      ['Asset base URL', BASE.assetBaseUrl],
      ['Python module', 'example_model.main'],
    ]);
    const options = await collectNewScrollOptions(new Map(), {
      terminal: true,
      ask: async (question, promptOptions = {}) =>
        answers.get(question) ?? (promptOptions.optional ? null : promptOptions.defaultValue),
      choose: async (question) => (question === 'weights mode' ? 'embed' : 'python-module'),
      chooseTargetValue: async () => ({
        target: TARGET,
        targetId: 'macos-aarch64-metal',
      }),
    });
    const result = await createScroll({ workspace: current, ...options });

    expect(result.scroll.execution).toEqual({
      kind: 'python-module',
      module: 'example_model.main',
      defaultArgs: [],
    });
    await expect(readScroll(result.scrollRef)).resolves.toBeTruthy();
  });

  it('records a Python module and its default arguments', async () => {
    const current = await workspace();
    const result = await createScroll({
      workspace: current,
      ...BASE,
      executionKind: 'python-module',
      module: 'example_model.main',
      defaultArgs: ['--port', '8080'],
    });

    expect(result.scroll.execution).toEqual({
      kind: 'python-module',
      module: 'example_model.main',
      defaultArgs: ['--port', '8080'],
    });
    await expect(readScroll(result.scrollRef)).resolves.toBeTruthy();
  });

  it('derives the Windows interpreter and conda platform from the target adapter', async () => {
    const current = await workspace();
    const target = {
      platform: 'windows',
      arch: 'x86_64',
      accelerator: 'cuda',
      cudaVersion: '12.8',
    };
    const result = await createScroll({
      workspace: current,
      ...BASE,
      target,
      executionKind: 'library-only',
    });

    expect(result.scroll.pythonEntryPoint).toBe('venv/python.exe');
    expect(await readFile(join(result.scrollDir, 'pixi.toml'), 'utf8'))
      .toContain('platforms = ["win-64"]');
    await expect(readScroll(result.scrollRef)).resolves.toBeTruthy();
  });

  it('hashes an existing project script and stages it at a safe payload path', async () => {
    const current = await workspace();
    const sourcePath = 'application.py';
    await writeFile(join(current.root, sourcePath), 'print("hello")\n');
    const result = await createScroll({
      workspace: current,
      ...BASE,
      executionKind: 'python-script',
      scriptSourcePath: sourcePath,
      scriptRelativePath: 'app/main.py',
    });

    expect(result.scroll.execution).toEqual({
      kind: 'python-script',
      script: 'app/main.py',
      defaultArgs: [],
    });
    expect(result.scroll.localFiles).toEqual([{
      sourcePath,
      relativePath: 'app/main.py',
      sha256: await sha256File(join(current.root, sourcePath)),
    }]);
    expect(result.scroll.selfTest.files).toContain('app/main.py');
    await expect(readScroll(result.scrollRef)).resolves.toBeTruthy();
  });

  it('generates a starter script whose declared hash matches its bytes', async () => {
    const current = await workspace();
    const result = await createScroll({
      workspace: current,
      ...BASE,
      executionKind: 'python-script',
      generateScript: true,
      scriptRelativePath: 'entrypoint.py',
    });

    expect(await fileExists(result.generatedScriptPath)).toBe(true);
    expect(result.scroll.localFiles[0].sha256).toBe(await sha256File(result.generatedScriptPath));
    expect(result.scroll.localFiles[0].sourcePath).toBe(
      'scrollcase-scripts/example-model-macos-aarch64-metal.py',
    );
  });

  it('never overwrites an existing scroll or generated script', async () => {
    const current = await workspace();
    const options = {
      workspace: current,
      ...BASE,
      executionKind: 'python-script',
      generateScript: true,
    };
    const first = await createScroll(options);
    const original = await readFile(join(first.scrollDir, 'scroll.json'), 'utf8');

    await expect(createScroll(options)).rejects.toThrow(/already exists/);
    expect(await readFile(join(first.scrollDir, 'scroll.json'), 'utf8')).toBe(original);
  });

  it('fails the existing local-file guard after a generated script is changed', async () => {
    const current = await workspace();
    const result = await createScroll({
      workspace: current,
      ...BASE,
      executionKind: 'python-script',
      generateScript: true,
    });
    await writeFile(result.generatedScriptPath, 'print("tampered")\n');

    await expect(copyVerifiedLocalFile(
      result.scroll.localFiles[0],
      join(current.root, '.scrollcase', 'payload'),
      current.root,
    )).rejects.toThrow(/SHA-256 mismatch/);
  });
});
