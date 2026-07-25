/**
 * The scrollcase box-format contract.
 *
 * This module is the single source of truth for what a box *is*: which targets exist, how a
 * target is named, what layout the payload has, and the shape of every document a build emits. It
 * ships three things that must never disagree — a reference implementation (this code), a
 * machine-readable spec (`schema/*.json`), and golden fixtures (`fixtures/*.json`) that any other
 * implementation can validate itself against.
 *
 * A consumer written in another language does not import this code; it mirrors the rules and proves
 * the mirror against the fixtures. That is how the Rust and TypeScript clients stay honest.
 */

export {
  assertNativeHost,
  assertPythonEntryPoint,
  condaSubdir,
  pixiAccelerator,
  boxTargetAdapter,
  boxTargetAdapters,
  boxTargetId,
} from './targets.mjs';

export {
  CHANNELS,
  DEFAULT_DOCUMENT_NAMESPACE,
  PAYLOAD_ENCODING,
  BOX_SCHEMA_VERSION,
  SIGNATURE_ALGORITHM,
  decodeDocumentPayload,
  documentKinds,
  isSignedBoxDocument,
  parseDocumentKind,
} from './documents.mjs';

/** Absolute URL of a shipped JSON Schema, for consumers that validate documents themselves. */
export function schemaUrl(name) {
  return new URL(`./schema/${name}.schema.json`, import.meta.url);
}

/** Absolute URL of a shipped fixture file, for consumers proving a mirror implementation. */
export function fixtureUrl(name) {
  return new URL(`./fixtures/${name}.json`, import.meta.url);
}
