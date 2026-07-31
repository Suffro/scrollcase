/**
 * The rule deciding which symbolic links a box payload may carry.
 *
 * A conda prefix is dense with links: the shared-library soname convention alone stores every large
 * library two or three times (`libfoo.so` → `libfoo.so.N` → `libfoo.so.N.M`), and `bin` carries
 * interpreter aliases. Materialising all of them produced a Linux box where roughly 60% of the
 * bytes were duplicates of other bytes in the same box. Preserving them costs nothing to store and
 * everything to get wrong, because a link is the classic way an archive writes outside the
 * directory it was extracted into.
 *
 * So the rule is deliberately narrow and purely lexical, which is what makes it provable:
 *
 * 1. a target is relative — never absolute, never a drive letter, never a backslash;
 * 2. resolved against the link's own directory it stays inside the payload, so `..` is allowed
 *    exactly as far as it cannot escape;
 * 3. a link resolves to a *regular file*, never to a directory;
 * 4. no entry may have a link as a path prefix, so nothing is ever written *through* a link;
 * 5. chains terminate, within a small bound, without a cycle.
 *
 * Rule 3 is what keeps the rest small. A directory link is legitimate in a conda prefix —
 * `lib/python3.1` → `python3.11` is real — but it is also the only reason an entry could ever be
 * written *through* a link and land somewhere its own name does not describe. Refusing directory
 * links costs one duplicated standard library and removes an entire class of escape, so rule 4
 * survives only as a second lock on a door that rule 3 already welded shut.
 *
 * Nothing here consults the filesystem: the same inputs give the same answer on every host, which
 * is what lets the builder, the Node consumer and the Python consumer apply one rule rather than
 * three approximations of it. The builder additionally confirms its own links with `realpath`,
 * because it can — but no consumer trusts that, and every rule here is re-checked before extraction
 * writes anything.
 *
 * Targets that fail this rule are not an error at build time; they are simply materialised into
 * real files, which is what every link used to become.
 */

/**
 * How many links a single resolution may traverse before it is treated as hostile. Real prefixes
 * use one or two hops (`python` → `python3.11`, `libfoo.so` → `.so.N` → `.so.N.M`); a longer chain
 * has no legitimate source and is the cheap way to make resolution expensive.
 */
export const MAX_PAYLOAD_LINK_DEPTH = 8;

/**
 * Whether a raw link target is shaped like one a payload may carry, before resolving it.
 *
 * @param {unknown} target
 * @returns {boolean}
 */
export function isRelativeLinkTarget(target) {
  if (typeof target !== 'string' || target === '') return false;
  if (target.includes('\0') || target.includes('\\')) return false;
  if (target.startsWith('/')) return false;
  return !/^[A-Za-z]:/.test(target);
}

/**
 * Resolves a link target against the link's own location, staying inside the payload.
 *
 * @param {string} linkPath forward-slash path of the link itself, relative to the payload root
 * @param {string} target the raw link body
 * @returns {string | null} the resolved payload-relative path, or null when the link may not be
 *   carried — an absolute target, an escape through `..`, or a link onto itself
 */
export function resolvePayloadLinkTarget(linkPath, target) {
  if (!isRelativeLinkTarget(target)) return null;
  const segments = String(linkPath).split('/');
  // The link's own name is not part of the directory its target resolves against.
  const stack = segments.slice(0, -1);
  if (segments.length === 0 || segments.at(-1) === '') return null;
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      // Underflow means the target climbed past the payload root: exactly the escape being
      // guarded against, and the reason this is checked per segment rather than on the result.
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (stack.length === 0) return null;
  const resolved = stack.join('/');
  return resolved === linkPath ? null : resolved;
}

/**
 * Rejects an entry set in which anything could be written through a link.
 *
 * A directory link is legitimate — conda ships `lib/python3.1` → `python3.11` — but it means an
 * entry named under that link lands wherever the link points. Forbidding a link as any entry's path
 * prefix removes the question entirely, and is why resolution never has to model what earlier
 * entries did to the filesystem.
 *
 * @param {Array<{ path: string, kind: string }>} entries
 * @returns {string | null} the offending entry path, or null when the set is safe
 */
export function findEntryThroughLink(entries) {
  const links = new Set(entries.filter((entry) => entry.kind === 'link').map((entry) => entry.path));
  if (links.size === 0) return null;
  for (const entry of entries) {
    const parts = entry.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      if (links.has(parts.slice(0, index).join('/'))) return entry.path;
    }
  }
  return null;
}

/**
 * Follows every link in an entry set until it reaches a regular file.
 *
 * A chain that ends anywhere else is refused: at a directory (rule 3), at nothing at all, at
 * itself, or at more hops than a real prefix ever needs. The terminal entry must exist in the same
 * archive, which is what makes a link a statement about this payload rather than about the host.
 *
 * @param {Array<{ path: string, kind: string, linkTarget?: string }>} entries
 * @returns {string | null} the offending link path, or null when every chain ends at a file
 */
export function findUnresolvableLink(entries) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const directories = new Set();
  for (const entry of entries) {
    if (entry.kind === 'directory') directories.add(entry.path);
    const parts = entry.path.split('/');
    for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join('/'));
  }
  for (const entry of entries) {
    if (entry.kind !== 'link') continue;
    const seen = new Set([entry.path]);
    let current = entry;
    for (let depth = 0; ; depth += 1) {
      if (depth >= MAX_PAYLOAD_LINK_DEPTH) return entry.path;
      const resolved = resolvePayloadLinkTarget(current.path, current.linkTarget ?? '');
      if (resolved === null) return entry.path;
      // A directory may exist implicitly, through its children, without an entry of its own — so
      // this has to be asked before looking the path up as an entry.
      if (directories.has(resolved)) return entry.path;
      const next = byPath.get(resolved);
      if (!next) return entry.path;
      if (next.kind === 'file') break;
      if (next.kind !== 'link') return entry.path;
      if (seen.has(next.path)) return entry.path;
      seen.add(next.path);
      current = next;
    }
  }
  return null;
}

/**
 * Whether a target platform can extract a payload containing links.
 *
 * Creating a symbolic link on Windows needs Developer Mode or elevation, so a Windows box keeps
 * materialising every link rather than producing an archive that fails to extract on an ordinary
 * machine.
 *
 * @param {string} platform the target platform, as a scroll declares it
 * @returns {boolean}
 */
export function targetCarriesLinks(platform) {
  return platform !== 'windows';
}
