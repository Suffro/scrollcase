/**
 * Types for the scrollcase box format, generated from the JSON Schemas in
 * src/contract/schema/. Do not edit by hand: run `npm run types` instead.
 *
 * The schemas are the source of truth. These types are a projection of them, and the test suite
 * fails if the two disagree.
 */

export type BoxTarget = {
  [k: string]: unknown;
} & {
  /**
   * Operating system the box runs on.
   */
  platform: 'macos' | 'linux' | 'windows';
  /**
   * CPU architecture the box runs on; supported combinations are constrained below.
   */
  arch: 'aarch64' | 'x86_64';
  /**
   * Acceleration backend built into the environment.
   */
  accelerator: 'cpu' | 'metal' | 'cuda';
  /**
   * CUDA ABI as major.minor, for example "12.8". Required for a CUDA target and forbidden for any other, so an identifier can never be ambiguous.
   */
  cudaVersion?: string;
};

/**
 * The optional, shell-free application entry point shared by a scroll, the signed release, and box.json. Its absence means the box is intentionally library-only.
 */
export type BoxExecution = PythonScript | PythonModule;
/**
 * Arguments placed before caller-supplied arguments. Every item is passed directly without a shell.
 */
export type DefaultArgs = string[];

/**
 * Run one regular payload file with the box's own Python interpreter.
 */
export interface PythonScript {
  /**
   * Selects direct script execution.
   */
  kind: 'python-script';
  /**
   * Safe path to a regular Python file inside the box.
   */
  script: string;
  defaultArgs: DefaultArgs;
}
/**
 * Run an importable dotted module with Python's -m option.
 */
export interface PythonModule {
  /**
   * Selects dotted-module execution.
   */
  kind: 'python-module';
  /**
   * Strict Python dotted-module name, without command-line syntax or shell fragments.
   */
  module: string;
  defaultArgs: DefaultArgs;
}

export type Identifier = string;
/**
 * The platform, architecture and accelerator a box is built for. The supported combinations are closed: a target outside this matrix has no defined identifier and cannot be built, signed, or routed.
 */
export type PayloadPath = string;
export type Sha256 = string;
/**
 * The optional, shell-free application entry point shared by a scroll, the signed release, and box.json. Its absence means the box is intentionally library-only.
 */
export interface BoxScroll {
  /**
   * Associates this file with the published Scrollcase v2 schema for editor validation, completion, and hover help.
   */
  $schema?: 'https://scrollcase.dev/schema/v2/scroll.schema.json';
  /**
   * Scrollcase wire version. Version 2 is the only active format.
   */
  schemaVersion: 2;
  /**
   * Optional provenance identity. When omitted, Scrollcase derives it deterministically from boxId and the canonical target.
   */
  scrollId?: string;
  /**
   * Version of this declarative build input, recorded in provenance.
   */
  scrollVersion: string;
  boxId: Identifier;
  modelId: Identifier;
  runtimeId: Identifier;
  /**
   * Version of the box this scroll produces, as it will appear in the release manifest.
   */
  version: string;
  /**
   * Upstream revision of the packaged source, recorded verbatim into provenance.
   */
  sourceRevision: string;
  target: BoxTarget;
  /**
   * Constraints the installing host must satisfy. Copied through into the release manifest verbatim and never interpreted by the builder, so a project may declare its own alongside these.
   */
  compatibility: {
    /**
     * Lowest version of the installing application this box supports.
     */
    minHostAppVersion?: string;
    maxHostAppVersionExclusive?: string;
    minMacosVersion?: string;
    minRamGb?: number;
    minNvidiaDriverVersion?: string;
    [k: string]: unknown;
  };
  /**
   * Python version solved into the box.
   */
  pythonVersion: string;
  /**
   * Pins the pixi release used to solve and install the conda-forge environment from the committed pixi.lock.
   */
  pixiVersion: string;
  /**
   * Path to the reviewed licence inventory derived from pixi.lock, which carries an SPDX licence per package. The build fails if the lock no longer matches what was reviewed.
   */
  condaDependencyLicenseAudit?: string;
  /**
   * Interpreter path relative to the box root. Must match the target adapter's layout.
   */
  pythonEntryPoint: string;
  modelCacheSubdir: string;
  /**
   * Environment variables the box requires when its interpreter runs. The declaration is copied into box.json and the signed release; its values override both the inherited host environment and caller-supplied values.
   */
  environment?: {
    [k: string]: string;
  };
  /**
   * Base URL of the mirror the built archive and its objects are published under.
   */
  assetBaseUrl?: string;
  /**
   * Files fetched during the build. Every entry is size- and hash-checked before use, so a moved or replaced upstream file fails the build instead of silently changing the box. May be empty.
   */
  assets: {
    url: string;
    relativePath: PayloadPath;
    sizeBytes: number;
    sha256: Sha256;
  }[];
  /**
   * Downloaded archives to expand into the payload. Extraction preserves files already present in the destination and refuses to overwrite them.
   */
  assetArchives?: {
    relativePath: PayloadPath;
    format: 'zip' | 'tar.gz';
    destination: PayloadPath;
    stripComponents?: number;
    removeAfterExtract?: boolean;
  }[];
  /**
   * Files copied from the consumer's own repository into the payload, each verified against a declared hash so a licence notice or runtime shim cannot drift from what was reviewed.
   */
  localFiles?: {
    sourcePath: string;
    relativePath: PayloadPath;
    sha256: Sha256;
  }[];
  /**
   * Payload paths deleted before packing, to keep the box to what it actually needs at run time. Pruning a distribution the lock requires is rejected.
   */
  prunePaths?: PayloadPath[];
  /**
   * Payload paths stored in the archive instead of deflated, because their bytes are already compressed and re-compressing them costs build time while making the archive marginally larger. A path matches itself and everything beneath it, so one entry can name a weights file or the directory an expanded asset archive landed in. Declared assets are stored automatically; this is for anything else the project knows to be already compressed.
   */
  uncompressedPaths?: PayloadPath[];
  /**
   * Builder checks run with the payload's own interpreter before archiving. Schema version 2 signs only the import subset for a consumer to repeat; file and optional Python-code assertions remain builder-only.
   */
  selfTest: {
    /**
     * @minItems 1
     */
    imports: [string, ...string[]];
    /**
     * Files that must still exist after pruning, which is what stops an over-aggressive prune from shipping a broken box.
     */
    files: PayloadPath[];
    /**
     * Extra Python executed after the imports succeed, for checks a bare import cannot make.
     */
    pythonCode?: string;
  };
  /**
   * Whether assets are packed into the archive (embed, the default: the box installs with no network and works air-gapped) or left out for the caller to materialize from descriptors in the signed release (on-demand). Consumers verify materialized assets before execution and do not download them. A build may override this.
   */
  weights?: 'embed' | 'on-demand';
  execution?: BoxExecution;
  /**
   * An optional numerical gate: run a check inside the box on more than one accelerator and require the results to agree. This catches a mis-solved environment — CPU-only wheels shipped as CUDA, a broken BLAS — on the build machine rather than on a user's. The tool runs the check and enforces the thresholds; what the check computes, and what closeness is acceptable, belong to the project.
   */
  parity?: {
    /**
     * Path inside the box, run with the box's own interpreter. It must print a JSON array of numbers, or an object with a "values" array.
     */
    script: string;
    /**
     * Accelerators to run under, each with its target's validation environment. The first is the reference the others are compared against — conventionally cpu, being the one available everywhere.
     *
     * @minItems 2
     */
    accelerators: ['cpu' | 'metal' | 'cuda', 'cpu' | 'metal' | 'cuda', ...('cpu' | 'metal' | 'cuda')[]];
    /**
     * At least one bound. Absolute guards entries near zero, where relative error is meaningless; cosine similarity catches a result that drifted in direction rather than magnitude.
     */
    tolerances: {
      absolute?: number;
      relative?: number;
      minimumCosine?: number;
    };
  };
}
/**
 * Run one regular payload file with the box's own Python interpreter.
 */
export interface BoxManifest {
  schemaVersion: 2;
  boxId: string;
  modelId: string;
  runtimeId: string;
  version: string;
  target: BoxTarget;
  pythonEntryPoint: string;
  modelCacheSubdir: string;
  /**
   * Environment variables repeated from the signed release. Scrollcase consumers compare this declaration before execution and apply it over inherited and caller-supplied values.
   */
  environment?: {
    [k: string]: string;
  };
  selfTest: {
    /**
     * @minItems 1
     */
    pythonImports: [string, ...string[]];
    timeoutSeconds: number;
  };
  execution?: BoxExecution;
  provenance: Provenance;
  /**
   * Present only when the assets were deliberately left out of the archive. Absent means the box is self-contained: everything it needs is inside it.
   */
  weights?: 'on-demand';
  /**
   * Assets the consumer must fetch and place under the box root before first use. Present only with on-demand weights. The declared hash is what makes fetching them safe.
   *
   * @minItems 1
   */
  assets?: [
    {
      url: string;
      relativePath: string;
      sizeBytes: number;
      sha256: string;
    },
    ...{
      url: string;
      relativePath: string;
      sizeBytes: number;
      sha256: string;
    }[]
  ];
}
/**
 * Run one regular payload file with the box's own Python interpreter.
 */
export interface Provenance {
  scrollId: string;
  scrollVersion: string;
  /**
   * Exact commit of the builder source that produced the box.
   */
  builderRevision: string;
  /**
   * Whether the builder's working tree carried uncommitted changes. True means the build is not reproducible from the recorded revision alone.
   */
  sourceTreeDirty: boolean;
  /**
   * Upstream revision of the packaged model source, as declared by the scroll.
   */
  sourceRevision: string;
  pythonVersion: string;
  pixiVersion: string;
  /**
   * Hash of the pixi.lock the environment was solved from.
   */
  dependencyLockSha256: string;
  builtAt: string;
}

export interface BoxReleaseManifest {
  schemaVersion: 2;
  /**
   * Wire discriminator, "<namespace>.release". The namespace belongs to the publishing project — a project with boxes already in the field must keep emitting the one its clients recognise — and defaults to scrollcase.box for a new one.
   */
  kind: string;
  boxId: Identifier;
  modelId: Identifier;
  runtimeId: Identifier;
  version: string;
  target: BoxTarget;
  /**
   * What the host must satisfy before this box may be installed. The builder copies these constraints through verbatim and never interprets them, so a project may add its own alongside the ones defined here. A consumer that cannot evaluate a constraint must refuse the box rather than assume it passes.
   */
  compatibility: {
    /**
     * Lowest version of the installing application this box supports.
     */
    minHostAppVersion?: string;
    maxHostAppVersionExclusive?: string;
    minMacosVersion?: string;
    /**
     * Installed memory in decimal gigabytes (1 GB = 1,000,000,000 bytes).
     */
    minRamGb?: number;
    minNvidiaDriverVersion?: string;
    /**
     * Host environments this payload was validated on.
     *
     * @minItems 1
     */
    hostEnvironments?: ['native' | 'windows-wsl2', ...('native' | 'windows-wsl2')[]];
    [k: string]: unknown;
  };
  archive: {
    format: 'zip';
    url: string;
    sha256: Sha256;
    sizeBytes: number;
  };
  /**
   * Sum of extracted payload file sizes before activation metadata is written, so a consumer can check free space before downloading.
   */
  installedSizeBytes?: number;
  /**
   * SHA-256 of the canonical entry list carried at payload-digest.v1 inside the payload, letting a consumer re-identify an extracted installation once the archive is gone. Optional: boxes built before it exists carry no such commitment.
   */
  payloadDigest?: {
    format: 'sha256-path-list-v1';
    sha256: Sha256;
  };
  /**
   * Interpreter path relative to the extracted box root, for example venv/bin/python. Fixed per target by the adapter.
   */
  pythonEntryPoint: string;
  /**
   * Directory relative to the extracted box root holding model assets.
   */
  modelCacheSubdir: string;
  /**
   * Signed environment variables applied whenever Scrollcase runs the box interpreter. These values override both the inherited host environment and caller-supplied values.
   */
  environment?: {
    [k: string]: string;
  };
  /**
   * The import check a consumer can repeat after extraction with the box's own interpreter. The builder also ran the scroll's Python-code and file assertions, which are builder-only checks.
   */
  selfTest: {
    /**
     * @minItems 1
     */
    pythonImports: [string, ...string[]];
    timeoutSeconds: number;
  };
  execution?: BoxExecution;
  provenance: Provenance;
  /**
   * Present only when the assets were deliberately left out of the archive. Absent means the box is self-contained: everything it needs is inside it.
   */
  weights?: 'on-demand';
  /**
   * Assets the consumer must fetch and place under the box root before first use. Present only with on-demand weights. The declared hash is what makes fetching them safe.
   *
   * @minItems 1
   */
  assets?: [
    {
      url: string;
      relativePath: string;
      sizeBytes: number;
      sha256: Sha256;
    },
    ...{
      url: string;
      relativePath: string;
      sizeBytes: number;
      sha256: Sha256;
    }[]
  ];
}
/**
 * Run one regular payload file with the box's own Python interpreter.
 */
export interface BoxChannelManifest {
  schemaVersion: 2;
  /**
   * Wire discriminator, "<namespace>.channel", carrying the same namespace as the releases it refers to.
   */
  kind: string;
  channel: 'nightly' | 'beta' | 'stable';
  boxId: string;
  target: BoxTarget;
  updatedAt: string;
  /**
   * Salt mixed into a client's rollout hash. It makes cohort assignment stable per client and unpredictable across channels, so a staged rollout cannot be gamed by reinstalling.
   */
  cohortSalt: string;
  /**
   * Candidate releases in evaluation order. A client takes the first entry whose rollout cohort it falls into.
   *
   * @minItems 1
   */
  releases: [
    {
      version: string;
      releaseManifestUrl: string;
      rolloutPercentage: number;
    },
    ...{
      version: string;
      releaseManifestUrl: string;
      rolloutPercentage: number;
    }[]
  ];
}

/**
 * Omitted when every target of that version is revoked.
 */
export interface BoxRevocationsManifest {
  schemaVersion: 2;
  /**
   * Wire discriminator, "<namespace>.revocations", carrying the same namespace as the releases it refers to.
   */
  kind: string;
  updatedAt: string;
  /**
   * May be empty: an empty signed list is a positive statement that nothing is revoked, which a client can distinguish from a missing or withheld document.
   */
  revocations: {
    boxId: string;
    version: string;
    target?: BoxTarget;
    reason: string;
    revokedAt: string;
  }[];
}

/**
 * The envelope wrapping every signed document. The payload travels as exact base64-encoded JSON so that verifying a signature means hashing the bytes as transmitted, with no canonical-JSON implementation to keep in sync across languages. Passing this schema means the envelope is well-formed, never that its signature is valid.
 */
export interface SignedBoxDocument {
  schemaVersion: 2;
  payloadEncoding: 'base64-json-utf8';
  /**
   * The document payload: UTF-8 JSON, base64-encoded, signed and hashed exactly as it appears here.
   */
  payloadBase64: string;
  /**
   * SHA-256 of the decoded payload bytes.
   */
  payloadSha256: string;
  /**
   * Detached signatures over the decoded payload bytes. A verifier accepts the document when any one signature verifies against a trusted key, which is what allows a key to be rotated without reissuing every document.
   *
   * @minItems 1
   */
  signatures: [
    {
      algorithm: 'ed25519';
      keyId: string;
      signatureBase64: string;
    },
    ...{
      algorithm: 'ed25519';
      keyId: string;
      signatureBase64: string;
    }[]
  ];
}
