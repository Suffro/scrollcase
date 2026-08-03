import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  MAX_PAYLOAD_DIGEST_BYTES,
  PAYLOAD_DIGEST_FILE,
  PAYLOAD_DIGEST_FORMAT,
  parsePayloadDigestStream,
  payloadDigestStream,
} from '../../src/contract/payload-digest.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Derives a record's content digest the way every implementation must: bytes, or the link body. */
function entryDigest(entry) {
  return entry.kind === 'link'
    ? sha256(Buffer.from(entry.linkTarget, 'utf8'))
    : sha256(Buffer.from(entry.contentBase64, 'base64'));
}

const contract = JSON.parse(await readFile(
  new URL('../../src/contract/fixtures/payload-digest-contract.json', import.meta.url),
  'utf8',
));

describe('the payload digest contract fixture', () => {
  it('names the format this implementation emits', () => {
    expect(contract.format).toBe(PAYLOAD_DIGEST_FORMAT);
  });

  // The Python consumer builds its test archives from an in-memory entry list and never has a
  // payload directory, so without a shared vector the two implementations would only ever be proven
  // to agree with themselves.
  it.each(contract.cases)('reproduces the canonical stream for $name', (testCase) => {
    const entries = testCase.entries.map((entry) => ({
      path: entry.path,
      kind: entry.kind,
      contentSha256: entryDigest(entry),
    }));
    const stream = payloadDigestStream(entries);
    expect(Buffer.from(stream).toString('base64')).toBe(testCase.streamBase64);
    expect(sha256(Buffer.from(stream))).toBe(testCase.sha256);
  });

  it('round-trips every vector back to the entries it was built from', () => {
    for (const testCase of contract.cases) {
      const entries = testCase.entries.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        contentSha256: entryDigest(entry),
      }));
      const parsed = parsePayloadDigestStream(payloadDigestStream(entries));
      expect(parsed).toEqual([...entries].sort((left, right) => (
        Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'))
      )));
    }
  });
});

describe('what the canonical stream commits to', () => {
  const file = (path, contentSha256) => ({ path, kind: 'file', contentSha256 });
  const digestOf = (entries) => sha256(Buffer.from(payloadDigestStream(entries)));
  const a = sha256(Buffer.from('a'));
  const b = sha256(Buffer.from('b'));

  it('is stable whatever order the caller supplies', () => {
    // The build walks in archive order and a verifier walks the list; neither may decide the bytes.
    expect(digestOf([file('x', a), file('y', b)])).toBe(digestOf([file('y', b), file('x', a)]));
  });

  it('separates a link from a file whose bytes are its target', () => {
    const target = sha256(Buffer.from('python3.11'));
    expect(digestOf([{ path: 'p', kind: 'link', contentSha256: target }]))
      .not.toBe(digestOf([file('p', target)]));
  });

  it('notices a path moving, a byte changing, and an entry disappearing', () => {
    const base = [file('venv/bin/python', a), file('box.json', b)];
    expect(digestOf([file('venv/bin/python3', a), file('box.json', b)])).not.toBe(digestOf(base));
    expect(digestOf([file('venv/bin/python', b), file('box.json', b)])).not.toBe(digestOf(base));
    expect(digestOf([file('box.json', b)])).not.toBe(digestOf(base));
  });

  it('carries the format name inside the bytes it hashes', () => {
    const stream = Buffer.from(payloadDigestStream([])).toString('utf8');
    expect(stream).toBe(`${PAYLOAD_DIGEST_FORMAT}\n`);
  });

  it('cannot be fed an entry a payload could not hold', () => {
    expect(() => payloadDigestStream([{ path: 'x', kind: 'directory', contentSha256: a }]))
      .toThrow(/Unsupported payload entry kind/);
    expect(() => payloadDigestStream([{ path: 'x\0y', kind: 'file', contentSha256: a }]))
      .toThrow(/Unsupported payload entry path/);
    expect(() => payloadDigestStream([file('x', a), file('x', b)]))
      .toThrow(/Duplicate payload entry/);
    expect(() => payloadDigestStream([file('x', 'not-a-digest')]))
      .toThrow(/Invalid payload entry digest/);
    // Upper-case hex is a different string for the same value; one spelling keeps two
    // implementations from producing two digests for one tree.
    expect(() => payloadDigestStream([file('x', a.toUpperCase())]))
      .toThrow(/Invalid payload entry digest/);
  });
});

describe('reading a list back', () => {
  const encode = (text) => Buffer.from(text, 'utf8');
  const a = sha256(Buffer.from('a'));
  const b = sha256(Buffer.from('b'));

  it('accepts exactly what the serialiser emits, framing and all', () => {
    // A newline is legal in a filename, so the parser may not split on one.
    const entries = [
      { path: 'we\nird', kind: 'file', contentSha256: a },
      { path: 'plain', kind: 'link', contentSha256: b },
    ];
    expect(parsePayloadDigestStream(payloadDigestStream(entries))).toHaveLength(2);
  });

  it('refuses a stream that is not this format', () => {
    expect(() => parsePayloadDigestStream(encode('sha256-path-list-v2\n')))
      .toThrow(/expected format header/);
    expect(() => parsePayloadDigestStream(encode(''))).toThrow(/expected format header/);
  });

  it('refuses a truncated or malformed record', () => {
    const full = Buffer.from(payloadDigestStream([{ path: 'x', kind: 'file', contentSha256: a }]));
    expect(() => parsePayloadDigestStream(full.subarray(0, full.length - 1)))
      .toThrow(/ends inside a record|malformed record/);
    const noKind = Buffer.from(full);
    noKind[full.indexOf(0x00) + 1] = 0x7a;
    expect(() => parsePayloadDigestStream(noKind)).toThrow(/malformed record/);
    const noTerminator = Buffer.from(full);
    noTerminator[full.length - 1] = 0x20;
    expect(() => parsePayloadDigestStream(noTerminator)).toThrow(/malformed record/);
  });

  it('refuses a list that is not in canonical order', () => {
    // Accepting a re-ordered list would let two different streams describe one tree, and the signed
    // hash is over the stream.
    const ordered = Buffer.from(payloadDigestStream([
      { path: 'a', kind: 'file', contentSha256: a },
      { path: 'b', kind: 'file', contentSha256: b },
    ]));
    const header = `${PAYLOAD_DIGEST_FORMAT}\n`.length;
    const recordLength = (ordered.length - header) / 2;
    const swapped = Buffer.concat([
      ordered.subarray(0, header),
      ordered.subarray(header + recordLength),
      ordered.subarray(header, header + recordLength),
    ]);
    expect(() => parsePayloadDigestStream(swapped)).toThrow(/canonical order/);
  });

  it('refuses a list naming one path twice', () => {
    const one = Buffer.from(payloadDigestStream([{ path: 'x', kind: 'file', contentSha256: a }]));
    const header = `${PAYLOAD_DIGEST_FORMAT}\n`.length;
    const record = one.subarray(header);
    expect(() => parsePayloadDigestStream(Buffer.concat([one, record])))
      .toThrow(/canonical order|twice/);
  });
});

describe('the constants a mirror implementation needs', () => {
  it('fixes where the list lives and how far a reader will go', () => {
    expect(PAYLOAD_DIGEST_FILE).toBe('payload-digest.v1');
    expect(MAX_PAYLOAD_DIGEST_BYTES).toBe(256 * 1024 * 1024);
  });
});
