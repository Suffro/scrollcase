/**
 * Browser-safe reference helpers for the Scrollcase contract.
 *
 * The full `scrollcase/contract` entry point also decodes and hashes signed payloads through Node's
 * crypto implementation. Consumers that only need target identity, document names, constants, or
 * the structural envelope guard can use this entry point in browsers, Workers, and Node alike.
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
  documentKinds,
  isSignedBoxDocument,
  parseDocumentKind,
} from './document-shape.mjs';
