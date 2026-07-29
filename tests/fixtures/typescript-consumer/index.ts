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
  BoxScroll,
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
import {
  runBox,
  runExtractedBox,
  verifyAndExtractBox,
} from "scrollcase/consumer";
import type {
  BoxRunResult,
  PreparedBox,
} from "scrollcase/consumer";

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
declare const scroll: BoxScroll;
declare const signed: SignedBoxDocument;

const stem: string = boxReleaseStem(release);
const objectPrefix: string = boxReleaseObjectPrefix(release);
const narrowed: SignedBoxDocument | null = isSignedBoxDocument(signed) ? signed : null;
const verified: Promise<unknown> = verifySignedDocument(signed, "trusted-key.json");
const newlySigned: Promise<SignedBoxDocument> = signDocument(release, {
  publicPath: "trusted-key.json",
  privatePath: "private-key.pem",
});
const prepared: Promise<Readonly<PreparedBox>> = verifyAndExtractBox("release.json", {
  publicPath: "trusted-key.json",
  archive: "box.zip",
  destination: "prepared-box",
});
declare const preparedBox: PreparedBox;
const extractedResult: Promise<BoxRunResult> = runExtractedBox(preparedBox, {
  args: ["--model", "example"],
  env: { SCROLLCASE_TEST_VALUE: "1" },
  stdin: "ignore",
  stdout: "pipe",
  stderr: "inherit",
});
const temporaryResult: Promise<BoxRunResult> = runBox("release.json", {
  publicPath: "trusted-key.json",
  archive: "box.zip",
  args: ["--serve"],
});

// These calls are deliberately invalid: the declarations must reject them instead of widening the
// library surface to `any`.
// @ts-expect-error a target must carry the complete closed target shape
boxTargetId({ platform: "linux" });
// @ts-expect-error filesystem paths are strings
void sha256File(42);
// @ts-expect-error signing always requires a trust anchor for local verification
void signDocument(release, {});
// @ts-expect-error caller arguments must remain a closed array of strings
void runExtractedBox(preparedBox, { args: [42] });

void [
  BOX_SCHEMA_VERSION,
  targetId,
  schema,
  fixture,
  workspaceRoot,
  channel,
  revocations,
  scroll,
  stem,
  objectPrefix,
  narrowed,
  verified,
  newlySigned,
  prepared,
  extractedResult,
  temporaryResult,
];
