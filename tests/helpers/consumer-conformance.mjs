import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { collectFiles, sha256File } from '../../src/build/filesystem.mjs';
import { boxTargetAdapter, boxTargetId } from '../../src/contract/targets.mjs';
import {
  runBox,
  runExtractedBox,
  verifyAndExtractBox,
} from '../../src/consumer/index.mjs';
import {
  createConsumerBoxFixture,
  nativeTarget,
  writeSignedRelease,
} from './consumer-box-fixture.mjs';

const ASSET_BYTES = Buffer.from('trusted on-demand bytes');
const TARGETS = {
  'macos-aarch64-cpu': { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' },
  'linux-x86_64-cpu': { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
  'windows-x86_64-cpu': { platform: 'windows', arch: 'x86_64', accelerator: 'cpu' },
};

export async function loadConsumerConformanceSuite() {
  return JSON.parse(await readFile(
    new URL('../../src/contract/fixtures/consumer-conformance.json', import.meta.url),
    'utf8',
  ));
}

function fakeSpawn(runtime = {}) {
  const calls = [];
  const children = [];
  const spawn = (command, args, options) => {
    if (runtime.spawnError) {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('error', new Error('fixture spawn failed')));
      calls.push({ command, args, options });
      children.push(child);
      return child;
    }
    const child = new EventEmitter();
    child.kill = (signal) => {
      child.forwardedSignal = signal;
      queueMicrotask(() => child.emit('close', null, signal));
      return true;
    };
    calls.push({ command, args, options });
    children.push(child);
    if (!runtime.signal) {
      queueMicrotask(() => child.emit('close', runtime.exitCode ?? 0, null));
    }
    return child;
  };
  return { spawn, calls, children };
}

async function writeZip(path, payload, extra = null) {
  const zip = new yazl.ZipFile();
  const output = pipeline(zip.outputStream, createWriteStream(path));
  for (const file of await collectFiles(payload)) {
    zip.addFile(join(payload, ...file.split('/')), file);
  }
  if (extra) zip.addBuffer(Buffer.from(extra.contents ?? 'hostile'), extra.path, extra.options);
  zip.end();
  await output;
}

async function refreshArchiveIdentity(fixture) {
  const metadata = await stat(fixture.archivePath);
  fixture.release.archive.sha256 = await sha256File(fixture.archivePath);
  fixture.release.archive.sizeBytes = metadata.size;
  await writeSignedRelease(fixture, fixture.release);
}

async function replaceZipEntryName(path, from, to) {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) {
    throw new Error('Conformance ZIP path replacements must preserve byte length.');
  }
  const bytes = await readFile(path);
  const source = Buffer.from(from);
  const replacement = Buffer.from(to);
  let count = 0;
  for (let offset = bytes.indexOf(source); offset !== -1; offset = bytes.indexOf(source, offset + source.length)) {
    replacement.copy(bytes, offset);
    count += 1;
  }
  if (count !== 2) throw new Error(`Expected two ZIP path records for ${from}, found ${count}.`);
  await writeFile(path, bytes);
}

async function mutateFixture(fixture, mutation, destination) {
  if (!mutation) return;
  if (mutation === 'alter-signature' || mutation === 'alter-payload') {
    const signed = JSON.parse(await readFile(fixture.releasePath, 'utf8'));
    if (mutation === 'alter-signature') signed.signatures[0].signatureBase64 = 'AA==';
    else signed.payloadBase64 = Buffer.from('altered payload').toString('base64');
    await writeFile(fixture.releasePath, `${JSON.stringify(signed, null, 2)}\n`);
    return;
  }
  if (mutation === 'alter-archive-bytes') {
    const bytes = await readFile(fixture.archivePath);
    bytes[bytes.length - 1] ^= 0x01;
    await writeFile(fixture.archivePath, bytes);
    return;
  }
  if (mutation === 'alter-archive-size') {
    fixture.release.archive.sizeBytes += 1;
    await writeSignedRelease(fixture, fixture.release);
    return;
  }
  if (mutation === 'alter-release-model') {
    fixture.release.modelId = 'altered-model';
    await writeSignedRelease(fixture, fixture.release);
    return;
  }
  if (mutation === 'alter-release-execution') {
    fixture.release.execution = {
      ...fixture.release.execution,
      defaultArgs: ['--altered'],
    };
    await writeSignedRelease(fixture, fixture.release);
    return;
  }
  if (mutation === 'create-destination') {
    await mkdir(destination);
    return;
  }
  const removePath = {
    'remove-interpreter': fixture.release.pythonEntryPoint,
    'remove-script': fixture.release.execution?.script,
    'remove-module': fixture.release.execution?.module?.split('.').join('/') + '.py',
  }[mutation];
  if (removePath) {
    await rm(join(fixture.payload, ...removePath.split('/')));
    await writeZip(fixture.archivePath, fixture.payload);
    await refreshArchiveIdentity(fixture);
    return;
  }
  const hostile = {
    'add-traversal-entry': { path: 'safe', replacement: '../x' },
    'add-absolute-entry': { path: 'safe', replacement: '/abs' },
    // A link whose target climbs out of the payload: the escape the rule exists to stop.
    'add-link-entry': { path: 'link', contents: '../../../../etc/passwd', options: { mode: 0o120777 } },
    'add-special-entry': { path: 'fifo', options: { mode: 0o010644 } },
    'duplicate-entry': { path: 'box.json', contents: '{}' },
    'file-directory-collision': { path: 'venv', contents: 'collision' },
  }[mutation];
  if (hostile) {
    await writeZip(fixture.archivePath, fixture.payload, hostile);
    if (hostile.replacement) {
      await replaceZipEntryName(fixture.archivePath, hostile.path, hostile.replacement);
    }
    await refreshArchiveIdentity(fixture);
    return;
  }
  if (mutation === 'encrypt-entry') {
    await writeZip(fixture.archivePath, fixture.payload);
    const bytes = await readFile(fixture.archivePath);
    const local = bytes.indexOf(Buffer.from('PK\x03\x04'));
    const central = bytes.indexOf(Buffer.from('PK\x01\x02'));
    if (local < 0 || central < 0) throw new Error('Conformance ZIP lacks required headers.');
    bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) | 0x1, local + 6);
    bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 0x1, central + 8);
    await writeFile(fixture.archivePath, bytes);
    await refreshArchiveIdentity(fixture);
    return;
  }
  throw new Error(`Unknown conformance mutation: ${mutation}`);
}

function fixtureOptions(spec = {}) {
  const target = spec.target ? TARGETS[spec.target] : nativeTarget();
  const execution = spec.execution === 'module'
    ? { kind: 'python-module', module: 'example.application', defaultArgs: ['--default'] }
    : undefined;
  const requiredAsset = spec.requiredAsset ? {
    url: 'https://assets.example.org/weights.bin',
    relativePath: 'model-cache/consumer-fixture/weights.bin',
    sizeBytes: ASSET_BYTES.length,
    sha256: createHash('sha256').update(ASSET_BYTES).digest('hex'),
  } : null;
  return {
    target,
    signer: spec.signer ?? 'local',
    ...(execution ? { execution } : {}),
    requiredAsset,
  };
}

function replaceTokens(value, root = null) {
  if (typeof value === 'string') {
    const adapter = boxTargetAdapter(nativeTarget());
    return value
      .replaceAll('$NATIVE_PYTHON', adapter.python.entryPoint)
      .replaceAll('$NATIVE_TARGET', boxTargetId(nativeTarget()))
      .replaceAll('$BOX', root ?? '$BOX');
  }
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, root));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, root)]));
  }
  return value;
}

function classifyError(message, patterns) {
  for (const [code, pattern] of Object.entries(patterns)) {
    if (new RegExp(pattern, 'i').test(message)) return code;
  }
  return `unclassified: ${message}`;
}

function normalizePath(root, value) {
  if (!isAbsolute(value) || (value !== root && !value.startsWith(`${root}${sep}`))) return value;
  const suffix = relative(root, value).split(sep).join('/');
  return suffix ? `$BOX/${suffix}` : '$BOX';
}

async function materializeAsset(prepared, state) {
  if (!state || state === 'missing') return;
  const asset = prepared.requiredAssets[0];
  const path = join(prepared.root, ...asset.relativePath.split('/'));
  await mkdir(dirname(path), { recursive: true });
  if (state === 'wrong-size') await writeFile(path, ASSET_BYTES.subarray(1));
  else if (state === 'wrong-hash') await writeFile(path, Buffer.alloc(ASSET_BYTES.length, 0x78));
  else await writeFile(path, ASSET_BYTES);
}

export async function runNodeConformanceCase(testCase) {
  const fixture = await createConsumerBoxFixture(fixtureOptions(testCase.fixture));
  const destination = join(fixture.root, 'prepared');
  const temporaryDirectory = join(fixture.root, 'temporary');
  const expected = replaceTokens(testCase.expected);
  let prepared;
  let fake;
  let streams;
  try {
    await mutateFixture(fixture, testCase.mutation, destination);
    if (testCase.action === 'prepare') {
      prepared = await verifyAndExtractBox(fixture.releasePath, {
        publicPath: fixture.publicPath,
        archive: fixture.archivePath,
        destination,
      });
      return {
        actual: {
          outcome: 'prepared',
          receipt: {
            status: prepared.status,
            boxId: prepared.boxId,
            executionKind: prepared.execution?.kind ?? null,
            requiredAssetCount: prepared.requiredAssets.length,
            pythonEntryPoint: prepared.pythonEntryPoint,
            targetId: prepared.targetId,
          },
        },
        expected,
        root: fixture.root,
      };
    }

    fake = fakeSpawn(testCase.runtime);
    const runtime = testCase.runtime ?? {};
    const signalSource = runtime.signal ? new EventEmitter() : undefined;
    if (runtime.streams) {
      streams = {
        stdin: new EventEmitter(),
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
      };
    }
    let result;
    if (testCase.action === 'run-prepared') {
      prepared = await verifyAndExtractBox(fixture.releasePath, {
        publicPath: fixture.publicPath,
        archive: fixture.archivePath,
        destination,
      });
      await materializeAsset(prepared, runtime.assetState);
      const running = runExtractedBox(prepared, {
        args: runtime.args ?? [],
        spawn: fake.spawn,
        signalSource,
        ...streams,
      });
      if (runtime.signal) {
        while (fake.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
        signalSource.emit(runtime.signal);
      }
      result = await running;
    } else {
      await mkdir(temporaryDirectory);
      const running = runBox(fixture.releasePath, {
        publicPath: fixture.publicPath,
        archive: fixture.archivePath,
        temporaryDirectory,
        args: runtime.args ?? [],
        spawn: fake.spawn,
        signalSource,
        ...streams,
      });
      if (runtime.signal) {
        while (fake.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
        signalSource.emit(runtime.signal);
      }
      result = await running;
    }
    const actual = {
      outcome: 'completed',
      result,
    };
    if ('persistentRootExists' in expected) actual.persistentRootExists = await pathExists(prepared.root);
    if ('spawned' in expected) actual.spawned = fake.calls.length > 0;
    if ('temporaryDirectoryEmpty' in expected) {
      actual.temporaryDirectoryEmpty = (await readdir(temporaryDirectory)).length === 0;
    }
    if ('forwardedSignal' in expected) actual.forwardedSignal = fake.children[0].forwardedSignal;
    if ('streamsPreserved' in expected) {
      const options = fake.calls[0].options;
      actual.streamsPreserved = options.stdio[0] === streams.stdin
        && options.stdio[1] === streams.stdout
        && options.stdio[2] === streams.stderr;
    }
    if ('argv' in expected) {
      const call = fake.calls[0];
      actual.argv = [call.command, ...call.args].map((value) => normalizePath(prepared.root, value));
      actual.cwd = normalizePath(prepared.root, call.options.cwd);
      actual.shell = call.options.shell;
    }
    return { actual, expected, root: fixture.root };
  } catch (error) {
    const actual = {
      outcome: 'rejected',
      error: classifyError(error instanceof Error ? error.message : String(error), testCase.suite.errorPatterns),
    };
    if ('destinationExists' in expected) actual.destinationExists = await pathExists(destination);
    if ('spawned' in expected) actual.spawned = (fake?.calls.length ?? 0) > 0;
    if ('temporaryDirectoryEmpty' in expected) {
      actual.temporaryDirectoryEmpty = await pathExists(temporaryDirectory)
        && (await readdir(temporaryDirectory)).length === 0;
    }
    return { actual, expected, root: fixture.root };
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
