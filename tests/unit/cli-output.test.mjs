import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDistributionSummary, statusLine } from '../../src/cli-output.mjs';

describe('CLI output presentation', () => {
  it('keeps symbols but omits ANSI escapes outside a terminal', () => {
    expect(statusLine('success', 'Build complete', {
      stream: { isTTY: false },
      env: {},
    })).toBe('✓ Build complete');
  });

  it('colours only the symbol in an interactive terminal', () => {
    expect(statusLine('step', 'Running self-test', {
      stream: { isTTY: true },
      env: {},
    })).toBe('\x1b[36m→\x1b[0m Running self-test');
  });

  it('honours NO_COLOR even when it is empty', () => {
    expect(statusLine('warning', 'Check this', {
      stream: { isTTY: true },
      env: { NO_COLOR: '' },
    })).toBe('⚠ Check this');
  });

  it('summarises distribution with relative paths and without content hashes', () => {
    const distDir = join(process.cwd(), '.scrollcase', 'dist');
    expect(buildDistributionSummary({
      archivePath: join(distDir, 'boxes', 'demo', '1.2.3', 'macos-aarch64-metal', 'abc123.zip'),
      channelPath: join(distDir, 'channels', 'demo', 'beta', 'macos-aarch64-metal.json'),
    }, distDir)).toBe(
      'Build complete — distribute the 2 files under boxes/demo/1.2.3/macos-aarch64-metal/ '
      + 'and channels/demo/beta/macos-aarch64-metal.json',
    );
  });
});
