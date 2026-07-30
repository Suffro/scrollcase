import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditScroll } from '../../src/build/audit.mjs';
import { createScroll } from '../../src/build/authoring.mjs';
import { diagnose, initProject } from '../../src/build/project.mjs';
import { fileExists } from '../../src/build/filesystem.mjs';
import { configureWorkspace, getWorkspace, resetWorkspace } from '../../src/build/workspace.mjs';

const TARGET = { platform: 'macos', arch: 'aarch64', accelerator: 'metal' };

/** A pixi.lock with two packages, enough to exercise the licence inventory. */
const LOCK = `version: 6
packages:
- conda: https://conda.anaconda.org/conda-forge/osx-arm64/python-3.11.15-h0c9c016_1.conda
  sha256: aaa
  md5: bbb
  license: Python-2.0
  size: 1
- conda: https://conda.anaconda.org/conda-forge/osx-arm64/openssl-3.6.3-hd24854e_0.conda
  sha256: ccc
  md5: ddd
  license: Apache-2.0
  size: 1
`;

describe('setting a project up', () => {
  const created = [];

  afterEach(async () => {
    resetWorkspace();
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function emptyProject() {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-project-')));
    created.push(root);
    return root;
  }

  it('scaffolds the workspace and a concise linked project guide', async () => {
    const root = await emptyProject();
    const result = await initProject({ root });
    expect(result.written.length).toBeGreaterThan(0);
    expect(result.skipped).toEqual([]);

    const config = JSON.parse(await readFile(join(root, 'scrollcase.config.json'), 'utf8'));
    expect(config.version).toBe(1);
    expect(await fileExists(join(root, 'scrolls'))).toBe(true);
    expect(await fileExists(join(root, 'scrolls', 'example-box'))).toBe(false);
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toContain('.scrollcase/');
    expect(await readFile(join(root, '.gitignore'), 'utf8')).toContain('.venv/');
    const guide = await readFile(join(root, 'SCROLLCASE.md'), 'utf8');
    const lines = guide.trim().split('\n');
    expect(lines.length).toBeLessThan(40);
    expect(lines[0]).toBe('[Scrollcase documentation](https://scrollcase.dev/)');
    expect(lines.at(-1)).toBe('[Scrollcase documentation](https://scrollcase.dev/)');
    expect(guide.match(/https:\/\/scrollcase\.dev\//g)).toHaveLength(8);
    expect(guide).toContain('https://scrollcase.dev/reference/scroll');
    expect(guide).toContain('https://scrollcase.dev/reference/box-format');
    expect(guide).toContain('https://scrollcase.dev/reference/box-format#targets');
    expect(guide).toContain('https://scrollcase.dev/reference/api');
    expect(guide).toContain('npm does not install the Python consumer');
    expect(guide).toContain('python -m pip install scrollcase-consumer');
    expect(guide).toContain('consumer-templates/run_box.py');
    expect(guide).not.toContain('.scrollcase/python-consumer');
  });

  it('never overwrites what is already there, so it is safe to re-run', async () => {
    const root = await emptyProject();
    await writeFile(join(root, '.gitignore'), 'node_modules/\n');
    const first = await initProject({ root });
    await writeFile(join(root, 'SCROLLCASE.md'), '# Customized guide\n');
    const second = await initProject({ root });
    expect(second.written).toEqual([]);
    expect(second.skipped.length).toBe(first.written.length);
    // An existing .gitignore is appended to, not replaced.
    const gitignore = await readFile(join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('.scrollcase/');
    expect(gitignore).toContain('.venv/');
    expect(await readFile(join(root, 'SCROLLCASE.md'), 'utf8')).toBe('# Customized guide\n');
  });

});

describe('diagnosing a machine', () => {
  const created = [];

  afterEach(async () => {
    resetWorkspace();
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  const toolchain = (available) => (command, args = []) => {
    if (command === 'git') return available.git ? { status: 0, stdout: 'a'.repeat(40) } : { status: 128, stdout: '' };
    if (command === 'pixi') return available.pixi ? { status: 0, stdout: `pixi ${available.pixi}\n` } : { status: 127, error: new Error('ENOENT') };
    return available.condaPack ? { status: 0, stdout: '' } : { status: 127, error: new Error('ENOENT') };
  };

  it('passes when the scrolls directory, git and both tools are present', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-doctor-')));
    created.push(root);
    await mkdir(join(root, 'scrolls'), { recursive: true });
    configureWorkspace({ cwd: root });
    const { checks, ok } = await diagnose({
      workspace: getWorkspace(),
      pixiVersion: '0.73.0',
      runResult: toolchain({ git: true, pixi: '0.73.0', condaPack: true }),
    });
    expect(ok).toBe(true);
    expect(checks.map((check) => check.name)).toEqual(['workspace', 'scrolls', 'git', 'pixi', 'conda-pack']);
  });

  it('reports every problem at once, each with what to do about it', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-doctor-')));
    created.push(root);
    configureWorkspace({ cwd: root });
    const { checks, ok } = await diagnose({
      workspace: getWorkspace(),
      pixiVersion: '0.73.0',
      runResult: toolchain({ git: false, pixi: null, condaPack: false }),
    });
    expect(ok).toBe(false);
    const failed = checks.filter((check) => !check.ok);
    // One run must surface all of them: a user with nothing installed should not learn one per attempt.
    expect(failed.map((check) => check.name)).toEqual(['scrolls', 'git', 'pixi', 'conda-pack']);
    expect(failed.every((check) => check.remedy)).toBe(true);
  });

  it('reports the wrong pixi version as a failure, not as absence', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-doctor-')));
    created.push(root);
    await mkdir(join(root, 'scrolls'), { recursive: true });
    configureWorkspace({ cwd: root });
    const { checks } = await diagnose({
      workspace: getWorkspace(),
      pixiVersion: '0.73.0',
      runResult: toolchain({ git: true, pixi: '0.60.0', condaPack: true }),
    });
    const pixi = checks.find((check) => check.name === 'pixi');
    expect(pixi.ok).toBe(false);
    expect(pixi.detail).toMatch(/requires pixi 0\.73\.0, found 0\.60\.0/);
  });

  it('never writes anything', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-doctor-')));
    created.push(root);
    configureWorkspace({ cwd: root });
    await diagnose({ workspace: getWorkspace(), runResult: toolchain({ git: true, condaPack: true }) });
    expect(await fileExists(join(root, 'scrollcase.config.json'))).toBe(false);
    expect(await fileExists(join(root, 'scrolls'))).toBe(false);
  });
});

describe('auditing dependency licences', () => {
  const created = [];

  afterEach(async () => {
    resetWorkspace();
    await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function projectWithLock({ auditPath = 'legal/audit.json' } = {}) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'scrollcase-audit-')));
    created.push(root);
    await initProject({ root });
    configureWorkspace({ cwd: root });
    const result = await createScroll({
      workspace: getWorkspace(),
      boxId: 'example-model',
      target: TARGET,
      modelId: 'example-org-example-model',
      runtimeId: 'example-runtime',
      version: '1.0.0',
      scrollVersion: '1.0.0',
      sourceRevision: 'upstream-v1',
      pythonVersion: '3.11.15',
      pixiVersion: '0.73.0',
      compatibility: { minHostAppVersion: '1.0.0' },
      assetBaseUrl: 'https://assets.example.org',
      weights: 'embed',
      executionKind: 'library-only',
    });
    const scroll = JSON.parse(await readFile(join(result.scrollDir, 'scroll.json'), 'utf8'));
    if (auditPath) scroll.condaDependencyLicenseAudit = auditPath;
    await writeFile(join(result.scrollDir, 'scroll.json'), `${JSON.stringify(scroll, null, 2)}\n`);
    await writeFile(join(result.scrollDir, 'pixi.lock'), LOCK);
    return { root, scrollRef: result.scrollRef };
  }

  it('summarises the inventory straight from the lock, with no build', async () => {
    const { scrollRef } = await projectWithLock({ auditPath: null });
    const { summary, inventory, reviewed } = await auditScroll(scrollRef);
    expect(summary.packageCount).toBe(2);
    expect(summary.licenses).toEqual([
      { license: 'Apache-2.0', count: 1 },
      { license: 'Python-2.0', count: 1 },
    ]);
    expect(inventory.targetId).toBe('macos-aarch64-metal');
    expect(reviewed).toBeNull();
  });

  it('writes the reviewed audit only when asked, then matches it', async () => {
    const { root, scrollRef } = await projectWithLock();
    await expect(auditScroll(scrollRef)).rejects.toThrow(/Reviewed licence audit is missing/);
    const written = await auditScroll(scrollRef, { write: true });
    expect(written.written).toBe(true);
    expect(await fileExists(join(root, 'legal/audit.json'))).toBe(true);
    const checked = await auditScroll(scrollRef);
    expect(checked.written).toBe(false);
  });

  it('fails when the lock no longer matches what was reviewed', async () => {
    const { root, scrollRef } = await projectWithLock();
    await auditScroll(scrollRef, { write: true });
    const stale = JSON.parse(await readFile(join(root, 'legal/audit.json'), 'utf8'));
    stale.packages.pop();
    await writeFile(join(root, 'legal/audit.json'), `${JSON.stringify(stale, null, 2)}\n`);
    await expect(auditScroll(scrollRef)).rejects.toThrow(/differ from the reviewed audit/);
  });
});
