import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
// The schemas are 2020-12, so they need the matching Ajv build rather than the draft-07 default.
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  BOX_SCHEMA_VERSION,
  CHANNELS,
  DEFAULT_DOCUMENT_NAMESPACE,
  decodeDocumentPayload,
  documentKinds,
  isSignedBoxDocument,
  parseDocumentKind,
  boxTargetId,
  schemaUrl,
} from '../../src/contract/index.mjs';

const SCHEMA_NAMES = [
  'target',
  'execution',
  'signed-document',
  'release-manifest',
  'channel-manifest',
  'revocations-manifest',
  'box-manifest',
  'scroll',
];

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const example = (name) => readJson(new URL(`../../src/contract/fixtures/examples/${name}.example.json`, import.meta.url));

/** One validator holding every schema, so cross-schema $refs resolve the way a consumer's would. */
function createValidator() {
  // strictRequired is an Ajv lint, not a spec rule: it objects to `required` inside an if/then or
  // oneOf branch, which is exactly how the conditional target and substrate rules are expressed.
  const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  for (const name of SCHEMA_NAMES) ajv.addSchema(readJson(schemaUrl(name)));
  return ajv;
}

const ajv = createValidator();
const validatorFor = (name) => ajv.getSchema(`https://scrollcase.dev/schema/v2/${name}.schema.json`);

/** Reports why a document failed, instead of a bare boolean, when a schema and reality disagree. */
function expectValid(name, document, label) {
  const validate = validatorFor(name);
  const valid = validate(document);
  expect(valid ? [] : validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`), label).toEqual([]);
}

describe('published schemas', () => {
  it('ships one well-formed schema per document the format defines', () => {
    for (const name of SCHEMA_NAMES) {
      const schema = readJson(schemaUrl(name));
      expect(schema.$id, name).toBe(`https://scrollcase.dev/schema/v2/${name}.schema.json`);
      expect(schema.title, name).toBeTruthy();
      expect(schema.description, name).toBeTruthy();
      expect(validatorFor(name), name).toBeTypeOf('function');
      if (!['target', 'execution'].includes(name)) {
        expect(schema.properties.schemaVersion.const, name).toBe(BOX_SCHEMA_VERSION);
      }
    }
  });
});

describe('schemas describe what the builder actually emits', () => {
  it('accepts a real release manifest, channel manifest, box manifest, and scroll', () => {
    expectValid('release-manifest', example('release-manifest'), 'release');
    expectValid('channel-manifest', example('channel-manifest'), 'channel');
    expectValid('box-manifest', example('box-manifest'), 'box.json');
    expectValid('scroll', example('scroll'), 'scroll');
  });

  it('uses the same closed channel vocabulary in code and schema', () => {
    const channel = example('channel-manifest');
    for (const name of CHANNELS) expectValid('channel-manifest', { ...channel, channel: name }, name);
    for (const name of ['development', 'internal', '']) {
      expect(validatorFor('channel-manifest')({ ...channel, channel: name }), name).toBe(false);
    }
  });

  it('accepts every scroll shipped as an example, on either substrate', () => {
    const directory = new URL('../../src/contract/fixtures/examples/', import.meta.url);
    const scrolls = readdirSync(directory).filter((name) => name.startsWith('scroll'));
    expect(scrolls.length).toBeGreaterThan(0);
    for (const name of scrolls) expectValid('scroll', readJson(new URL(name, directory)), name);
  });

  it('accepts a scroll whose provenance identity will be derived from boxId and target', () => {
    const { scrollId: _scrollId, ...scroll } = example('scroll');
    expectValid('scroll', scroll, 'scroll without scrollId');
  });

  it('accepts exactly one authored execution shape, or none for a library-only box', () => {
    const scroll = example('scroll');
    expectValid('scroll', {
      ...scroll,
      execution: { kind: 'python-script', script: 'app/main.py', defaultArgs: [] },
    }, 'python script');
    expectValid('scroll', {
      ...scroll,
      execution: { kind: 'python-module', module: 'example_model.main', defaultArgs: ['--serve'] },
    }, 'python module');
    expectValid('scroll', scroll, 'library only');
    expect(validatorFor('scroll')({
      ...scroll,
      execution: {
        kind: 'python-script',
        script: 'app/main.py',
        module: 'example_model.main',
        defaultArgs: [],
      },
    })).toBe(false);
    expect(validatorFor('scroll')({
      ...scroll,
      execution: { kind: 'python-module', module: 'not-valid-module!', defaultArgs: [] },
    })).toBe(false);
    expect(validatorFor('scroll')({
      ...scroll,
      execution: { kind: 'python-script', defaultArgs: [] },
    })).toBe(false);
    expect(validatorFor('scroll')({
      ...scroll,
      execution: { kind: 'python-module', module: 'example_model.main', defaultArgs: [42] },
    })).toBe(false);
  });

  it('carries the same optional execution contract in release and box manifests', () => {
    const execution = {
      kind: 'python-module',
      module: 'example_model.main',
      defaultArgs: ['--serve'],
    };
    expectValid('release-manifest', {
      ...example('release-manifest'),
      execution,
    }, 'executable release');
    expectValid('box-manifest', {
      ...example('box-manifest'),
      execution,
    }, 'executable box');
  });

  it('publishes editor metadata and one canonical execution union', () => {
    const scroll = readJson(schemaUrl('scroll'));
    const target = readJson(schemaUrl('target'));
    const execution = readJson(schemaUrl('execution'));

    expect(scroll.properties.$schema.const).toBe(scroll.$id);
    expect(scroll.properties.weights.default).toBe('embed');
    expect(scroll.properties.weights.description).toBeTruthy();
    expect(scroll.properties.execution.$ref).toBe(execution.$id);
    expect(execution.oneOf).toHaveLength(2);
    expect(execution.examples).toHaveLength(2);
    expect(execution.oneOf.every((branch) => branch.additionalProperties === false)).toBe(true);
    for (const field of ['platform', 'arch', 'accelerator']) {
      expect(target.properties[field].description, field).toBeTruthy();
      expect(target.properties[field].examples, field).toBeTruthy();
    }
  });

  it('accepts a real signed envelope and decodes the payload it wraps', () => {
    const signed = example('signed-release');
    expectValid('signed-document', signed, 'signed release');
    expect(isSignedBoxDocument(signed)).toBe(true);
    const payload = decodeDocumentPayload(signed);
    expect(payload.kind).toBe(documentKinds().release);
    expectValid('release-manifest', payload, 'decoded release payload');
  });

  it('ships a signed example whose ed25519 signature matches its public key', () => {
    const signed = example('signed-release');
    const publicKey = readJson(new URL(
      '../../src/contract/fixtures/examples/signed-release.public-key.json',
      import.meta.url,
    ));
    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(publicKey.publicKeyBase64, 'base64'),
    ]);
    const signature = signed.signatures.find(({ keyId }) => keyId === publicKey.keyId);
    expect(verifySignature(
      null,
      Buffer.from(signed.payloadBase64, 'base64'),
      createPublicKey({ key: spki, format: 'der', type: 'spki' }),
      Buffer.from(signature.signatureBase64, 'base64'),
    )).toBe(true);
  });
});

describe('the document namespace belongs to the publishing project', () => {
  it('defaults to Scrollcase and names one kind per document type', () => {
    expect(documentKinds()).toEqual({
      release: `${DEFAULT_DOCUMENT_NAMESPACE}.release`,
      channel: `${DEFAULT_DOCUMENT_NAMESPACE}.channel`,
      revocations: `${DEFAULT_DOCUMENT_NAMESPACE}.revocations`,
    });
  });

  it('lets a project keep the namespace its published boxes already carry', () => {
    // A project with clients in the field cannot have the tool rename its documents underneath it.
    const kinds = documentKinds('acme.model-pack');
    expect(kinds.release).toBe('acme.model-pack.release');
    for (const [type, kind] of Object.entries(kinds)) {
      expect(parseDocumentKind(kind), type).toEqual({ namespace: 'acme.model-pack', type });
    }
  });

  it('accepts any namespaced kind in the schemas, and nothing else', () => {
    const release = example('release-manifest');
    for (const kind of ['acme.model-pack.release', 'scrollcase.box.release', 'x.release']) {
      expectValid('release-manifest', { ...release, kind }, kind);
    }
    for (const kind of ['release', 'acme.model-pack.channel', 'Acme.Release', '']) {
      expect(validatorFor('release-manifest')({ ...release, kind }), kind).toBe(false);
    }
  });

  it('rejects a malformed namespace instead of emitting an unusable kind', () => {
    for (const namespace of ['', 'Acme', 'acme..box', '.acme', 42, null]) {
      expect(() => documentKinds(namespace), String(namespace)).toThrow(TypeError);
    }
    expect(parseDocumentKind('acme.model-pack.unknown')).toBeNull();
    expect(parseDocumentKind('release')).toBeNull();
  });
});

describe('the schemas and the reference implementation agree', () => {
  const contract = readJson(new URL('../../src/contract/fixtures/target-id-contract.json', import.meta.url));

  it('accepts exactly the targets the reference implementation accepts', () => {
    for (const fixture of contract.valid) {
      expectValid('target', fixture.target, fixture.name);
      expect(boxTargetId(fixture.target), fixture.name).toBe(fixture.targetId);
    }
    for (const fixture of contract.invalid) {
      const validate = validatorFor('target');
      expect(validate(fixture.target), fixture.name).toBe(false);
      expect(() => boxTargetId(fixture.target), fixture.name).toThrow();
    }
  });
});

describe('the envelope refuses what it cannot verify', () => {
  it('rejects a document whose payload hash does not match its bytes', () => {
    const tampered = { ...example('signed-release'), payloadSha256: 'a'.repeat(64) };
    expect(isSignedBoxDocument(tampered)).toBe(true);
    expect(() => decodeDocumentPayload(tampered)).toThrow(/payload hash does not match/);
  });

  it('rejects envelopes missing a signature, an encoding, or the right version', () => {
    const signed = example('signed-release');
    for (const [label, mutation] of [
      ['no signatures', { signatures: [] }],
      ['wrong encoding', { payloadEncoding: 'json' }],
      ['wrong version', { schemaVersion: 1 }],
      ['unsigned algorithm', { signatures: [{ algorithm: 'rsa', keyId: 'k', signatureBase64: 'x' }] }],
    ]) {
      const document = { ...signed, ...mutation };
      expect(isSignedBoxDocument(document), label).toBe(false);
      expect(validatorFor('signed-document')(document), label).toBe(false);
    }
  });
});
