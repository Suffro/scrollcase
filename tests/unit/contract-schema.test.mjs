import { readFileSync, readdirSync } from 'node:fs';
// The schemas are 2020-12, so they need the matching Ajv build rather than the draft-07 default.
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
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
  'signed-document',
  'release-manifest',
  'channel-manifest',
  'revocations-manifest',
  'box-manifest',
  'recipe',
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
const validatorFor = (name) => ajv.getSchema(`https://scrollcase.dev/schema/${name}.schema.json`);

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
      expect(schema.$id, name).toBe(`https://scrollcase.dev/schema/${name}.schema.json`);
      expect(schema.title, name).toBeTruthy();
      expect(schema.description, name).toBeTruthy();
      expect(validatorFor(name), name).toBeTypeOf('function');
    }
  });
});

describe('schemas describe what the builder actually emits', () => {
  it('accepts a real release manifest, channel manifest, box manifest, and recipe', () => {
    expectValid('release-manifest', example('release-manifest'), 'release');
    expectValid('channel-manifest', example('channel-manifest'), 'channel');
    expectValid('box-manifest', example('box-manifest'), 'box.json');
    expectValid('recipe', example('recipe'), 'recipe');
  });

  it('accepts every recipe shipped as an example, on either substrate', () => {
    const directory = new URL('../../src/contract/fixtures/examples/', import.meta.url);
    const recipes = readdirSync(directory).filter((name) => name.startsWith('recipe'));
    expect(recipes.length).toBeGreaterThan(0);
    for (const name of recipes) expectValid('recipe', readJson(new URL(name, directory)), name);
  });

  it('accepts a real signed envelope and decodes the payload it wraps', () => {
    const signed = example('signed-release');
    expectValid('signed-document', signed, 'signed release');
    expect(isSignedBoxDocument(signed)).toBe(true);
    const payload = decodeDocumentPayload(signed);
    expect(payload.kind).toBe(documentKinds().release);
    expectValid('release-manifest', payload, 'decoded release payload');
  });
});

describe('the document namespace belongs to the publishing project', () => {
  it('defaults to scrollcase and names one kind per document type', () => {
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
      ['wrong version', { schemaVersion: 2 }],
      ['unsigned algorithm', { signatures: [{ algorithm: 'rsa', keyId: 'k', signatureBase64: 'x' }] }],
    ]) {
      const document = { ...signed, ...mutation };
      expect(isSignedBoxDocument(document), label).toBe(false);
      expect(validatorFor('signed-document')(document), label).toBe(false);
    }
  });
});
