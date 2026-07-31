import { describe, expect, it } from 'vitest';
import {
  MAX_PAYLOAD_LINK_DEPTH,
  findEntryThroughLink,
  findUnresolvableLink,
  isRelativeLinkTarget,
  resolvePayloadLinkTarget,
  targetCarriesLinks,
} from '../../src/contract/links.mjs';

const link = (path, linkTarget) => ({ path, kind: 'link', linkTarget });
const file = (path) => ({ path, kind: 'file' });

describe('what a payload link target may look like', () => {
  it('accepts the shapes a conda prefix actually produces', () => {
    // The classes that made the Linux box four times the size of the macOS one.
    expect(resolvePayloadLinkTarget('venv/bin/python', 'python3.11')).toBe('venv/bin/python3.11');
    expect(resolvePayloadLinkTarget('venv/lib/libicudata.so', 'libicudata.so.78'))
      .toBe('venv/lib/libicudata.so.78');
    // Resolution is a lexical question only; whether the result is a file this payload may link to
    // is findUnresolvableLink's job, and it refuses this one because python3.1 is a directory.
    expect(resolvePayloadLinkTarget('venv/lib/python3.1', 'python3.11')).toBe('venv/lib/python3.11');
    // `..` is not hostile in itself, and prefixes do use it.
    expect(resolvePayloadLinkTarget('venv/share/x', '../lib/x')).toBe('venv/lib/x');
  });

  it('refuses a target that reaches outside the payload', () => {
    expect(resolvePayloadLinkTarget('venv/bin/python', '/usr/bin/python3')).toBeNull();
    expect(resolvePayloadLinkTarget('venv/bin/python', '/etc/passwd')).toBeNull();
    // One `..` too many, from two different depths.
    expect(resolvePayloadLinkTarget('venv/bin/python', '../../../etc/passwd')).toBeNull();
    expect(resolvePayloadLinkTarget('a', '../b')).toBeNull();
    // Climbing out and back in is still climbing out.
    expect(resolvePayloadLinkTarget('venv/bin/x', '../../../scrollcase/venv/bin/y')).toBeNull();
  });

  it('refuses shapes that only mean something on a host, not in a payload', () => {
    expect(isRelativeLinkTarget('C:/Windows/System32')).toBe(false);
    expect(isRelativeLinkTarget('..\\..\\windows')).toBe(false);
    expect(isRelativeLinkTarget('lib/\0/x')).toBe(false);
    expect(isRelativeLinkTarget('')).toBe(false);
    expect(isRelativeLinkTarget(undefined)).toBe(false);
    // A link onto itself resolves to nothing useful and loops any consumer that follows it.
    expect(resolvePayloadLinkTarget('venv/bin/python', 'python')).toBeNull();
    // Nothing may resolve to the payload root itself.
    expect(resolvePayloadLinkTarget('venv/bin', '../../venv/..')).toBeNull();
  });
});

describe('writing through a link', () => {
  it('rejects an entry whose path passes through a directory link', () => {
    // The attack: land a link, then write "into" it and escape wherever it points.
    const entries = [
      link('venv/lib/python3.1', 'python3.11'),
      file('venv/lib/python3.1/site-packages/evil.py'),
    ];
    expect(findEntryThroughLink(entries)).toBe('venv/lib/python3.1/site-packages/evil.py');
  });

  it('allows a directory link that nothing is written through', () => {
    const entries = [
      link('venv/lib/python3.1', 'python3.11'),
      file('venv/lib/python3.11/os.py'),
    ];
    expect(findEntryThroughLink(entries)).toBeNull();
  });

  it('says nothing about an entry set with no links at all', () => {
    expect(findEntryThroughLink([file('venv/bin/python'), file('venv/lib/x')])).toBeNull();
  });
});

describe('following a chain', () => {
  it('follows the soname chain a real library uses', () => {
    const entries = [
      link('venv/lib/libicudata.so', 'libicudata.so.78'),
      link('venv/lib/libicudata.so.78', 'libicudata.so.78.3'),
      file('venv/lib/libicudata.so.78.3'),
    ];
    expect(findUnresolvableLink(entries)).toBeNull();
  });

  it('rejects a cycle instead of following it', () => {
    const entries = [link('venv/a', 'b'), link('venv/b', 'a')];
    expect(findUnresolvableLink(entries)).not.toBeNull();
  });

  it('rejects a chain longer than any real prefix produces', () => {
    const entries = [];
    for (let index = 0; index < MAX_PAYLOAD_LINK_DEPTH + 2; index += 1) {
      entries.push(link(`venv/link${index}`, `link${index + 1}`));
    }
    entries.push(file(`venv/link${MAX_PAYLOAD_LINK_DEPTH + 2}`));
    expect(findUnresolvableLink(entries)).toBe('venv/link0');
  });

  it('rejects a link pointing at nothing in the payload', () => {
    expect(findUnresolvableLink([link('venv/bin/python', 'python3.11')])).toBe('venv/bin/python');
  });

  it('rejects a link to a directory, however that directory exists', () => {
    // The whole reason anything could be written *through* a link. Refused outright, whether the
    // directory has an entry of its own or exists only through its children.
    expect(findUnresolvableLink([
      link('venv/lib/python3.1', 'python3.11'),
      file('venv/lib/python3.11/os.py'),
    ])).toBe('venv/lib/python3.1');
    expect(findUnresolvableLink([
      link('venv/lib/python3.1', 'python3.11'),
      { path: 'venv/lib/python3.11', kind: 'directory' },
    ])).toBe('venv/lib/python3.1');
  });
});

describe('which targets carry links at all', () => {
  it('keeps Windows boxes link-free, because creating one there needs elevation', () => {
    expect(targetCarriesLinks('windows')).toBe(false);
    expect(targetCarriesLinks('linux')).toBe(true);
    expect(targetCarriesLinks('macos')).toBe(true);
  });
});
