import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertNativeHost,
  assertPythonEntryPoint,
  boxTargetAdapter,
  boxTargetAdapters,
  boxTargetId,
  condaSubdir,
  fixtureUrl,
  pixiAccelerator,
} from '../../src/contract/index.mjs';

const contract = JSON.parse(readFileSync(fixtureUrl('target-id-contract'), 'utf8'));

describe('target identity', () => {
  it('produces the exact identifier every golden case declares', () => {
    expect(contract.valid.length).toBeGreaterThan(0);
    for (const fixture of contract.valid) {
      expect(boxTargetId(fixture.target), fixture.name).toBe(fixture.targetId);
    }
  });

  it('rejects every unsupported target and invalid CUDA combination', () => {
    expect(contract.invalid.length).toBeGreaterThan(0);
    for (const fixture of contract.invalid) {
      expect(() => boxTargetId(fixture.target), fixture.name).toThrow();
    }
  });

  it('rejects a target that is not an object at all', () => {
    for (const value of [null, undefined, 'macos-aarch64-metal', 42]) {
      expect(() => boxTargetId(value)).toThrow(TypeError);
    }
  });
});

describe('target adapters', () => {
  it('covers every platform and architecture the identity rules accept', () => {
    const adapters = boxTargetAdapters();
    const covered = new Set(adapters.map((adapter) => `${adapter.platform}/${adapter.arch}`));
    for (const fixture of contract.valid) {
      expect(covered, fixture.name).toContain(`${fixture.target.platform}/${fixture.target.arch}`);
      expect(() => boxTargetAdapter(fixture.target)).not.toThrow();
    }
  });

  it('describes a payload layout consumers can rely on', () => {
    for (const adapter of boxTargetAdapters()) {
      expect(adapter.python.payloadRoot, adapter.id).toBe('venv');
      expect(adapter.python.entryPoint, adapter.id).toMatch(/^venv\//);
      expect(adapter.archive.format, adapter.id).toBe('zip');
      // The scripts directory must sit inside the payload root, or an installed box cannot find it.
      expect(adapter.python.scriptsDirectory, adapter.id).toMatch(/^venv/);
    }
  });

  it('maps each target to its conda platform subdirectory', () => {
    expect(condaSubdir({ platform: 'macos', arch: 'aarch64', accelerator: 'metal' })).toBe('osx-arm64');
    expect(condaSubdir({ platform: 'linux', arch: 'x86_64', accelerator: 'cpu' })).toBe('linux-64');
    expect(condaSubdir({ platform: 'windows', arch: 'x86_64', accelerator: 'cpu' })).toBe('win-64');
  });

  it('refuses a build on a host that is not the target it ships for', () => {
    const adapter = boxTargetAdapter({ platform: 'linux', arch: 'x86_64', accelerator: 'cpu' });
    expect(() => assertNativeHost(adapter, { platform: 'linux', arch: 'x64' })).not.toThrow();
    expect(() => assertNativeHost(adapter, { platform: 'darwin', arch: 'arm64' })).toThrow(/must be built natively/);
  });

  it('refuses a scroll entry point that disagrees with the adapter layout', () => {
    const adapter = boxTargetAdapter({ platform: 'windows', arch: 'x86_64', accelerator: 'cpu' });
    expect(() => assertPythonEntryPoint(adapter, 'venv/python.exe')).not.toThrow();
    expect(() => assertPythonEntryPoint(adapter, 'venv/bin/python')).toThrow(/entry point/);
  });
});

describe('accelerator selection', () => {
  it('refuses an accelerator the format does not define', () => {
    for (const accelerator of ['rocm', 'tpu', undefined, null]) {
      expect(() => pixiAccelerator({ target: { platform: 'linux', arch: 'x86_64', accelerator } }))
        .toThrow(/Unsupported box accelerator/);
    }
  });

  it('describes the conda accelerator a scroll selects and rejects a versionless CUDA target', () => {
    expect(pixiAccelerator({ target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' } }))
      .toEqual({ accelerator: 'metal', cudaVersion: null });
    expect(pixiAccelerator({ target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.9' } }))
      .toEqual({ accelerator: 'cuda', cudaVersion: '12.9' });
    expect(() => pixiAccelerator({ target: { platform: 'linux', arch: 'x86_64', accelerator: 'cuda' } }))
      .toThrow(/major.minor CUDA version/);
  });
});
