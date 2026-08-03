import { spawnSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyAndExtractBox } from '../../src/consumer/index.mjs';
import { createConsumerBoxFixture } from '../helpers/consumer-box-fixture.mjs';

const cli = fileURLToPath(new URL('../../src/cli.mjs', import.meta.url));
const created = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function installedFixture() {
  const fixture = await createConsumerBoxFixture();
  created.push(fixture.root);
  const root = join(fixture.root, 'installed');
  await verifyAndExtractBox(fixture.releasePath, {
    publicPath: fixture.publicPath,
    archive: fixture.archivePath,
    destination: root,
  });
  return { fixture, root };
}

function verifyExtracted(fixture, root, extra = []) {
  return spawnSync(process.execPath, [
    cli,
    'verify',
    fixture.releasePath,
    '--extracted', root,
    '--public-key', fixture.publicPath,
    '--project-root', fixture.root,
    ...extra,
  ], { encoding: 'utf8' });
}

describe('the verify CLI edge', () => {
  it('delegates extracted payload verification to the consumer', async () => {
    const { fixture, root } = await installedFixture();
    const result = verifyExtracted(fixture, root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      `Verified extracted payload consumer-fixture 2.0.0 (${fixture.release.target.platform}`,
    );
    expect(result.stdout).toContain('3 entries)');
  });

  it('reports a named payload mismatch through the normal CLI failure path', async () => {
    const { fixture, root } = await installedFixture();
    await writeFile(join(root, 'app', 'main.py'), 'tampered');

    const result = verifyExtracted(fixture, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'scrollcase: Payload does not match the signed release: app/main.py.',
    );
  });

  it.each(['--archive', '--self-test'])(
    'refuses --extracted combined with %s',
    async (conflict) => {
      const { fixture, root } = await installedFixture();
      const extra = conflict === '--archive' ? [conflict, fixture.archivePath] : [conflict];
      const result = verifyExtracted(fixture, root, extra);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'scrollcase: --extracted cannot be combined with --archive or --self-test.',
      );
    },
  );

  it('requires a directory value for --extracted', () => {
    const result = spawnSync(process.execPath, [
      cli,
      'verify',
      'release.json',
      '--extracted',
    ], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('scrollcase: --extracted requires a directory path.');
  });
});
