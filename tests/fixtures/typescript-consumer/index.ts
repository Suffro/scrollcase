import {
  fixtureUrl,
  schemaUrl,
} from "scrollcase/contract";
import {
  BOX_SCHEMA_VERSION,
  boxTargetId,
  isSignedBoxDocument,
} from "scrollcase/contract/browser";
import type {
  BoxChannelManifest,
  BoxReleaseManifest,
  BoxRevocationsManifest,
  BoxTarget,
  SignedBoxDocument,
} from "scrollcase/contract/types";
import {
  boxReleaseObjectPrefix,
  boxReleaseStem,
  resolveWorkspace,
  sha256File,
} from "scrollcase/build";
import {
  signDocument,
  verifySignedDocument,
} from "scrollcase/sign";

const target = {
  platform: "linux",
  arch: "x86_64",
  accelerator: "cpu",
} satisfies BoxTarget;

const targetId: string = boxTargetId(target);
const schema: URL = schemaUrl("release-manifest");
const fixture: URL = fixtureUrl("target-id-contract");
const workspaceRoot: string = resolveWorkspace().root;

declare const release: BoxReleaseManifest;
declare const channel: BoxChannelManifest;
declare const revocations: BoxRevocationsManifest;
declare const signed: SignedBoxDocument;

const stem: string = boxReleaseStem(release);
const objectPrefix: string = boxReleaseObjectPrefix(release);
const narrowed: SignedBoxDocument | null = isSignedBoxDocument(signed) ? signed : null;
const verified: Promise<unknown> = verifySignedDocument(signed, "trusted-key.json");
const newlySigned: Promise<SignedBoxDocument> = signDocument(release, {
  publicPath: "trusted-key.json",
  privatePath: "private-key.pem",
});

// These calls are deliberately invalid: the declarations must reject them instead of widening the
// library surface to `any`.
// @ts-expect-error a target must carry the complete closed target shape
boxTargetId({ platform: "linux" });
// @ts-expect-error filesystem paths are strings
void sha256File(42);
// @ts-expect-error signing always requires a trust anchor for local verification
void signDocument(release, {});

void [
  BOX_SCHEMA_VERSION,
  targetId,
  schema,
  fixture,
  workspaceRoot,
  channel,
  revocations,
  stem,
  objectPrefix,
  narrowed,
  verified,
  newlySigned,
];
