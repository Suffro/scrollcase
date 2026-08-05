---
title: Technical White Paper
description: A complete, self-contained technical description of Scrollcase — its vocabulary, boundary, substrate, contract, build pipeline, signing, consumers, invariants and tests.
outline: [2, 3]
next: false
prev: false
---

# Scrollcase — Technical White Paper

Scrollcase turns a declarative **scroll** into a **box**: a portable, locked, self-contained Python
environment for one operating system and one accelerator, packed so that it runs somewhere other
than where it was built, signed so that whoever receives it can prove what they received, and
accompanied by a dependency licence inventory.

This document describes how that is done, module by module, together with the specifications of the
substrate it is built on and a glossary of every technical term it uses. It is written to be
**studied end to end** rather than consulted in spots.

<div id="download-options-list">

::: info The canonical copy
This document is a single Markdown file with no external assets. It is meant to be downloadable and
studiable offline.

- Read or download the source:
  [`docs/white-paper.md`](https://github.com/suffro/scrollcase/blob/main/docs/white-paper.md) on GitHub
- Direct raw download:
  [`raw.githubusercontent.com/suffro/scrollcase/main/docs/white-paper.md`](https://raw.githubusercontent.com/suffro/scrollcase/main/docs/white-paper.md)
- PDF download: <a href="javascript:window.print()">`print → PDF`</a>

:::

</div>

<div class="h3-section-initial-part">

### Document map

The order is deliberate: vocabulary first, then the format, then what produces it, then what
consumes it, then the properties that hold across all of it.

| Section | Subject |
| --- | --- |
| [1. How to read this document](#_1-how-to-read-this-document) | Audience, conventions, self-containment |
| [2. Glossary](#_2-glossary) | Every technical term used here, canonical and domain |
| [3. The problem and the boundary](#_3-the-problem-and-the-boundary) | What Scrollcase is, and what it deliberately is not |
| [4. The substrate](#_4-the-substrate) | pixi, conda-pack, conda-forge, and the three runtime dependencies |
| [5. The contract](#_5-the-contract) | `src/contract/`: targets, envelopes, links, schemas, fixtures, types |
| [6. The build pipeline](#_6-the-build-pipeline) | `src/build/`: the ordered steps and every module that serves them |
| [7. Signing and custody](#_7-signing-and-custody) | `src/sign/`: keys, local signing, external signers, verification |
| [8. The consumers](#_8-the-consumers) | Node, Python, and Rust, side by side, and their shared conformance fixtures |
| [9. The command line](#_9-the-command-line) | The nine verbs and where the thin-CLI boundary runs |
| [10. The invariants](#_10-the-invariants) | Determinism, provenance, verify-never-trust, and the paths that break silently |
| [11. Test map](#_11-test-map) | Which test proves which behaviour |
| [12. Appendices](#_12-appendices) | Module summary, index of public exports |

Every section is present in this copy; the document is complete and self-contained.

</div>

## 1. How to read this document

<div class="h3-section-initial-part">

### 1.1 Audience

</div>

This paper addresses three kinds of reader, and assumes nothing about which one you are beyond
general software engineering literacy:

- **Engineers integrating Scrollcase** — building against its Node or Python surfaces, or driving
  its command line from a pipeline, and needing to know exactly what each call guarantees.
- **Engineers auditing Scrollcase** — establishing what a box commits to, what is checked before
  anything executes, where trust begins and where it ends.
- **Contributors** — changing the code, and needing the reasoning that makes a given shape the right
  one before replacing it with another.

No prior familiarity with conda, pixi, or the box format is assumed. Every term is defined here.

<div class="h3-section-initial-part">

### 1.2 The self-containment rule


Everything this document relies on is explained inside it. There is no prerequisite reading and no
further reading: if an explanation would have to happen elsewhere, it happens here instead.

</div>

What does appear are **provenance references** — citations telling you where the code just described
lives, so that a claim can be checked against its implementation:

- source paths, written as `src/build/box.mjs`
- schema names, written as `release-manifest.schema.json`
- test files, written as `tests/unit/archive-security.test.mjs`

These are citations, not redirections. Nothing in this paper requires you to open them.

**Rejected:** the more usual documentation style of linking each concept to a page that develops it.
For a document meant to be read linearly and offline, an outbound link is a hole: it either breaks
the reading or breaks the download. The cost is deliberate duplication with the rest of the
documentation site, which describes the same system for a different purpose — how to use it, rather
than how it is built.

<div class="h3-section-initial-part">

### 1.3 Conventions


**Canonical terms.** Scrollcase has a small controlled vocabulary — box, scroll, target, payload,
release, channel, revocations, self-test, parity. These words mean exactly one thing each,
everywhere: in the code, in error messages, in the schemas, and here. On first significant use a
canonical term links to its glossary entry, like [box](#box). Everything else in the glossary is
linked the same way.

</div>

**Casing is functional.** *Scrollcase* is the project; `scrollcase` lowercase is an identifier — the
command, the npm package, the exported subpaths, `scrollcase.config.json`, the default
`scrollcase.box` document namespace. Where this document writes one or the other, it means that one.

**Decisions carry their rejected alternative.** A design statement without the option it displaced
is an assertion, not a decision. Where a choice was genuinely contested, the discarded alternative
is recorded with it — as in the paragraph above.

**Code excerpts** are illustrative and abridged. The implementation is the authority; each excerpt
names the file it came from.

**Diagrams are plain text.** Every diagram here is drawn inside a code block rather than rendered by
a diagramming library, so that it survives being printed to PDF and stays readable in the raw
Markdown source. The rest of the site uses rendered diagrams; this document deliberately does not.

**Two words are overloaded**, unavoidably, because the surrounding ecosystems already claimed them.
*Payload* means both the tree assembled before archiving and the encoded contents of a signed
envelope; *channel* means both a Scrollcase release pointer and a conda package source. Both pairs
have separate glossary entries, and this document always makes clear which is meant.

<div class="h3-section-initial-part">

### 1.4 What this document describes


| Scrollcase version | 0.6.0 |
| --- | --- |
| Box format | `schemaVersion: 2` |
| Substrate | pixi + conda-pack + conda-forge |
| Runtime dependencies | `tar`, `yauzl`, `yazl` |
| Node engine | >= 20 |
| Licence | Apache-2.0 |

</div>

Version 2 is a clean break from version 1. A v2 verifier rejects a `schemaVersion: 1` document with
an explicit unsupported-version error rather than reinterpreting it, and this paper describes v2
only. Published v1 artefacts remain usable with the Scrollcase versions that produced them, and are
otherwise out of scope here.

## 2. Glossary

Every term this document uses in a specialised sense is defined here, in one place, so that a reader
can start from any section and resolve unfamiliar vocabulary without leaving the page. Entries are
grouped — canonical Scrollcase vocabulary first, then the packaging, filesystem, cryptography and
distribution terms the design borrows from elsewhere — and alphabetised within each group.

<div class="h3-section-initial-part">

### 2.1 Canonical vocabulary

These are the words Scrollcase controls. Each means exactly one thing, and the code, the schemas and
the error messages use no synonym for any of them.

</div>

<div class="h4-section">

#### Box

The built artefact: a single ZIP archive containing a complete, relocated Python environment, a
self-describing manifest, any embedded assets, and — when the [scroll](#scroll) declares a reviewed
licence audit — a dependency licence inventory. A box is built
for exactly one [target](#target). It is never called an image or a container — it is neither, it
carries no operating system and no isolation boundary, and borrowing either word would import
expectations Scrollcase does not meet.

Reference: `src/build/box.mjs`, `docs/reference/box-format.md`.

</div>

<div class="h4-section">

#### Box ID

The stable identifier of the thing being packaged, declared by the [scroll](#scroll) as `boxId` and
carried into `box.json` and the [release](#release). One box ID spans every version and every target
of that box. It is distinct from `modelId` and `runtimeId`, which are the publishing project's own
identifiers for what the box contains and what runs it; Scrollcase stores and transports all three
without interpreting them.

</div>

<div class="h4-section">

#### `box.json`

The manifest packed **inside** the archive, at its root, so that an extracted box is
self-describing: whoever holds the directory but not the [release](#release) document can still
determine what it is, which target it is for, which interpreter to use, and how it was built.
Verification compares it field by field against the signed release; the two disagreeing is a
failure, not a merge.

</div>

<div class="h4-section">

#### Channel

One of the three signed document types, and a mutable pointer: it names which [release](#release) is
current for a given box on a given track. The tracks are `nightly`, `beta` and `stable`, ordered
from least to most stable. A channel document is signed exactly like a release, so moving a pointer
is an act somebody has to authorise cryptographically.

Not to be confused with a [conda channel](#conda-channel), which is a package source.

Reference: `CHANNELS` in `src/contract/document-shape.mjs`, `channel-manifest.schema.json`.

</div>

<div class="h4-section">

#### Document namespace

The dotted lowercase prefix on every signed document's `kind` discriminator — `scrollcase.box` by
default, giving `scrollcase.box.release`, `scrollcase.box.channel`, `scrollcase.box.revocations`.
The namespace belongs to the **publishing project**, not to the tool: a project with boxes already
installed in the field keeps emitting the namespace its clients recognise, and Scrollcase never
hard-codes one.

Reference: `documentKinds()` in `src/contract/document-shape.mjs`.

</div>

<div class="h4-section">

#### Parity

The optional cross-accelerator numerical gate. A scroll may declare a check script inside the box,
the accelerators to run it under, and tolerances (`absolute`, `relative`, `minimumCosine`);
Scrollcase runs the check once per accelerator, compares every run against the first, and fails the
build on a breach. It answers a packaging question — *did this box get the wrong wheels, a CPU-only
build shipped as CUDA, a broken BLAS?* — and never a scientific one. The threshold is the project's
to declare; enforcing it is Scrollcase's to do.

Reference: `src/build/parity.mjs`.

</div>

<div class="h4-section">

#### Payload

The tree assembled on disk before archiving: `box.json`, the packed environment under `venv/`, any
embedded assets, and `THIRD_PARTY_NOTICES/`. What the archive contains is exactly this tree, so
statements about "what a payload may contain" — which links, which entry names — are statements
about the archive too.

Distinct from a [document payload](#document-payload), which is the encoded content of a signed
envelope.

</div>

<div class="h4-section">

#### Release

One of the three signed document types, and the immutable description of one built box: identity,
target, compatibility requirements, where the archive lives, its size and SHA-256, the import subset
a consumer should repeat, the asset policy, and [provenance](#provenance). A release is never edited
after signing; a correction ships as a new version.

Reference: `release-manifest.schema.json`.

</div>

<div class="h4-section">

#### Revocations

One of the three signed document types: a signed statement that named releases must no longer be
used. Scrollcase defines the format and can verify such a document; publishing one, and acting on
it, belong to whoever distributes boxes.

Reference: `revocations-manifest.schema.json`.

</div>

<div class="h4-section">

#### Scroll

The declarative input, stored as `scroll.json`, and the only input a build accepts. It states box
identity, the target, versions, the dependencies to solve, asset declarations, weights policy, the
self-test, execution intent, and optional compatibility and parity blocks. Scrolls live under
`scrolls/<boxId>/<targetId>/` by default, so that every target variant of one box is visible
together.

Reference: `scroll.schema.json`, `src/build/scroll.mjs`.

</div>

<div class="h4-section">

#### Self-test

The import check run with the box's **own** interpreter — not the host's — as the last step before a
payload is allowed to become an archive. The builder runs a platform assertion, the declared
imports, optional scroll-only Python code, and file assertions. The release signs the import subset,
which is the part a consumer can repeat after extraction; the scroll-only assertions stay builder
checks, because they are not part of the signed release and pretending otherwise would claim a
consumer verified something it never saw.

</div>

<div class="h4-section">

#### Signed document

The single envelope every Scrollcase document travels in: `schemaVersion`, `payloadEncoding`,
`payloadBase64`, `payloadSha256`, and a non-empty array of signatures. It is a container, not a
type — the type is inside, discriminated by the payload's `kind`.

Reference: `signed-document.schema.json`, `src/contract/documents.mjs`.

</div>

<div class="h4-section">

#### Target

The `(platform, arch, accelerator)` triple a box is built for, plus a CUDA ABI version when the
accelerator is CUDA. The supported matrix is closed: `macos/aarch64` with `metal` or `cpu`,
`linux/x86_64` with `cpu` or `cuda`, `windows/x86_64` with `cpu` or `cuda`. A box is built for one
target and makes no claim about any other.

Reference: `src/contract/targets.mjs`.

</div>

<div class="h4-section">

#### Target adapter

What a target implies for the built payload: the Python layout inside the box (`venv/bin/python`
versus `venv/python.exe`), the scripts directory, the executable suffix, the launcher kind, the
pinned archive backend, how native libraries are inspected on that platform, the environment that
forces a run onto one accelerator, and the platform assertion prepended to every self-test. Adapters
are part of the format rather than an implementation detail, because a consumer unpacking a box
relies on that layout.

</div>

<div class="h4-section">

#### Target ID

The canonical slug a target reduces to: `<platform>-<arch>-<accelerator>`, except CUDA, which
appends the version with no separator — `linux-x86_64-cuda12.4`. It appears in archive names, object
keys, routes and directory names, so every implementation of the format must produce it character
for character. `cudaVersion` is required for CUDA and forbidden everywhere else, so a slug is never
ambiguous.

Reference: `boxTargetId()` in `src/contract/targets.mjs`;
golden cases in `fixtures/target-id-contract.json`.

</div>

<div class="h4-section">

#### Workspace

The project layout Scrollcase operates in, declared by a `scrollcase.config.json` at the project
root and discovered by walking up from the working directory. It resolves where scrolls, build
directories, distribution output, keys and the project-local toolchain live. Defaults are `scrolls/`
and `.scrollcase/{build,dist,keys}`. Paths come from the project, never from the tool's own location
on disk.

Reference: `src/build/workspace.mjs`.

</div>

<div class="h3-section-initial-part">

### 2.2 Packaging and environment terms


<div class="h4-section">

#### ABI

*Application Binary Interface* — the binary-level contract between compiled artefacts: calling
conventions, symbol names, struct layouts. Two builds of a library with the same version can be ABI
incompatible, which is why a CUDA target pins a CUDA ABI version (`12.4`) rather than trusting a
package version to describe compatibility.

</div>

</div>

<div class="h4-section">

#### Accelerator

The compute backend a box is built to use: `cpu`, `metal` (Apple's GPU API, reached from Python
through MPS), or `cuda` (NVIDIA, with an ABI version). The accelerator is part of the target because
it changes which packages the solver selects — a CPU build and a CUDA build of the same library can
differ in nothing but that.

</div>

<div class="h4-section">

#### Air-gapped

Describes an installation environment with no network access at all. A box built with embedded
weights installs and runs air-gapped, because everything it needs is inside the archive. This is the
property `embed` exists to preserve.

</div>

<div class="h4-section">

#### Asset

A file the box needs that is not a Python package — model weights, tokenizers, fixtures. Assets are
declared in the scroll with a URL or local path, a size and a SHA-256, and are size- and
hash-checked before they enter the payload. Under `embed` they are packed into the archive; under
`on-demand` they are left out and their descriptors travel in the signed release.

Reference: `src/build/assets.mjs`.

</div>

<div class="h4-section">

#### conda

A package manager and package format originating in the scientific Python world, whose distinguishing
property is that it packages **compiled artefacts** — shared libraries, compilers, CUDA runtimes —
alongside Python code, rather than assuming they are already present on the host.

</div>

<div class="h4-section">

#### conda channel

A source of conda packages: an indexed repository of package archives organised by
[subdir](#conda-subdir). Scrollcase's generated manifests pin exactly one, `conda-forge`. Distinct
from a Scrollcase [channel](#channel), which is a signed release pointer.

</div>

<div class="h4-section">

#### conda-forge

The community-maintained conda channel Scrollcase builds from. It matters here for three reasons: it
distributes native libraries as a coherent, mutually compatible package set rather than as
independently built wheels; it covers the scientific and machine-learning stack including
accelerator builds; and it annotates every package with an SPDX licence, which is what makes a
derived licence inventory possible without inspecting package contents.

</div>

<div class="h4-section">

#### conda-meta

The directory inside a conda prefix holding one JSON record per installed package, written by the
installer. Scrollcase rewrites these records into a canonical form — keeping only `name`, `version`,
`build` and `license` — because as written they carry per-file hashes that differ between two
installs of the same lock, and absolute paths into the build machine's package cache.

Reference: `canonicalizeCondaRecords()` in `src/build/pixi.mjs`.

</div>

<div class="h4-section">

#### conda-pack

The tool that turns an installed conda [prefix](#prefix) into a relocatable archive. It collects the
prefix's contents and replaces the build-time prefix string inside text files with a neutral
placeholder, so the result can be extracted anywhere.

</div>

<div class="h4-section">

#### conda subdir

The conda ecosystem's platform identifier — `osx-arm64`, `linux-64`, `win-64`. It is the value of
`platforms` in the generated pixi manifest, and it must equal the one implied by the box's target,
or the solve produces an environment that cannot run on the machine the box is for.

</div>

<div class="h4-section">

#### Lockfile

A file recording the exact resolved set of packages — names, versions, builds, sources and hashes —
that a manifest's constraints produced at solve time. Scrollcase commits `pixi.lock` and installs
from it without re-resolving, which is what makes two builds of one commit produce the same
environment. It also carries an SPDX licence per package, which is the input to the licence
inventory.

</div>

<div class="h4-section">

#### Manifest

Two distinct files carry this name and this document distinguishes them explicitly: the **pixi
manifest** (`pixi.toml`) states dependency constraints, channels and platforms as *input to a
solve*; the **box manifest** ([`box.json`](#box-json)) describes a built box as *output*. Where the
word appears alone it means whichever the surrounding sentence is about.

</div>

<div class="h4-section">

#### Prefix

A conda installation root: a directory containing `bin/` (or `Scripts/` on Windows), `lib/`,
`conda-meta/` and everything else an environment consists of. Every path inside a prefix is
meaningful relative to it — which is what makes moving one non-trivial, and what relocation is
about. Inside a box the prefix is `venv/`.

</div>

<div class="h4-section">

#### PyPI

The Python Package Index, the default source for `pip` and the home of [wheels](#wheel). Scrollcase
does not build from it: the guarantees it needs about native libraries are properties of a
coherently built channel, not of independently published wheels. PyPI appears in the tool only as an
option for how a *consumer's* project installs the Scrollcase Python consumer package itself.

</div>

<div class="h4-section">

#### Relocation

Making an environment work at a directory other than the one it was built in. The problem is that
build-time absolute paths get written into scripts, service files and package metadata. Scrollcase's
model is: pack with conda-pack (which replaces the build prefix with a placeholder), extract into
the box, delete the service files that still carry the prefix, canonicalise the package records,
settle the symbolic links, and rewrite generated console scripts to resolve Python next to
themselves. A box then needs no relocation step at install time.

</div>

<div class="h4-section">

#### Solve

The act of turning dependency constraints into an exact package set that satisfies all of them
simultaneously, for one platform. Scrollcase separates solving (`lock`, run by a human when
dependencies change, producing a reviewable diff) from installing (`build`, which consumes the
committed result and never re-resolves).

</div>

<div class="h4-section">

#### SPDX

A standard vocabulary of licence identifiers — `MIT`, `Apache-2.0`, `BSD-3-Clause` — used by
conda-forge package metadata and therefore by the lock. Scrollcase's licence inventory reports these
identifiers as declared; a package declaring no licence fails the parse outright, because an
unlicensed dependency is a legal problem rather than a reporting gap.

</div>

<div class="h4-section">

#### Wheel

The binary distribution format of the PyPI ecosystem (`.whl`), the unit `pip install` normally
consumes. Wheels can and do contain compiled code, but each is built independently by its own
publisher, so a set of wheels is not automatically a mutually compatible set of native libraries.
That difference is why the substrate is conda-based.

</div>

<div class="h4-section">

#### `venv/`

The directory inside a box holding the packed environment — the relocated conda prefix, complete
with its interpreter, libraries and canonicalised `conda-meta/`. The name is conventional; the
contents are a conda prefix, not a Python `venv` in the standard-library sense, and nothing inside a
box ever runs `conda`.

</div>

<div class="h3-section-initial-part">

### 2.3 Filesystem and archive terms


<div class="h4-section">

#### Content-addressed

Named by the hash of its own contents rather than by an assigned name. A box archive's object key
contains its SHA-256, so the name changes if a single byte does; a signed release can therefore
commit to exactly the bytes it describes, and a consumer can verify what it received against the
name it fetched.

</div>

</div>

<div class="h4-section">

#### Digest

The fixed-length output of a hash function over some bytes — here always SHA-256, written as 64
lowercase hexadecimal characters. Used throughout: for the archive, for assets, for the downloaded
toolchain, for the lockfile, and for the encoded payload of every signed document.

</div>

<div class="h4-section">

#### Materialise

To replace a symbolic link with a real copy of what it points at. Scrollcase materialises every link
it cannot prove safe to carry, which keeps the payload correct at the cost of duplicated bytes, and
is the reason the link rule described in section 6 exists at all.

</div>

<div class="h4-section">

#### Path traversal

An archive entry whose name escapes the directory it is extracted into — `../../etc/passwd`, an
absolute path, a Windows drive letter. Every entry name a Scrollcase archive contains is validated
against this on the way out, by the builder, by `verify`, and independently by each consumer.

Reference: `safeRelativePath()` in `src/build/filesystem.mjs`.

</div>

<div class="h4-section">

#### Shebang

The `#!` first line of an executable text file, telling the operating system which interpreter to
run it with. Generated console scripts in a conda prefix embed the **build machine's** absolute
interpreter path there, which is one of the concrete things relocation has to erase.

</div>

<div class="h4-section">

#### Soname

The versioned name convention for shared libraries on Linux — `libfoo.so` → `libfoo.so.6` →
`libfoo.so.6.2.1`, the first two usually being symbolic links to the third. It is the single largest
reason a conda prefix is dense with links, and the reason materialising all of them was measured to
make roughly 60% of an extracted Linux box duplicates of its own bytes.

</div>

<div class="h4-section">

#### Symbolic link

A filesystem entry whose content is a path to another entry. Links are the classic way an archive
writes outside the directory it was extracted into, so Scrollcase carries one only when it can prove
— purely lexically, so that every host answers identically — that its target is relative, stays
inside the payload after `..` is applied segment by segment, and ends at a regular file. Everything
else is materialised. Windows boxes carry no links at all.

Reference: `src/contract/links.mjs`.

</div>

<div class="h4-section">

#### Zip64

The ZIP extension that lifts the format's 4 GiB and 65,535-entry limits. Box archives are Zip64
*capable* — a packed scientific environment routinely exceeds the entry count, and embedded weights
routinely exceed the size — while the writer emits Zip64 structures only where they are needed, so
small boxes stay readable by the widest range of tools.

</div>

<div class="h3-section-initial-part">

### 2.4 Cryptography and distribution terms


<div class="h4-section">

#### base64

The encoding that represents arbitrary bytes as ASCII text. A signed document's payload is
base64-encoded UTF-8 JSON — `payloadEncoding: "base64-json-utf8"` — which is what makes a signature
verifiable by hashing bytes as transmitted.

</div>

</div>

<div class="h4-section">

#### Canonical JSON

Any scheme for reducing a JSON value to one unambiguous byte sequence, so that two implementations
signing the same value sign the same bytes. Scrollcase deliberately does **not** use one: the
payload travels as exact base64 of the bytes that were signed.

**Rejected:** canonicalisation. It requires every client, in every language, to implement identical
key ordering, number formatting and string escaping — historically the richest source of
cross-language signature bugs. Transmitting the exact bytes removes the problem instead of solving
it repeatedly.

</div>

<div class="h4-section">

#### Detached signature

A signature stored separately from the artefact it covers, so the artefact itself is left byte for
byte unmodified. A Scrollcase [release](#release) is detached in exactly this sense with respect to
the **archive**: the archive is never rewritten to hold a signature, and the signed document commits
to it through its size and SHA-256. With respect to the release *metadata*, the signature is not
detached — payload and signatures travel together inside one envelope.

</div>

<div class="h4-section">

#### Document payload

The content of a signed envelope: UTF-8 JSON, base64-encoded into `payloadBase64`, with its SHA-256
in `payloadSha256`. Decoding checks that hash before the contents are read at all, which catches a
truncated or edited document before anything acts on it. Distinct from the box
[payload](#payload) tree.

</div>

<div class="h4-section">

#### ed25519

The digital signature scheme Scrollcase uses, and the only one the format defines. It is chosen for
small keys and signatures, fast verification, and the absence of parameter choices that can be got
wrong. Keys are generated with Node's own `crypto` module; there is no cryptographic dependency to
audit.

</div>

<div class="h4-section">

#### Envelope

The outer, type-agnostic structure of a signed document — the fields that let a verifier check
integrity and authenticity before it knows or cares what kind of document it holds.

</div>

<div class="h4-section">

#### Key ID

A short stable identifier for a signing key, carried by each signature so that a verifier can tell
which key produced it. A document is accepted when **any one** of its signatures verifies against a
trusted key, which is what allows a key to be rotated without reissuing every document already
published.

</div>

<div class="h4-section">

#### Trust key

A public key a consumer has decided to trust, supplied to verification by the caller. Scrollcase
verifies against the keys it is given; deciding which keys those are is the caller's policy, not the
tool's.

</div>

<div class="h3-section-initial-part">

### 2.5 Process and guarantee terms


<div class="h4-section">

#### Determinism

The property that rebuilding the same commit produces a byte-identical archive. It is maintained by
construction: fixed archive timestamps, stable entry ordering, modes derived from the target
adapter, the build time taken from the commit rather than the clock, canonicalised package records,
and no random value anywhere. Determinism is what makes an independent rebuild a meaningful check on
a published box.

</div>

</div>

<div class="h4-section">

#### Dirty tree

A working tree with uncommitted changes, including untracked files, while respecting Git ignore
rules. Building from one requires `--allow-dirty` and is recorded in the box as
`sourceTreeDirty: true`, because a build that cannot be reproduced from its recorded revision has to
say so.

</div>

<div class="h4-section">

#### Injection seam

A dependency deliberately passed in rather than reached for, so that a test can substitute it.
Scrollcase has two of consequence: subprocess execution, which goes through `run` / `runResult`, and
network access, which goes through an injectable `fetch`. They are the reason the unit suite can
exercise the real pipeline without a toolchain, without the network, and without writing outside a
temporary directory.

</div>

<div class="h4-section">

#### Provenance

The record of where a box came from: which scroll and scroll version, the 40-hex commit of the
source tree that built it, whether that tree was dirty, the upstream revision of the packaged model
source as the scroll declared it, the Python and pixi versions, the SHA-256 of the lock the
environment was solved from, and the build timestamp taken from the commit. It is recorded from
observed state and never accepted from caller input.

</div>

<div class="h4-section">

#### Weights mode

Whether a box carries its assets or refers to them: `embed` packs them into the archive, so the box
installs air-gapped at the cost of a large artefact; `on-demand` leaves them out and carries their
URL, path, size and SHA-256 in the signed release and in `box.json`. The declared hash is what makes
deferring safe — the release commits to exactly which bytes are expected, whatever host serves them.

</div>

## 3. The problem and the boundary

<div class="h3-section-initial-part">

### 3.1 The problem


A scientific or machine-learning Python environment is mostly not Python. Underneath the imports sit
compiled libraries — BLAS and LAPACK implementations, image and audio codecs, compression libraries,
accelerator runtimes — each with its own ABI, its own build flags, and its own expectations about
what else is present on the machine. The Python code on top is a thin veneer over that, and it is
the veneer that the usual packaging tools describe well.

</div>

This produces a specific, recurring failure. An environment works on the machine where it was
assembled, and then:

- **it cannot be reproduced.** Constraints re-resolve months later to a different set, or a
  dependency's newest build changes an ABI, and the environment that installs today is not the one
  that was tested.
- **it cannot be moved.** Absolute paths from the build machine are baked into scripts, service
  files and metadata; a directory copied elsewhere is a directory that no longer runs.
- **it cannot be verified.** The receiver has a set of files and a hope. Nothing states what the
  bytes should have been, and nothing signed says who produced them.
- **it cannot be inventoried.** Somebody eventually asks what is inside and under which licences,
  and the answer has to be reconstructed by inspection.

Each of these has partial answers in isolation. A lockfile addresses reproducibility but not
relocation. A container addresses relocation but assumes a container runtime, which a desktop
application, an offline workstation, or a locked-down laboratory machine may not have. A signature
addresses verification but only if something upstream produced a stable artefact worth signing. What
is missing is a single artefact that is all four at once.

<div class="h3-section-initial-part">

### 3.2 What Scrollcase is


Scrollcase produces exactly that artefact, and defines the format so it can be verified by anyone.

</div>

```text
  scroll.json               the declarative input, the only input a build accepts
       |
       v
  pixi.lock                 solved once by a human, committed, reviewed
       |
       v
  installed conda prefix    materialised from the lock, never re-resolved
       |
       v
  payload tree              box.json | venv/ | assets | licence notices
       |
       v
  deterministic ZIP         content-addressed: its name is its own digest
       |
       v
  signed release            + a signed channel pointer to it
       |
       v
  any consumer              verify, extract, run
```

Read as guarantees rather than as steps, that pipeline says:

1. **One declarative input.** A build accepts a [scroll](#scroll) and nothing else. There is no
   imperative build script, no hook, and no place for a build to acquire behaviour that is not
   written down in a reviewable file.
2. **Locked, not resolved.** The environment is solved once by a human running `lock`, and the
   result is committed. `build` installs the locked set without re-resolving.
3. **Packed for elsewhere.** The prefix is packed and repaired so that the box runs from any
   directory on any machine matching its target, with no install-time fixer, no activation script,
   and no build-machine path anywhere inside it.
4. **Proved before it ships.** The box's own interpreter imports the declared modules before the
   payload is allowed to become an archive.
5. **Deterministic.** The same commit rebuilds to the same bytes, so an independent rebuild is a
   real check.
6. **Signed and self-describing.** A release commits to the archive's size and SHA-256; the archive
   carries a manifest that must agree with it.
7. **Inventoried.** When the scroll declares a reviewed licence audit, the dependency licence
   inventory is derived from the lock, so it is a property of what was solved rather than of
   somebody's notes.

Scrollcase is **a library as well as a command line**. Its Node surfaces are `scrollcase/contract`,
`scrollcase/contract/browser`, `scrollcase/contract/types`, `scrollcase/build`, `scrollcase/sign`
and `scrollcase/consumer`, plus the published schemas and fixtures; the Python consumer package is
imported as `scrollcase_consumer`. The nine command-line verbs — `init`, `new`, `doctor`, `keygen`,
`lock`, `audit`, `build`, `verify`, `run` — are a thin layer over those surfaces, not a separate
implementation.

It is open source under Apache-2.0 and vendor-neutral: it carries no reference to any specific
consuming project, anywhere.

<div class="h3-section-initial-part">

### 3.3 What Scrollcase is not


This boundary is the point of the project, and it is the thing most likely to erode, because every
individual crossing of it looks convenient at the time.

</div>

**Not a distribution system.** Scrollcase may prepare and execute a caller-supplied local box, but
it does not select channels, download boxes, update installations, promote, revoke, publish, or
serve. The consumer APIs operate on release documents, archives, trust keys and destinations that
the caller supplies.

**Not a CI system.** No model catalogue, no runner allocation, no cost policy, no build-evidence
records for somebody else's pipeline.

**Not a scientific validator.** Scrollcase *enforces* a numerical tolerance its user declared — see
[parity](#parity) — and never decides what is scientifically correct or what a fixture means.

**Not tied to any consuming project.** No consumer's name appears in identifiers, error messages,
environment variables, default paths, wire strings, or examples. A project-specific value is
declared by the project, in its config, its scroll, or a flag, and Scrollcase stays ignorant of what
it means.

<div class="h3-section-initial-part">

### 3.4 Why the boundary is drawn there


The boundary is not modesty about scope. It is what keeps the guarantees provable.

</div>

Every guarantee in section 3.2 is a statement about a local, closed operation: these inputs produce
these bytes; these bytes hash to this value; this signature verifies against this key. Each can be
checked by rerunning it. A registry, a promotion policy, or an update mechanism introduces
guarantees of an entirely different kind — about availability, about rollout, about what a fleet of
installed clients believes at a given moment — and those cannot be checked by rerunning anything.
A tool that offered both would have to keep proving both sets at once, on every release, and the
weaker set would set the pace.

There is also a compositional argument. Most projects that need signed environments already have a
distribution mechanism: an object store, a CDN, an internal artefact service, an application updater
they have already threat-modelled. A tool that stops at "here is a signed artefact and here is how
to verify it" composes with all of them. A tool that ships its own registry composes with none.

**Rejected:** folding download, channel selection, update and lifecycle policy into the tool — which
is the obvious next feature request, and was declined for the reasons above. What Scrollcase does
instead is define the formats those layers need: a [release](#release) that commits to an archive, a
[channel](#channel) that points at a release, a [revocations](#revocations) document that withdraws
one. The formats are specified and verifiable; the policies that use them belong to whoever owns the
fleet.

::: warning A note for contributors
A change that crosses this boundary is wrong even when it would be convenient, and even when it is
small. The characteristic shape of such a change is a helper that fetches something, a default that
encodes somebody's rollout policy, or a field that only makes sense to one consumer.
:::

## 4. The substrate

Scrollcase supports exactly one dependency backend: **pixi + conda-pack + conda-forge**. pixi solves
and installs, conda-pack relocates the resulting prefix, conda-forge supplies the packages.

**Rejected:** a second backend for projects already standardised on a wheel-based tool such as
`uv`. A packaging tool's product is its guarantees — that an environment installs, relocates,
self-tests and is reproducible from a lock. Two backends means proving every guarantee twice, on
every platform, for every release, and the guarantees are the product. Projects on another tool
convert their scrolls once; Scrollcase avoids a permanent double burden.

The conda-forge path also solves the problem a wheel-based one structurally cannot, which is the
subject of the next subsection.

<div class="h3-section-initial-part">

### 4.1 conda-forge


conda-forge is a community-maintained [conda channel](#conda-channel): an indexed repository of
packages, organised by [conda subdir](#conda-subdir), built by a shared infrastructure against a
shared set of pinned base libraries.

</div>

Three properties make it the substrate rather than a substrate.

**It distributes native code as a coherent set.** A conda package can contain anything a prefix
needs — a shared library, a compiler runtime, a CUDA toolkit component — and the channel's packages
are built against each other's pinned versions. A set of wheels is not this: each wheel is built
independently by its publisher, each vendors or expects native libraries on its own terms, and their
mutual compatibility is a coincidence that usually holds. For a stack that is mostly compiled code,
"usually holds" is exactly the failure mode Scrollcase exists to remove.

**It covers the accelerator matrix.** CPU, CUDA and Metal builds of the major scientific and machine
learning packages exist in the channel, selected by the solver from the constraints the scroll
declares. This is what lets a target's accelerator be a *solve input* rather than a post-hoc
substitution.

**Every package declares an SPDX licence.** That metadata is recorded per package in the
[lockfile](#lockfile), which is what makes the dependency licence inventory a pure function of the
lock — computable without building anything, and reviewable when dependencies change rather than at
the end of a multi-gigabyte build.

Generated pixi manifests pin exactly one channel:

```toml
[workspace]
name = "example-model"
channels = ["conda-forge"]
platforms = ["osx-arm64"]
```

Reference: `pixiManifest()` in `src/build/authoring.mjs`.

The single-channel pin is deliberate. Channel priority across multiple sources is one of the classic
ways a conda environment becomes irreproducible: the same constraints resolve differently depending
on which channel wins, and which channel wins depends on configuration that is easy to leave out of
version control. One channel, named in the committed manifest, removes the question.

Note also `platforms`: it is a single-element list holding the target's conda subdir. The manifest
pins the channels **and** the single target platform, so resolution is host-independent and no
per-invocation platform flag is needed anywhere in Scrollcase's argument vectors.

<div class="h3-section-initial-part">

### 4.2 pixi


pixi is a conda-ecosystem workspace manager: it reads a `pixi.toml` manifest of constraints,
channels and platforms, solves them into a `pixi.lock`, and installs that lock into a prefix under
`.pixi/envs/`. Scrollcase uses it for exactly two things — solving and installing — plus one
auxiliary use, installing conda-pack itself.

</div>

<div class="h4-section">

#### The three invocations

Scrollcase's argument vectors are small, explicit, and constructed by pure functions so that they
can be asserted in tests without running anything.

**Solve.** `lock` resolves a scroll's manifest into its committed lockfile without installing:

```js
// src/build/pixi.mjs
export function pixiLockArguments(manifestPath) {
  return ['lock', '--manifest-path', manifestPath];
}
```

This is run by a human when dependencies change. The lock is committed and reviewed, and the diff is
the artefact a reviewer actually reads.

**Install.** `build` materialises the environment from the committed lock, never re-resolving:

```js
// src/build/pixi.mjs
export function pixiInstallArguments(manifestPath) {
  return ['install', '--manifest-path', manifestPath, '--frozen'];
}
```

`--frozen` is the load-bearing flag: it installs exactly the locked packages without touching or
re-checking the lock, so what ships is byte for byte what was reviewed. Install-from-lock,
never-resolve. Whether the lock is still fresh with respect to its manifest is a separate concern
belonging to a project's CI, not to a build that is about to spend minutes and gigabytes.

**Auxiliary install.** `init --install-toolchain` uses the project's own pixi to install conda-pack
into the project's own toolchain directory:

```js
// src/build/toolchain.mjs
run(pixi, ['global', 'install', `conda-pack==${CONDA_PACK_VERSION}`], {
  env: { PIXI_HOME: toolchainDir },
});
```

`PIXI_HOME` is what keeps the result inside the project instead of in the user's home directory.
Integrity here is conda-forge's to provide: conda-pack is resolved and verified by pixi exactly as
any other package is.

</div>

<div class="h4-section">

#### The build workspace

`build` never installs into the tracked scroll directory. It stages the manifest and the lock
side by side into a build-local workspace and installs there, so that pixi's `.pixi/envs/` tree
lands in the build directory and is removed afterwards:

```js
// src/build/pixi.mjs — installAndPackPixiEnvironment
const workspace = join(buildDir, 'pixi-workspace');
await copyFile(manifestPath, join(workspace, 'pixi.toml'));
await copyFile(lockPath, join(workspace, 'pixi.lock'));
run(pixi, pixiInstallArguments(join(workspace, 'pixi.toml')));
const prefix = join(workspace, '.pixi', 'envs', 'default');
```

The multi-gigabyte workspace and the intermediate packed tarball are both removed before the payload
is archived.

</div>

<div class="h4-section">

#### Version pinning and discovery

A scroll pins the pixi release it was solved against, and `build` refuses to proceed with a
different one:

```js
// src/build/pixi.mjs — findPixi
if (found.version !== requiredVersion) fail(`Scroll requires pixi ${requiredVersion}, found ${found.version}.`);
```

The reason is direct: a different resolver version can select different packages, and a box that
silently differs from the one that was tested is exactly what the whole pipeline exists to prevent.

Discovery follows a fixed precedence, highest first:

| Rank | Source | Mechanism |
| --- | --- | --- |
| 1 | Explicit flag | `--pixi <path>` / `--conda-pack <path>` |
| 2 | Environment override | `SCROLLCASE_PIXI` / `SCROLLCASE_CONDA_PACK` |
| 3 | Project-local toolchain | `<toolchainDir>/bin/pixi`, if it exists |
| 4 | `PATH` | the bare name |

The project-local toolchain is *looked up* rather than configured, which is what makes
`init --install-toolchain` sufficient on its own: nothing has to be added to `PATH` for the next
command to find what was just installed. This is also one of the four paths that break silently —
discovery behaves differently with and without an installed project toolchain, and a change to it
must be checked both ways.

Reference: `toolCandidate()` in `src/build/pixi.mjs`; `tests/unit/toolchain.test.mjs`.

Two probe functions sit beside the strict finders and answer a weaker question — *is there a pixi at
all, and at what version?* — which is what `doctor` and `init` need before they can report or offer
anything. `probePixi()` parses the version from `pixi --version`; `probeCondaPack()` only confirms
that conda-pack runs, because its own `--version` reports `0.0.0` and is unusable as a pin.

</div>

<div class="h4-section">

#### Installing the toolchain, and verifying it

`init` prepares a workspace without touching the network. When pixi or conda-pack is missing it
*offers* to install them and downloads nothing until an explicit yes. Without a terminal to answer
the question — CI, a pipe — nothing is installed at all: silence is not consent.

The install sequence for pixi, in `installPixi()`:

1. Select the release asset for this host from a frozen table keyed by `platform/arch`. A host
   outside the table is not a failure — it means the toolchain has to be installed by hand.
2. Determine the expected digest: the value the project has already recorded, when it has one;
   otherwise the checksum pixi publishes beside the archive, which is then returned so the caller
   can pin it.
3. Download the archive into an OS temporary staging directory.
4. Hash the bytes on disk and compare. A mismatch is a hard failure and **nothing is installed**.
5. Unpack through the same guarded extractor the payload uses, so that even a known publisher's
   archive cannot write outside the staging directory.
6. Move the binary into `<toolchainDir>/bin/`, falling back to a copy when staging and destination
   are on different volumes, which is routine on Windows and on CI runners.

| Host | Published asset | Format |
| --- | --- | --- |
| `darwin/arm64` | `pixi-aarch64-apple-darwin.tar.gz` | `tar.gz` |
| `darwin/x64` | `pixi-x86_64-apple-darwin.tar.gz` | `tar.gz` |
| `linux/x64` | `pixi-x86_64-unknown-linux-musl.tar.gz` | `tar.gz` |
| `linux/arm64` | `pixi-aarch64-unknown-linux-musl.tar.gz` | `tar.gz` |
| `win32/x64` | `pixi-x86_64-pc-windows-msvc.zip` | `zip` |
| `win32/arm64` | `pixi-aarch64-pc-windows-msvc.zip` | `zip` |

The digest, once verified, is recorded in the project's config. Every later install — a teammate's
machine, a CI runner — is then checked against a value the project reviewed rather than against
whatever the server serves that day.

**Rejected:** installing silently, and the `curl | sh` convention it would imitate. A packaging tool
whose entire product is verified artefacts cannot begin by running unverified bytes it fetched
without being asked. The consent requirement is also what makes `init` safe to re-run, which is a
property worth more than the keystroke it costs.

Nothing is placed on `PATH`, nothing is installed system-wide, and deleting the toolchain directory
undoes the whole thing.

Reference: `src/build/toolchain.mjs`; `tests/unit/toolchain.test.mjs`.

</div>

<div class="h3-section-initial-part">

### 4.3 conda-pack


conda-pack turns an installed prefix into a relocatable archive. Scrollcase invokes it with four
arguments and no others:

</div>

```js
// src/build/pixi.mjs
export function condaPackArguments(prefix, outputPath) {
  return ['-p', prefix, '-o', outputPath, '--format', 'tar.gz'];
}
```

The version is pinned to `0.9.2` in a single exported constant, beside the code that depends on its
output:

```js
// src/build/toolchain.mjs
export const CONDA_PACK_VERSION = '0.9.2';
```

conda-pack changes the bytes staged into a box, so letting a resolver pick a newer release would
make the same Scrollcase version produce different payloads over time. Changing the pin is a
reviewed Scrollcase release, not an incidental upgrade.

The resulting tarball is extracted into the payload as `venv/`. conda-pack emits the prefix contents
at the tar root, so extracting into `venv/` yields the conda layout — `bin/`, `lib/`, `conda-meta/`
— directly beneath it.

<div class="h4-section">

#### Why conda-unpack is deliberately never run

conda-pack embeds a fixer, `conda-unpack`, intended to be run once at the destination to rewrite the
placeholder prefix into the real installation path. Scrollcase removes it instead of running it.

The measurement that settled this was taken on a probe environment: **zero files carried the build
prefix before running the fixer, and thirty-six after.** Running it at build time would stamp the
build machine's absolute paths into dozens of files that then ship to users — leaking a developer's
directory layout while still being wrong at the user's install location. And running it at the
user's location is not available either, because that would make installation a step that executes
code from inside the box before anything has verified it.

What Scrollcase does instead:

- **Delete the service files that carry the build prefix**: `conda-meta/pixi_env_prefix`,
  `conda-meta/pixi`, `bin/conda-unpack`, `Scripts/conda-unpack.exe`,
  `Scripts/conda-unpack-script.py`.
- **Canonicalise `conda-meta/`** to the four fields that are properties of the package as published
  — `name`, `version`, `build`, `license` — dropping per-file hashes that differ between installs
  and absolute paths into the build machine's package cache. The rule is an allowlist rather than a
  denylist of known-volatile fields, deliberately: a field a future pixi release starts writing
  cannot reintroduce the drift, because it was never eligible to be copied.
- **Settle the symbolic links**, keeping only those the payload rule can prove safe.
- **Repair generated launchers**, rewriting console-script shebangs to resolve Python next to
  themselves rather than at a build path.

A conda-forge prefix imports and runs from any location with no activation environment and no
relocation fixer — proven cold on macOS and Windows, on CPU and GPU, before any of this repair
existed. The repair is therefore about removing leaked build paths, not about making the environment
work.

**Rejected:** `pixi-pack`, which ships packages rather than a tree and needs a per-user install step
plus a bundled unpacker at the other end. The slow step is compression, and it is better paid once
by whoever builds than on every install by everyone.

</div>

<div class="h3-section-initial-part">

### 4.4 The three runtime dependencies


The published package depends on three libraries and nothing else:

| Package | Version | Role |
| --- | --- | --- |
| `tar` | 7.5.22 | Reads the conda-pack tarball into the payload; validates and extracts `tar.gz` scroll assets and toolchain archives |
| `yauzl` | 3.4.0 | Reads and validates box ZIP archives |
| `yazl` | 3.3.1 | Writes the deterministic box ZIP archive |

</div>

The rule behind that list is: reach for a Node built-in before adding a package. Node covers hashing
and signing (`node:crypto`), HTTP (`fetch`), streaming, filesystem work and subprocesses; what it
does not cover is ZIP, in either direction, and TAR. Those three libraries fill exactly that gap.

Two consequences are worth stating explicitly.

**Archive behaviour is a pinned property, not a host property.** Scrollcase never shells out to the
host's `tar`, `unzip`, or PowerShell expansion. A box therefore reads and writes identically on
macOS, Linux and Windows, and a build has exactly the external dependencies `doctor` reports —
pixi and conda-pack — rather than an invisible dependence on whatever archive tools happen to be
installed.

**The archive backend is part of the format.** Each [target adapter](#target-adapter) carries an
`archive` descriptor naming the format, the writer, the reader, the reader used for scroll asset
tarballs, and Zip64 capability. It is declared in the contract rather than inferred, because a
consumer reading a box needs to know what produced it.

::: info Development-only dependencies
`ajv` and `ajv-formats` (schema validation in tests), `json-schema-to-typescript` (type generation),
`typescript`, `vitest` and `@types/node` are development dependencies. None ships to a consumer, and
none is loaded at runtime. Runtime schema validation inside Scrollcase is done by a dependency-free
internal validator reading the shipped schemas — see section 6.
:::

<div class="h4-section">

#### How each is used

**`yazl` — writing.** Entries are added in a stable collected order, with a fixed timestamp
(`2000-01-01T00:00:00Z`), a mode derived from the target adapter rather than from the filesystem,
DOS timestamps forced so no local timezone leaks in, and deflate at a fixed compression level —
except for the paths a scroll declared as already compressed, which are stored instead.
Symbolic links are written as a small entry whose content is the target string and whose mode
carries the symbolic-link type bits — the same two facts every ZIP implementation reads a link back
from. Zip64 structures are emitted only where needed.

**`yauzl` — reading.** Archives are opened with strict file names, entry-size validation, string
decoding and lazy entries. Every entry is classified and validated *before* anything is extracted:
encrypted entries are refused, special entries are refused, names are checked against path
traversal, duplicates and file/directory collisions are refused, link targets over 1024 bytes are
refused, and every link is judged against the payload link rule as received rather than as intended.
Link targets are read once during validation and reused during extraction, so a concurrently
rewritten archive cannot pass the check with one value and extract with another.

**`tar` — reading only.** Used to extract the conda-pack output into the payload, and to validate
and extract `tar.gz` scroll assets and toolchain archives. TAR entries are validated before
extraction and the accepted types are `File`, `OldFile` and `Directory` only: links and special
entries in a TAR are refused outright.

One subtlety belongs here because it is not obvious from the code's shape. When extracting the
conda-pack tarball, links are deliberately extracted in a **second pass**, after every regular entry
is on disk. The extractor refuses to create a link whose target passes through another link, and a
conda prefix trips that condition routinely — a package can ship `current -> <version>` and then
`pkgdata.inc -> current/pkgdata.inc`, which arrives in a plain Python environment that never asked
for that package and made the whole box unbuildable. Deferring link creation resolves it without
weakening anything: creating a link is not traversing one, and the targets are resolved and checked
immediately afterwards, with anything leaving the tree dropped.

Reference: `src/build/archive.mjs`, `installAndPackPixiEnvironment()` in `src/build/pixi.mjs`;
`tests/unit/archive-security.test.mjs`.

</div>

## 5. The contract

`src/contract/` is the single source of truth for what a [box](#box) *is*: which targets exist, how
a target is named, what layout the payload has, which symbolic links it may carry, and the shape of
every document a build emits. Everything else in the repository — the builder, the signer, both
consumers, the command line — is an implementation that must satisfy it.

It is the smallest part of the system and the one with the strictest rules, because it is the part
that other people's code depends on.

<div class="h3-section-initial-part">

### 5.1 Three artefacts that must never disagree


The contract ships three descriptions of the same rules, in three forms, each for a different kind
of consumer:

| Artefact | Location | What it is | Who uses it |
| --- | --- | --- | --- |
| Reference implementation | `src/contract/*.mjs` | The rules as executable code | JavaScript callers, and the builder itself |
| JSON Schemas | `src/contract/schema/*.json`, published at `/schema/v2/*.json` | The machine-readable specification | Validators, editors, any language with a schema library |
| Golden fixtures | `src/contract/fixtures/*.json` | What "agreeing" means, concretely | Implementations in other languages, proving themselves |

</div>

The relationship between them is a rule, not a convention:

**A client written in another language does not import the code. It mirrors the rules and proves the
mirror against the fixtures.**

```text
                        src/contract/
                 the reference implementation
                              |
        +---------------------+---------------------+
        |                     |                     |
   schema/*.json         fixtures/*.json      imported directly by
  machine-readable        golden cases          the builder and the
    specification              |                  Node consumer
        |                      |
        v                      +--------> Node consumer
  generated types              |
  src/contract/types/          +--------> Python consumer
                                            scrollcase_consumer
```

**Rejected:** publishing a shared runtime that every implementation links against. It would make one
language's package manager a dependency of every other language's client, and it would make the
format's rules unavailable to anyone unwilling to take that dependency. Fixtures cost more to
maintain and are the only mechanism that lets two independent implementations be checked against
each other rather than against each other's assumptions.

Two helpers exist so that a caller never has to guess where those artefacts live inside an installed
package:

```js
// src/contract/index.mjs
export function schemaUrl(name) { return new URL(`./schema/${name}.schema.json`, import.meta.url); }
export function fixtureUrl(name) { return new URL(`./fixtures/${name}.json`, import.meta.url); }
```

Both return a `URL` resolved against the module's own location, so they keep working under any
install layout, in a bundler, or from a global installation.

<div class="h4-section">

#### The two entry points

The contract is exposed twice, and the split is load-bearing:

- **`scrollcase/contract`** — the complete surface, including payload decoding, which needs Node's
  `crypto` for hashing.
- **`scrollcase/contract/browser`** — target identity, document naming, the constants, and the
  structural envelope guard. No Node built-in is reachable from it, so it loads in a browser, in a
  Worker, and in Node alike.

A test walks the browser entry point's entire import graph and fails if any module in it reaches a
Node built-in (`tests/unit/package-surface.test.mjs`). The reason is practical: a client that only
needs to compute a [target ID](#target-id) or recognise a document `kind` should not have to bundle
a hashing implementation to do it.

</div>

<div class="h3-section-initial-part">

### 5.2 The target model — `targets.mjs`


<div class="h4-section">

#### A closed matrix

A [target](#target) is `(platform, arch, accelerator)`, plus a CUDA ABI version when the accelerator
is CUDA. The supported combinations are enumerated, not derived:

```js
// src/contract/targets.mjs
const TARGET_ACCELERATORS = {
  macos: { aarch64: ['metal', 'cpu'] },
  linux: { x86_64: ['cpu', 'cuda'] },
  windows: { x86_64: ['cpu', 'cuda'] },
};
```

A target outside this matrix has no defined identifier and cannot be built, signed, or routed. That
is a deliberate refusal rather than a gap: every entry in the matrix implies a
[target adapter](#target-adapter), a conda subdir, a validated payload layout and a tested
relocation path. A combination nobody has proven those for would produce a box whose guarantees
nobody can state.

**Rejected:** accepting an arbitrary triple and failing later, at build time. Failing at identity
time means the failure happens before a scroll is authored, before a lock is solved, and before
anything is downloaded.

</div>

</div>

<div class="h4-section">

#### Target identity

`boxTargetId()` reduces a target to the canonical slug that appears in archive names, object keys,
routes and directory names:

```text
macos-aarch64-metal        macos-aarch64-cpu
linux-x86_64-cpu           linux-x86_64-cuda12.4
windows-x86_64-cpu         windows-x86_64-cuda12.4
```

The rule is `<platform>-<arch>-<accelerator>`, except CUDA, which appends the version with no
separator. Validation happens in a fixed order, and each step exists to make one class of ambiguity
impossible:

1. **The value is an object.** A string or `null` is rejected with a type error rather than
   producing `undefined-undefined-undefined`.
2. **The triple is in the matrix.** The accelerator is looked up through platform and arch, so an
   accelerator valid on one platform is not silently accepted on another.
3. **CUDA carries a version**, matching `^[1-9][0-9]*\.[0-9]+$` — major and minor, no prefix, no
   leading zero in the major component.
4. **Nothing else carries one.** `cudaVersion` on a CPU or Metal target is an error, not an ignored
   field.

Steps 3 and 4 together are what make the slug injective: exactly one target maps to
`linux-x86_64-cuda12.4`, and a target with an irrelevant CUDA version cannot masquerade as a
different one.

</div>

<div class="h4-section">

#### Target adapters

An adapter states what a target implies for the built payload. It is part of the format rather than
an implementation detail, because a consumer unpacking a box relies on that layout to find the
interpreter.

| Field | `macos-aarch64` | `linux-x86_64` | `windows-x86_64` |
| --- | --- | --- | --- |
| `host.platform` / `host.arch` | `darwin` / `arm64` | `linux` / `x64` | `win32` / `x64` |
| `condaSubdir` | `osx-arm64` | `linux-64` | `win-64` |
| `python.payloadRoot` | `venv` | `venv` | `venv` |
| `python.entryPoint` | `venv/bin/python` | `venv/bin/python` | `venv/python.exe` |
| `python.scriptsDirectory` | `venv/bin` | `venv/bin` | `venv/Scripts` |
| `python.executableSuffix` | *(empty)* | *(empty)* | `.exe` |
| `python.launcherKind` | `posix-polyglot` | `posix-polyglot` | `uv-windows-pe` |
| `nativeLibraryInspection` | `otool -L`, `.dylib` `.so` | `ldd`, `.so` | `dumpbin /DEPENDENTS`, `.dll` `.pyd` |
| `validationEnvironments` | `cpu`, `metal` | `cpu`, `cuda` | `cpu`, `cuda` |
| `executionAffectingEnvironmentVariables` | Python controls + `DYLD_INSERT_LIBRARIES` | Python controls + `LD_PRELOAD` | Python controls |
| `selfTestPython` | `assert sys.platform == 'darwin'` | `assert sys.platform.startswith('linux')` | `assert sys.platform == 'win32'` |
| `archive` | shared backend descriptor | shared backend descriptor | shared backend descriptor |

Every adapter is deeply frozen, and `boxTargetAdapters()` hands out a fresh array, so a caller
cannot mutate the format for everyone else in the process.

Three details deserve their own note.

**`validationEnvironments` are how an accelerator is forced.** Each is a small environment map
applied to validation runs — `CUDA_VISIBLE_DEVICES: ''` to force CPU, `CUDA_VISIBLE_DEVICES: '0'` to
force CUDA, `PYTORCH_ENABLE_MPS_FALLBACK: '0'` so a Metal run fails loudly instead of quietly
falling back to CPU. Without that last one, a [parity](#parity) check comparing Metal against CPU
could pass by comparing CPU against itself.

**`executionAffectingEnvironmentVariables` drives diagnostics, not policy.** The shared Python set
is `PYTHONPATH`, `PYTHONHOME`, `PYTHONSTARTUP`, and `PYTHONBREAKPOINT`; the two POSIX loaders add
their platform-specific injection variable. Their presence is reported because it can change which
code runs. No adapter filters them.

**`selfTestPython` is prepended to every self-test**, so the check begins by asserting it is running
on the platform the box claims. A box that somehow reached the wrong operating system fails at the
first line rather than at an import that happens to exist on both.

**`launcherKind: 'uv-windows-pe'` is a frozen wire string.** It reads like a reference to a tool this
project does not use, and it is: the value is inert, and only names a launcher shape. It is recorded
here because it is the single most likely thing in the contract for a well-meaning cleanup to
"correct", and changing it would change the format for every client that already reads it.

</div>

<div class="h4-section">

#### Host and layout assertions

Two guards are exported beside the model, and both are refusals rather than conveniences.

`assertNativeHost(adapter, host)` refuses to build or lock a target on a machine that is not the one
it ships for. There is no cross-compilation: the environment being packed contains native code
solved and installed for one platform, and a self-test run on the wrong host would prove nothing
about the box.

`assertPythonEntryPoint(adapter, entryPoint)` refuses a scroll whose declared interpreter path
disagrees with the adapter's layout. The entry point is not free-form input — it is a fact about the
target — and accepting a disagreement would produce a signed release whose `pythonEntryPoint`
pointed at nothing.

</div>

<div class="h4-section">

#### Two accessors the builder needs

`condaSubdir(target)` maps a validated target to its conda platform subdir, which becomes the single
entry in the generated manifest's `platforms` list.

`pixiAccelerator(scroll)` returns the accelerator descriptor a scroll selects, rejecting target
drift: `metal` and `cpu` need no extra conda knobs — the osx-arm64 build ships MPS support and CPU
is the default build — while `cuda` returns the version that pins a `cuda-version` and declares the
system requirement that makes the solver select GPU builds.

Reference: `tests/unit/contract-targets.test.mjs`.

</div>

<div class="h3-section-initial-part">

### 5.3 The envelope — `document-shape.mjs` and `documents.mjs`


Every signed document Scrollcase emits travels in one envelope. The envelope is a container, not a
type: the type is inside it, discriminated by the payload's `kind`.

</div>

```jsonc
{
  "schemaVersion": 2,
  "payloadEncoding": "base64-json-utf8",
  "payloadBase64": "eyJraW5kIjoic2Nyb2xsY2FzZS5ib3gucmVsZWFzZSIsIn0=",
  "payloadSha256": "7d2c9a41…",
  "signatures": [
    { "algorithm": "ed25519", "keyId": "scrollcase-9f2b7c1e04a83d56", "signatureBase64": "…" }
  ]
}
```

<div class="h4-section">

#### Why the split across two modules

`document-shape.mjs` holds everything that has no reason to depend on Node: the constants, the
namespacing functions, and the structural guard. `documents.mjs` re-exports all of it and adds the
one function that does need Node — payload decoding, which hashes bytes. That is what lets the
browser entry point offer document naming and envelope recognition without pulling in a hashing
implementation.

</div>

<div class="h4-section">

#### The constants are the format

```js
// src/contract/document-shape.mjs
export const BOX_SCHEMA_VERSION = 2;
export const PAYLOAD_ENCODING = 'base64-json-utf8';
export const SIGNATURE_ALGORITHM = 'ed25519';
export const DEFAULT_DOCUMENT_NAMESPACE = 'scrollcase.box';
export const CHANNELS = Object.freeze(['nightly', 'beta', 'stable']);
```

Each is a single point of truth rather than a literal repeated across modules, and each is a value
the wire format commits to. Changing any of them is a `schemaVersion` change, not an edit.

`CHANNELS` is ordered from least to most stable, and the ordering is meaningful: it is the
vocabulary a channel document's `channel` field is closed to, in both the code and the schema, and a
test asserts the two lists are identical.

</div>

<div class="h4-section">

#### Namespacing

```js
// src/contract/document-shape.mjs
const DOCUMENT_TYPES = Object.freeze(['release', 'channel', 'revocations']);
const NAMESPACE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
```

`documentKinds(namespace)` returns the three `kind` discriminators under a namespace, frozen:
`<namespace>.release`, `<namespace>.channel`, `<namespace>.revocations`. `parseDocumentKind(kind)`
inverts it, splitting at the **last** dot — so a namespace may itself contain dots — and returning
`null` for anything that is not a document kind at all rather than throwing, because asking "is this
one of ours?" is a legitimate question with a legitimate negative answer.

An invalid namespace is a `TypeError`, not a sanitised value. Emitting a document under a namespace
that is nearly what was asked for would produce documents a project's own clients silently ignore.

The reason the namespace is a parameter at all: a project that already publishes boxes owns its
namespace, and its installed clients recognise documents by it. A tool that renamed those documents
underneath a publisher would break every client in the field. So `scrollcase.box` is only the
default for a project with no published history to preserve.

</div>

<div class="h4-section">

#### Recognising an envelope, and decoding it

`isSignedBoxDocument(value)` is a **shape check**, and its documentation is emphatic about what it
does not mean: it says the document is worth attempting to verify, never that its signature is good.
It checks the version and encoding constants, the presence and type of the payload fields, and that
the signature array is non-empty and every entry names the right algorithm with a string key ID and
signature.

`decodeDocumentPayload(document)` does three things in a fixed order, and the order is the point:

1. **Refuse `schemaVersion: 1` explicitly**, with the remedy in the message —
   `Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.` A v1 document is not
   reinterpreted, and it is not rejected as merely malformed either; it is named.
2. **Refuse anything that fails the shape check.**
3. **Hash the decoded bytes and compare against `payloadSha256`** *before* parsing them as JSON. A
   truncated or edited document is caught before its contents are read at all.

Only then is the payload parsed and returned — and the return is documented as *still unverified*.
Decoding is not verification: no signature has been checked at this point. Verification is section
7's subject, and it is a separate call that the consumers make before anything acts on a payload.

</div>

<div class="h4-section">

#### Why the payload is base64, not canonical JSON

The payload travels as exact base64-encoded UTF-8 JSON. Verifying a signature therefore means
hashing bytes that were transmitted verbatim.

**Rejected:** canonical JSON. Canonicalisation requires every implementation, in every language, to
agree on key ordering, number formatting, Unicode escaping and whitespace — historically the richest
source of cross-language signature bugs, and a class of bug that surfaces as an unverifiable
document at a user's machine rather than as a test failure. Transmitting the exact bytes removes the
problem instead of solving it once per language. The cost is a slightly larger document and a
payload that is not human-readable without a decode step, which is a fair price for a signature that
means the same thing everywhere.

Reference: `tests/unit/contract-schema.test.mjs`, `tests/unit/v2-migration.test.mjs`.

</div>

<div class="h3-section-initial-part">

### 5.4 The link rule — `links.mjs`


A conda prefix is dense with symbolic links, and what a payload does with them is a security
question dressed as a size question. This module is the whole answer, and it consults nothing but
its arguments.

</div>

<div class="h4-section">

#### The five rules

1. A target is **relative** — never absolute, never a drive letter, never containing a backslash or
   a NUL byte.
2. Resolved against the link's own directory, it **stays inside the payload**: `..` is allowed
   exactly as far as it cannot escape.
3. A link resolves to a **regular file**, never to a directory.
4. **No entry may have a link as a path prefix**, so nothing is ever written *through* a link.
5. Chains **terminate**, within a small bound, without a cycle.

Rule 3 is what keeps the rest small. A directory link is legitimate in a conda prefix —
`lib/python3.1` → `python3.11` is real, and worth about one duplicated standard library — but it is
also the only way an entry can be written through a link and land somewhere its own name does not
describe. Refusing directory links removes an entire class of escape, and leaves rule 4 as a second
lock on a door rule 3 already welded shut.

**Rejected:** carrying directory links, and with them the last few dozen megabytes. Keeping the rule
small enough to state in five lines and prove in two languages was worth more.

**Rejected:** a `schemaVersion` bump when links were first allowed into payloads. The signed
document did not change; only what the archive may contain grew. A consumer predating the rule
rejects a link entry with a clear error rather than misreading it, which is the only thing a version
bump would have bought.

</div>

<div class="h4-section">

#### The implementation

```js
// src/contract/links.mjs
export const MAX_PAYLOAD_LINK_DEPTH = 8;
```

Real prefixes use one or two hops. A longer chain has no legitimate source and is the cheap way to
make resolution expensive, so the bound is part of the rule rather than an implementation limit.

| Function | Question it answers |
| --- | --- |
| `isRelativeLinkTarget(target)` | Is this target *shaped* like one a payload may carry, before resolving anything? |
| `resolvePayloadLinkTarget(linkPath, target)` | Where does this link point, relative to the payload root — or `null` if it may not be carried? |
| `findEntryThroughLink(entries)` | Does any entry in this set have a link as a path prefix? |
| `findUnresolvableLink(entries)` | Does every link chain in this set end at a regular file present in the same set? |
| `targetCarriesLinks(platform)` | May this target's payload contain links at all? |

`resolvePayloadLinkTarget` walks the target segment by segment, popping for `..` and refusing on
underflow. Checking per segment rather than on the final result is what catches a target that
climbs out of the payload and back in — a path that looks contained once resolved but escaped on the
way. It also refuses a link that resolves to itself.

`findUnresolvableLink` follows each chain against the entry set, and refuses it at a directory, at
nothing, at itself, or past the depth bound. One subtlety: a directory can exist *implicitly*,
through its children, without an entry of its own, so the set of directories is computed from every
entry's path prefixes before any chain is followed. Checking only for an explicit directory entry
would let a link to an implicit directory through.

`targetCarriesLinks(platform)` returns false for Windows. Creating a symbolic link there needs
Developer Mode or elevation, so a Windows box materialises every link rather than producing an
archive that fails to extract on an ordinary machine.

</div>

<div class="h4-section">

#### Applied three times

The same rule runs at three points, against three different sources of truth:

| Where | Against what | Why again |
| --- | --- | --- |
| Builder, `src/build/pixi.mjs` | The real filesystem, with `realpath` | It can, and a materialised link is cheaper to produce than to reject |
| Archive writer, `src/build/archive.mjs` | The entry set about to be written | Shipping a box a consumer must reject is worse than not building one |
| Every consumer | The archive **as received** | No consumer trusts the builder; a box assembled by hand gets no benefit of the doubt |

That nothing here touches the filesystem is what makes three applications possible. A rule that
consulted the disk would give three different answers on three machines; a purely lexical rule gives
the same answer everywhere, which is what lets the builder, the Node consumer and the Python
consumer apply one rule rather than three approximations of it.

Reference: `tests/unit/contract-links.test.mjs`, `tests/unit/archive-security.test.mjs`.

</div>

<div class="h3-section-initial-part">

### 5.5 The payload digest — `payload-digest.mjs`

A release commits to `archive.sha256`, which proves every payload byte — for as long as the archive
exists. An application that installs a box once and runs it for months has deleted it, and
`installedSizeBytes` is a free-space figure rather than an identity. So a box also carries a list.

</div>

<div class="h4-section">

#### A list, not a snapshot

The payload holds one file, `payload-digest.v1`, with one record per entry: its path, whether it is a
file or a [link](#symbolic-link), and the SHA-256 of its content. The release signs the SHA-256 of
that list, so the signed document grows by one field rather than by the megabytes a per-file table
would add to a prefix holding twenty thousand files.

That indirection is also what makes verification a closed question. A verifier walks the **list**,
never the directory, so anything the list does not name is never visited: the `__pycache__` Python
writes on first import, the model cache a caller fills after extraction, a file an application writes
into its own working directory. Those are invisible by construction, not by an exclusion list that
would have to be guessed at and kept in step.

**Rejected:** hashing a walk of the installed tree into a single root value, with no list at all. It
reads as the same guarantee for a smaller format, but the directory is then the input, so every one
of those legitimate extra files makes an honest box fail.

</div>

<div class="h4-section">

#### What a record leaves out

| Omitted | Why |
| --- | --- |
| Mode | `archiveFileMode` synthesises `0o755`/`0o644` from the target and the path instead of preserving what the packed prefix carried, so observed modes could never match an extracted tree and canonical ones would hash what the release already states. Windows extraction skips `chmod` entirely |
| Modification time | The payload is stamped with one fixed instant before archiving, but no extractor restores it; installed files carry the wall-clock of their install |
| Directories | Neither the entry collector nor the archive writer represents one, so an empty directory is already lost between build and install |

A link is hashed by its target string rather than opened. Following it would record the target's
bytes a second time under the link's name, and would make a link indistinguishable from a copy —
which is the distinction the record's kind byte exists to keep.

Records are sorted by their own bytes rather than by their paths compared as strings. The two are
the same ordering, because a path cannot contain NUL and NUL sorts below every byte a path can hold.
Only one of them is unambiguous across languages: comparing strings asks each implementation to agree
on what a string is, and this repository's own two already disagree above the Basic Multilingual
Plane, where JavaScript orders by UTF-16 code unit and Python by code point.

Reference: `tests/unit/contract-payload-digest.test.mjs`, and the shared vectors at
`src/contract/fixtures/payload-digest-contract.json`.

</div>

<div class="h3-section-initial-part">

### 5.6 The eight schemas


The schemas are the machine-readable specification, written against JSON Schema draft 2020-12.

</div>

| Schema | Title | Describes |
| --- | --- | --- |
| `target.schema.json` | Box target | The `(platform, arch, accelerator)` triple and its CUDA rule |
| `execution.schema.json` | Box execution | The optional, shell-free application entry point |
| `scroll.schema.json` | Box scroll | The declarative build input |
| `box-manifest.schema.json` | Box manifest (`box.json`) | The manifest packed inside the archive |
| `release-manifest.schema.json` | Box release manifest | The immutable description of one built box |
| `channel-manifest.schema.json` | Box channel manifest | The mutable pointer from a channel to releases |
| `revocations-manifest.schema.json` | Box revocations manifest | The signed withdrawal list |
| `signed-document.schema.json` | Signed box document | The envelope all three document types travel in |

<div class="h4-section">

#### How they reference each other

```text
  signed-document ....> release-manifest
                  ....> channel-manifest
                  ....> revocations-manifest

  target -----> scroll, release-manifest, box-manifest,
                channel-manifest, revocations-manifest

  execution --> scroll, release-manifest, box-manifest

  release-manifest --> box-manifest      ($defs: provenance, sha256)

  ---->  a real $ref
  ....>  not a $ref: an opaque base64 payload, resolved after decoding
```

The reference from `box-manifest` into `release-manifest`'s `$defs` is deliberate: `box.json`
carries the *same* provenance block as the release it belongs to, and defining it once is what makes
that literally true rather than approximately true.

The envelope's relationship to the three payload types is dotted because it is not a `$ref`: the
envelope describes an opaque base64 string, and which payload schema applies is decided by the
`kind` inside it after decoding. That indirection is what lets a verifier check integrity before it
knows what it is holding.

</div>

<div class="h4-section">

#### Conventions shared by all of them

**`additionalProperties: false` everywhere, with one deliberate exception.** An unknown field is a
misunderstanding, and accepting it silently would let a typo'd key look like a working
configuration. The exception is `compatibility`, which is open on purpose: a project may declare its
own constraints alongside the defined ones, and the builder copies them through verbatim without
ever interpreting them. The schema states the counterpart obligation — *a consumer that cannot
evaluate a constraint must refuse the box rather than assume it passes.*

**Three reused patterns.**

| `$def` | Pattern | Used for |
| --- | --- | --- |
| `identifier` | `^[a-z0-9]+(?:[-.][a-z0-9]+)*$` | `boxId`, `modelId`, `runtimeId` |
| `sha256` | `^[a-f0-9]{64}$` | Every digest, lowercase hex only |
| `payloadPath` | a negative-lookahead chain | Any path inside the payload |

The `payloadPath` pattern is worth reading in full, because it encodes the path-safety rule at the
schema level rather than leaving it to code:

```text
^(?!/)(?![A-Za-z]:)(?!.*\\)(?!.*(?:^|/)\.\.(?:/|$))(?!.*//).+$
```

Not absolute, not a drive letter, no backslash anywhere, no `..` segment, no empty segment,
non-empty. A path that fails this never reaches the code that would have to reject it.

**`schemaVersion` is `const: 2` in every document schema.** Not a minimum, not a range: a v1
document fails schema validation with the same finality as the code rejects it.

**`weights` and `assets` are paired by `dependentRequired`** in both the release and the box
manifest. Declaring one without the other is a contradiction — on-demand weights with no asset
descriptors, or asset descriptors on a box claiming to be self-contained — and the schema refuses
both directions.

</div>

<div class="h4-section">

#### The scroll

The largest schema, and the only one describing *input* rather than output. Fifteen fields are
required: `schemaVersion`, `scrollVersion`, `boxId`, `modelId`, `runtimeId`, `version`,
`sourceRevision`, `target`, `compatibility`, `pythonVersion`, `pixiVersion`, `pythonEntryPoint`,
`modelCacheSubdir`, `assets` and `selfTest`.

The optional fields are where a scroll expresses intent:

| Field | Purpose |
| --- | --- |
| `$schema` | Associates the file with the published schema, for editor validation and hover help |
| `scrollId` | Provenance identity; derived deterministically as `<boxId>-<targetId>` when omitted |
| `condaDependencyLicenseAudit` | Path to the reviewed licence inventory the build must still match |
| `assetBaseUrl` | Base URL the built archive and its objects are published under |
| `assetArchives` | Downloaded archives to expand into the payload, with `stripComponents` and `removeAfterExtract` |
| `localFiles` | Files copied from the project's own repository, each verified against a declared hash |
| `prunePaths` | Payload paths deleted before packing |
| `weights` | `embed` (default) or `on-demand` |
| `execution` | The application entry point |
| `parity` | The cross-accelerator numerical gate |

Three of these carry a rule worth stating explicitly. `assets` may be empty, but every entry is
size- and hash-checked before use, so a moved or replaced upstream file fails the build instead of
silently changing the box. `localFiles` are hashed for the same reason applied inward: a licence
notice or runtime shim cannot drift from what was reviewed. And `selfTest.files` lists what must
still exist *after* pruning, which is what stops an over-aggressive `prunePaths` from shipping a
broken box.

`parity` requires a script, at least two accelerators, and at least one tolerance. The first
accelerator listed is the reference the others are compared against — conventionally `cpu`, being
the one available everywhere. The tolerances are `absolute`, `relative` and `minimumCosine`, and the
schema explains why more than one exists: absolute guards entries near zero where relative error is
meaningless, and cosine similarity catches a result that drifted in direction rather than magnitude.

</div>

<div class="h4-section">

#### Execution

A closed union of exactly two shapes, both requiring `defaultArgs`:

```jsonc
{ "kind": "python-script", "script": "entrypoint.py",        "defaultArgs": [] }
{ "kind": "python-module", "module": "example_model.main",   "defaultArgs": ["--serve"] }
```

A script is a `payloadPath` — a regular file inside the box. A module is a strict Python dotted
name, `^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$`, which admits no command-line syntax
and no shell fragment. `defaultArgs` are placed before caller-supplied arguments and every item is
passed directly, without a shell.

Absence of the whole block means the box is **intentionally library-only** — a positive statement,
not an omission.

**Rejected:** a shell command. A shell changes what an argument means depending on its contents, and
creates an injection surface at exactly the point where caller-supplied arguments meet signed
metadata. A closed union of two shapes cannot be talked into running something else.

</div>

<div class="h4-section">

#### The release manifest

Thirteen required fields describing one built box, of which three groups matter most.

**`archive`** is `{ format: "zip", url, sha256, sizeBytes }`, all four required. Size *and* hash,
not hash alone: the size is checkable before a byte is read, so a consumer can refuse an
implausible download before spending on it.

**`selfTest`** is `{ pythonImports, timeoutSeconds }` — the import subset a consumer can repeat
after extraction. The schema states plainly that the builder also ran the scroll's Python-code and
file assertions and that those are builder-only, rather than implying the signed check covers them.

**`provenance`** requires all nine of its fields: `scrollId`, `scrollVersion`, `builderRevision`
(exactly 40 hex characters), `sourceTreeDirty`, `sourceRevision`, `pythonVersion`, `pixiVersion`,
`dependencyLockSha256` and `builtAt`. `sourceTreeDirty` is a required boolean rather than an
optional flag, so "clean" is always an assertion somebody made and never the absence of one.

`installedSizeBytes` is optional and is a free-space estimate, not an integrity identity. At build
it is the sum of the logical sizes of every payload file and link, including `payload-digest.v1`;
preparation compares an extracted tree with it, while an attached receipt reports a fresh
measurement of the directory and deliberately does not compare that measurement with the signed
figure. A caller still needs headroom for the archive, temporary copies, allocation units and
filesystem metadata.

</div>

<div class="h4-section">

#### The box manifest

Deliberately a near-copy of the release, minus what only makes sense to a distributor — no `kind`,
no `archive`, no `compatibility` — and sharing the release's `provenance` and `sha256` definitions
by reference.

One asymmetry is worth knowing, because it looks like an oversight and is not: `box.json` constrains
its identifiers only as non-empty strings, while the scroll and the release constrain them to the
`identifier` pattern. Nothing is lost, because verification compares the two documents field by
field — an identifier that passed the release's pattern is the one that must appear in `box.json`.
The narrower check happens where the value originates.

</div>

<div class="h4-section">

#### The channel and revocations manifests

A **channel** is small and mutable: `channel`, `boxId`, `target`, `updatedAt`, `cohortSalt` and a
non-empty `releases` array of `{ version, releaseManifestUrl, rolloutPercentage }`, evaluated in
order, a client taking the first entry whose cohort it falls into. It is signed independently from
releases, so promoting a build never requires re-signing it. `cohortSalt` makes cohort assignment
stable per client and unpredictable across channels, so a staged rollout cannot be gamed by
reinstalling.

A **revocations** document lists `{ boxId, version, target?, reason, revokedAt }`, with `target`
omitted when every target of a version is withdrawn. Its array **may be empty**, and the schema says
why: an empty signed list is a positive statement that nothing is revoked, which a client can
distinguish from a missing or withheld document. That distinction is the difference between "nothing
is revoked" and "somebody prevented you from finding out".

Scrollcase defines and can verify both. Publishing them, and acting on them, belong to whoever
distributes boxes — this is the boundary of section 3, expressed as a format.

</div>

<div class="h4-section">

#### Publication is checked, not assumed

Each schema's `$id` is an absolute `https://scrollcase.dev/schema/v2/<name>` URL, and byte-identical
copies are published under `docs/public/schema/v2/`. Two tests enforce it: one compares every
published file against its source byte for byte, and one asserts that every `$id` and every absolute
`$ref` resolves to a schema that is actually published. A schema referencing a sibling that never
shipped would validate locally and fail for everyone else.

Generation never depends on that host being reachable — the type generator resolves
`scrollcase.dev` URLs back to the files in the tree.

Reference: `tests/unit/contract-schema.test.mjs`, `tests/unit/docs-contract.test.mjs`.

</div>

<div class="h3-section-initial-part">

### 5.7 The golden fixtures


Fixtures are the contract's answer to a question specifications cannot answer on their own: *does
your implementation agree with mine?*

</div>

<div class="h4-section">

#### `target-id-contract.json`

Six valid cases and seven invalid ones, each named. The valid cases pair a target with the exact
slug it must produce; the invalid ones are the combinations that must be rejected:

- CUDA without a version, and CPU or Metal **with** one
- a CUDA version carrying a prefix (`cuda12.4`) or missing its minor component (`12`)
- targets outside the matrix — macOS on Intel, Linux on arm64

This is what other-language implementations validate their mirrors against, and it is why the
seven invalid cases matter more than the six valid ones. Agreeing about what works is easy;
agreeing about what must fail is where independent implementations drift.

</div>

<div class="h4-section">

#### `consumer-conformance.json`

Sixty-six language-neutral semantic cases shared by the Node, Python and Rust consumers, plus
twenty-eight error patterns each case's failure message must match. The cases cover valid preparation
under both signing paths, every tampering scenario, a v1 document refused by name, unsafe archive
entries, extraction collisions, per-platform entry points, attachment across process restarts,
installed-payload verification, argument ordering, stream forwarding, exit codes and signals,
temporary-directory cleanup, on-demand asset failures, signed environment agreement, precedence,
masking, explicit value reveal, and report parity across preparation, attachment, payload
verification, and execution.

Error *patterns* rather than exact strings, deliberately: two languages should agree on what went
wrong without being forced to phrase it identically. Section 8 covers the cases in detail — they
describe consumer behaviour, and are listed here because the fixture is part of the contract rather
than of either consumer.

</div>

<div class="h4-section">

#### `fixtures/examples/`

Seven complete, valid documents — a scroll, a scroll on the pixi substrate, a box manifest, a
release manifest, a channel manifest, a signed release, and the public key that signed it. They
serve as schema conformance evidence and as a starting point for an implementer.

The signed example earns its keep twice over: one test decodes it and validates the payload against
the release schema, and another **verifies its actual ed25519 signature against the shipped public
key**. A fixture that merely parsed would prove nothing about signing; this one fails if the
signature scheme, the payload encoding or the key format ever changes underneath it.

</div>

<div class="h3-section-initial-part">

### 5.8 Generated types


Two surfaces are generated, both by `npm run types`, and neither is ever hand-edited.

</div>

**Contract types** — `scripts/generate-contract-types.mjs` compiles the eight schemas into
`src/contract/types/index.d.ts`:

| Schema | Generated type |
| --- | --- |
| `target.schema.json` | `BoxTarget` |
| `execution.schema.json` | `BoxExecution` |
| `scroll.schema.json` | `BoxScroll` |
| `box-manifest.schema.json` | `BoxManifest` |
| `release-manifest.schema.json` | `BoxReleaseManifest` |
| `channel-manifest.schema.json` | `BoxChannelManifest` |
| `revocations-manifest.schema.json` | `BoxRevocationsManifest` |
| `signed-document.schema.json` | `SignedBoxDocument` |

The type names are declared explicitly rather than derived from file names, so that renaming a
schema file cannot silently rename a type somebody imports.

**Runtime declarations** — `scripts/generate-runtime-types.mjs` runs TypeScript over the JSDoc
already reviewed beside each function, emitting `.d.mts` files for the complete dependency closure
of the five public entry points. It compiles a declaration-free staging copy first: otherwise
TypeScript would see the previously committed declarations beside the JavaScript and treat them as
inputs, making regeneration depend on the output it is meant to replace.

Both outputs are **committed**, which is why the package needs no build step and why `npm publish`
ships only reviewed files. Both generators have a `--check` mode, run by the test suite: a schema
change or an API change that was not accompanied by a regeneration fails the suite instead of
shipping stale types.

The principle is the same one behind the licence inventory. Types are a *projection* of the schemas,
never a second definition of the format, exactly as the inventory is a projection of the lock rather
than a document maintained beside it. Anything maintained in two places is eventually maintained in
one.

::: danger Do not hand-edit
`src/contract/types/index.d.ts` and every `src/**/*.d.mts` are generated. Regenerate with
`npm run types`. An edit to either survives exactly until the next regeneration, and fails the suite
in the meantime.
:::

Reference: `tests/unit/package-surface.test.mjs`.

<div class="h3-section-initial-part">

### 5.9 What the contract deliberately does not contain


The absences are as designed as the contents:

- **No network access, and no filesystem access** beyond resolving `URL`s for schemas and fixtures.
  Every rule here is a pure function of its arguments.
- **No policy.** The contract says what a valid channel document looks like; it does not say which
  channel to follow. It says what a revocation is; it does not act on one. It defines
  `compatibility` as an open object; it never evaluates a constraint.
- **No cryptographic dependency.** Hashing and signing use Node's own `crypto`, and the browser
  entry point reaches neither.
- **No default that encodes anyone's deployment.** The one default it does carry — the
  `scrollcase.box` namespace — exists precisely so a project can replace it.

</div>

Everything the contract omits is something a consumer supplies. That is what makes the same format
usable by a desktop application, an internal artefact service and an air-gapped installer without
any of them inheriting the others' assumptions.

## 6. The build pipeline

`src/build/` is where a [scroll](#scroll) becomes a [box](#box). It is the largest layer in the
repository, and almost all of it exists to make one command — `build` — produce an artefact whose
properties can be stated without qualification.

This section walks the pipeline in execution order first, then every module that serves it.

<div class="h3-section-initial-part">

### 6.1 The ordered stages of `build`


`buildBox()` in `src/build/box.mjs` is the whole pipeline, written as one linear function. That is
deliberate: the order *is* the design, and a reader who wants to know what happens before the
interpreter first runs should be able to see it without following a call graph.

</div>

```text
    validate            assemble             prove              publish
  +----------+       +------------+      +------------+     +-------------+
  | 1  2  3  | ----> | 4  5  6  7 | ---> | 8  9 10 11 | --> | 12 13 14 15 |
  +----------+       +------------+      +------------+     +-------------+
   nothing has        the payload         nothing that        the archive is
   been mutated       is built and        failed a check      sealed, signed
   yet                pruned              can ship            and staged
```

| # | Stage | Module | State and files touched |
| --- | --- | --- | --- |
| 1 | Read and validate the scroll | `scroll.mjs` | Reads `scrolls/<boxId>/<targetId>/scroll.json`; resolves the adapter |
| 2 | Validate the build options | `box.mjs` | Channel in `CHANNELS`; weights mode; on-demand refuses `assetArchives` |
| 3 | Refuse an unusable host, toolchain or tree | `targets.mjs`, `pixi.mjs`, `scroll.mjs` | `assertNativeHost`; pinned pixi and conda-pack located; `pixi.lock` present and hashed; git revision read, dirty tree refused |
| 4 | Prepare the build tree | `box.mjs` | Removes and recreates `<buildDir>/<scrollId>/payload/`; clears the target's object directory under `dist/` |
| 5 | Solve, pack and relocate | `pixi.mjs`, `launchers.mjs` | Installs into a build-local pixi workspace, packs it, extracts into `payload/venv/`, repairs it, deletes the workspace and tarball |
| 6 | Stage assets | `assets.mjs` | Downloads verified assets, copies verified local files, expands asset archives — the downloads and the archives only when weights are embedded, the local files always |
| 7 | Prune | `box.mjs` | Deletes each `prunePaths` entry from the payload |
| 8 | Licence inventory | `licenses.mjs` | When the scroll declares a reviewed audit: recomputes from the lock, compares against it, writes `payload/THIRD_PARTY_NOTICES/conda-distributions.json` |
| 9 | Post-prune integrity | `box.mjs`, `execution.mjs` | Every `selfTest.files` entry still exists, except an asset deferred by `on-demand`; execution names a real script or discoverable module |
| 10 | Self-test | `box.mjs` | Runs the adapter's own entry point — `payload/venv/bin/python -c …`, or `venv/python.exe` on Windows — with the target's validation environment |
| 11 | Parity | `parity.mjs` | Runs the declared check once per accelerator and enforces the tolerances |
| 12 | Describe, commit, normalise, measure | `box.mjs`, `filesystem.mjs` | Writes `payload/box.json`, writes `payload-digest.v1` without listing the list itself, records its hash for the release, stamps every entry with the fixed mtime, and sums the installed size |
| 13 | Archive | `archive.mjs` | Writes `<buildDir>/<stem>.zip` deterministically; hashes and measures it |
| 14 | Sign | `sign/index.mjs` | Signs the release, hashes the signed document, signs a channel pointer at 100% |
| 15 | Publish-ready move | `assets.mjs` | Moves archive and release into `dist/boxes/<boxId>/<version>/<targetId>/`, writes `dist/channels/<boxId>/<channel>/<targetId>.json` |

Several properties of that order are load-bearing.

**Everything that can refuse the build does so before anything expensive.** Stages 1 to 3 cost
milliseconds and can each end the build; stage 5 costs minutes and gigabytes. A wrong host, a
missing lock, a pixi at the wrong version and a dirty tree are all caught before a single package is
downloaded.

**The build tree is destroyed before it is used.** Leftovers from a previous build would otherwise
end up inside the archive, which is both a correctness bug and a determinism bug:

```js
// src/build/box.mjs
await rm(buildDir, { recursive: true, force: true });
await rm(objectDir, { recursive: true, force: true });
await mkdir(payloadDir, { recursive: true });
```

**Pruning happens before every check that could catch an over-prune.** Stage 9 asks whether the
files the box needs at run time are still present, and stage 10 asks whether it can still import
what it claims. Neither would mean anything if pruning came after them.

**The self-test runs before the payload can become an archive.** This is the step that earns the box
its name: the modules are imported by the payload's *own* interpreter, in the payload directory,
under the target's validation environment.
The scroll's declared environment is present too; target validation is layered last so it cannot be
disabled by a declaration.

**Parity runs after the self-test, never before.** There is no point comparing accelerators in a box
that cannot import its dependencies in the first place.

**Nothing is written twice.** The archive and the release document are *moved* into the directory a
publisher uploads, not copied, so the only copy that exists is the one that gets published and there
is no second name for the same bytes.

<div class="h4-section">

#### The distribution tree

`build` writes into two places under the workspace's `dist/` directory, and the split is deliberate:

```text
.scrollcase/dist/
├── boxes/example-box/1.0.0/macos-aarch64-metal/
│   ├── <archive-sha256>.zip
│   └── <release-document-sha256>.release.json
└── channels/example-box/beta/
    └── macos-aarch64-metal.json
```

`boxes/` is the tree that goes under the asset base URL verbatim — the same prefix the signed
documents write into their own URLs, so uploading it is a copy rather than a mapping. `channels/` is
separate because a channel is not part of any one version: it is a pointer that moves to the next
one, and filing it under `1.0.0` would leave a stale copy claiming to be current the moment `1.0.1`
ships.

Both objects are [content-addressed](#content-addressed) by their own hashes, which makes the whole
chain verifiable end to end:

```text
channel document → release document (by its SHA-256) → archive (by its SHA-256)
```

Content addressing also makes publishing idempotent, and makes it impossible to replace an object
with different bytes under the same URL — the URL contains the hash of the bytes it serves.

</div>

<div class="h4-section">

#### The channel a build emits

A freshly built channel document goes out at `rolloutPercentage: 100`. A staged rollout is arranged
by editing that document, not by the builder: choosing who receives a release is distribution
policy, and section 3 is why it lives outside this tool.

Its `cohortSalt` is derived rather than random:

```js
// src/build/box.mjs
cohortSalt: sha256Hex(Buffer.from(`${scroll.boxId}:${scroll.version}`)).slice(0, 32),
```

A random salt would reshuffle which users receive a release every time the same commit was rebuilt,
which is precisely the class of per-run variation [determinism](#determinism) forbids. Deriving it
from box and version keeps cohort assignment stable across rebuilds while still differing between
releases.

</div>

<div class="h3-section-initial-part">

### 6.2 Reading a scroll — `scroll.mjs`


A scroll is the only input a build accepts, so it is validated completely before anything is
installed.

</div>

`readExactScroll()` performs six checks in order:

1. **The reference is well formed**: exactly `<boxId>/<targetId>`, screened by `safeRelativePath`.
2. **The document validates** against the scroll, target and execution schemas, using the internal
   validator described in 6.4.
3. **Weights and archives are compatible**: `on-demand` with `assetArchives` is refused, because
   those archives are expanded at build time and cannot be deferred.
4. **Every declared path is safe.** One sweep screens `modelCacheSubdir`, every asset path, both
   ends of every asset archive, both ends of every local file, every prune path, every self-test
   file, the execution script, the parity script and the licence audit path.
5. **The directory names agree with the declarations.** The parent directory must equal `boxId` and
   the child must equal the canonical [target ID](#target-id).
6. **The entry point agrees with the adapter**, via `assertPythonEntryPoint`.

Check 5 deserves its reasoning. The layout is `scrolls/<boxId>/<targetId>/`, and the directory names
are *checked context*, not identity: the scroll declares both facts, and the filesystem is required
to agree. That makes every target variant of one box visible together without making a directory
name the source of the box's identity.

`scrollId` follows from the same principle. It is optional input; when a scroll omits it, provenance
derives it deterministically:

```js
// src/build/scroll.mjs
scrollId: scroll.scrollId ?? `${scroll.boxId}-${targetId}`,
```

**Rejected:** requiring `scrollId` to repeat the directory name. That made the filesystem a second
identity layer, and encouraged product-plus-machine directory names even though the scroll already
declares both facts.

<div class="h4-section">

#### Selecting a scroll

`scrollCandidates(name)` accepts three shapes: an exact `<boxId>/<targetId>` reference loads one
scroll; a bare box name expands to that box's target scrolls; omitting the name discovers every
nested scroll in the workspace. Every candidate is validated *before* it is offered, so a misleading
directory never becomes a selectable target, and every directory listing is sorted with
`compareStableStrings` so the order does not depend on the filesystem.

`readScroll()` sits above it and **fails on ambiguity**. A box with more than one target scroll is a
hard error at the library level:

```js
// src/build/scroll.mjs
fail(`Box ${name} has multiple scroll targets (…); use <boxId>/<targetId> or select a target explicitly.`);
```

Only the CLI edge is allowed to ask a person which one they meant. A library that prompted would be
a library that hangs in CI.

</div>

<div class="h4-section">

#### Provenance from git

Two functions read the state a box records about where it came from.

```js
// src/build/scroll.mjs
export function sourceBuildState(cwd) {
  const revision = runResult('git', ['rev-parse', 'HEAD'], { capture: true, cwd });
  if (revision.status !== 0) return null;
  const status = runResult('git', ['status', '--porcelain', '--untracked-files=all'], { capture: true, cwd });
  return { revision: revision.stdout.trim(), dirty: status.stdout.trim().length > 0 };
}
```

`--untracked-files=all` is what makes "dirty" mean what a reader expects: a file that exists but was
never committed makes a build unreproducible exactly as an edited one does, while Git's ignore rules
still keep generated state out of the answer. Returning `null` outside a checkout forces the caller
to handle it explicitly rather than inventing a revision.

`sourceBuildTime(cwd)` takes the build timestamp from the HEAD commit rather than the clock, and
falls back to the Unix epoch outside a checkout — deliberately a constant, since a wall-clock
fallback would reintroduce exactly the nondeterminism this avoids.

</div>

<div class="h3-section-initial-part">

### 6.3 The workspace — `workspace.mjs`


Where a project keeps its scrolls, and where the tool writes what it builds, is the project's
decision.

</div>

A [workspace](#workspace) is declared by `scrollcase.config.json` at the project root,
discovered by walking up from the working directory.

| Path | Default | Holds |
| --- | --- | --- |
| `scrolls` | `scrolls` | Authored scrolls, `pixi.toml` and `pixi.lock` |
| `build` | `.scrollcase/build` | Scratch: the pixi workspace, the payload, the staged archive |
| `dist` | `.scrollcase/dist` | Publishable output: `boxes/` and `channels/` |
| `keys` | `.scrollcase/keys` | Local signing keys |
| `toolchain` | `.scrollcase/toolchain` | The project's own pixi and conda-pack |

Resolution has two precedence rules that are easy to conflate and are not the same.

**Root selection**, highest first: `--project-root`, the directory of an explicit `--config`, the
nearest `scrollcase.config.json` above the working directory, and finally the working directory
itself. An explicitly named config that does not exist is a hard error — silently ignoring it would
hide a typo behind the defaults.

**Path resolution**, highest first: a CLI flag, the config's `paths` entry, the built-in default.
The subtlety is what each resolves *against*:

- a **flag** resolves against the current working directory, because it was typed by a person
  standing in some directory and that is what a shell user expects;
- a **config value** resolves against the project root, so that a config file is portable and means
  the same thing from any working directory.

The resolved workspace is frozen, and installed once per process by `configureWorkspace()`. Modules
read it through `getWorkspace()` rather than at import time, which is what lets an entry point
configure paths from flags before anything downstream observes them. `resetWorkspace()` exists as
the test seam.

A config is shape-checked on read: a malformed JSON document, a non-object, an unknown `paths` key
or a non-string path each fail with the file named. An unknown key is refused rather than ignored,
for the same reason `additionalProperties: false` is the schema default — a typo that looks like it
worked is worse than an error.

**Rejected:** deriving paths from the tool's own location on disk. That only works while the tool
lives inside the project it serves, and Scrollcase must run from anywhere against any project that
declares a workspace.

<div class="h3-section-initial-part">

### 6.4 Runtime schema validation — `schema-validation.mjs`


Scroll structure is validated at runtime, from the shipped schemas, before tool discovery or any
build-directory mutation. The validator is written from scratch, in 194 lines, and implements the
subset of JSON Schema 2020-12 the shipped schemas use: `$ref` (local pointers and absolute
registered `$id`s), `const`, `enum`, `type`, `minLength`, `pattern`, numeric bounds, `minItems`,
`items`, `minProperties`, `required`, `properties`, `additionalProperties: false`,
`dependentRequired`, `allOf`, `oneOf`, `if`/`then`/`else` and `not`.

</div>

**Rejected:** taking Ajv as a fourth runtime dependency. Ajv is excellent and remains a *development*
dependency, used in the test suite where a second opinion about the schemas is worth having. Adding
it to the runtime would widen the installed surface of every consumer for one narrow job.

The module's most important property is stated in its own header: *the schemas remain the source of
truth; this module deliberately contains no scroll field list.* A validator that enumerated fields
would be a second definition of the format, and the two would drift.

It returns the **first** disagreement as a human-readable string with a JSON-pointer-like path
(`$.assets[2].sha256 does not match the required pattern`), rather than a list. A scroll author
fixing one problem at a time is better served by one clear message than by a cascade caused by the
first.

<div class="h3-section-initial-part">

### 6.5 Building the environment — `pixi.mjs`


Section 4 covered the three pixi invocations, the conda-pack arguments and the refusal to run
`conda-unpack`. What remains is what happens to the extracted tree, which is where relocation
actually becomes true.

</div>

`installAndPackPixiEnvironment()` runs seven steps:

1. **Stage a build-local pixi workspace.** The manifest and lock are copied side by side into
   `<buildDir>/pixi-workspace/`, so the resulting `.pixi/envs/default` prefix is build-local and
   never lands inside the tracked scroll directory.
2. **Install and pack.** `pixi install --frozen`, then `conda-pack -p <prefix> -o <tarball>
   --format tar.gz`.
3. **Extract into `payload/venv/`**, using the pinned Node `tar` implementation, with links
   deferred to a second pass.
4. **Delete the service files** that carry the build prefix.
5. **Canonicalise `conda-meta/`.**
6. **Settle every symbolic link.**
7. **Repair the generated launchers**, then delete the multi-gigabyte workspace and the tarball.

The order of the last three matters and is documented in the code: links are settled *before*
launcher repair, so the repair walks a tree whose shape is final and rewrites each script's bytes
exactly once, under its own name rather than once per alias.

<div class="h4-section">

#### Deferred link extraction

Links cannot be created during extraction. The extractor refuses a link whose target passes through
another link — a defence against writing content through a link, and not negotiable — and a conda
prefix trips that condition routinely. One package ships `current -> <version>` and then
`pkgdata.inc -> current/pkgdata.inc`, and it arrives in a plain Python environment that never asked
for it, which made the whole box unbuildable.

So links are collected during extraction and created in a second pass, once every regular entry is
already on disk:

```js
// src/build/pixi.mjs
const deferredLinks = [];
await tar.x({
  file: packPath, cwd: venvDir, gzip: true, preservePaths: false, strict: true,
  filter: (entryPath, entry) => {
    if (entry.type !== 'SymbolicLink') return true;
    deferredLinks.push({ path: safeRelativePath(entryPath), target: String(entry.linkpath) });
    return false;
  },
});
```

Creating a link is not traversing one, and every deferred target is resolved and checked immediately
afterwards. The pass is sorted, so the tree is built identically whatever order the tar happened to
list its entries in, and a regular entry already occupying a path wins over a link to it: content
beats an alias.

</div>

<div class="h4-section">

#### Canonicalising `conda-meta/`

Per-package records are written by the *installer*, not by the package, and two installs of the
identical lock do not produce identical ones. They also carry absolute paths into the build
machine's package cache. Scrollcase keeps four fields and discards everything else:

```js
// src/build/pixi.mjs
const CONDA_RECORD_FIELDS = Object.freeze(['name', 'version', 'build', 'license']);
```

`build` earns its place because name and version do not identify a conda binary: one version is
published in many builds, and a CPU and a CUDA build of the same library can differ in nothing else.
All four are properties of the package *as published* rather than of the install that placed it,
which is what makes them stable across rebuilds.

The rule is an **allowlist**, deliberately, rather than a list of known-volatile fields to strip. A
field a future pixi release starts writing then cannot reintroduce the drift, because it was never
eligible to be copied in the first place. Anything in the directory that is not a record — conda's
`history` log — is removed entirely.

Nothing inside a box reads any of this: conda is never shipped inside one, and package versions stay
readable from `site-packages` where a Python tool actually looks.

</div>

<div class="h4-section">

#### Settling the links

`settleSymlinksInPlace()` walks the tree in sorted order and, for each link, supplies the filesystem
facts the contract rule needs and applies its answer:

| Situation | Action |
| --- | --- |
| Dangling, or unstattable | Removed |
| Resolves outside the prefix | Removed — it would drag a host file into the box |
| Target is a directory | [Materialised](#materialise) recursively, then walked again |
| Target is a file and the rule permits carrying it | Kept as a link |
| Anything else | Materialised as a copy, preserving the mode |

The walk is sorted because whether a link may be kept can depend on what an earlier entry became,
and `readdir` order is the filesystem's business — two builds must settle the tree identically.

`keepsAsLink()` then asks the decisive question, and asks it twice:

```js
// src/build/pixi.mjs
const resolved = resolvePayloadLinkTarget(relativeLink, rawTarget);
if (resolved === null) return false;
// The lexical answer and the filesystem's answer must agree.
```

The **raw** target is what gets archived, so it is what must satisfy the lexical rule. The
filesystem is then asked whether following it really lands inside the prefix, at a regular file.
The two can disagree when the target is reached through another link — precisely the case a purely
lexical check cannot see — and both must say yes.

</div>

<div class="h3-section-initial-part">

### 6.6 Repairing launchers — `launchers.mjs`


Console scripts generated at solve time (`tqdm`, `isympy`, `f2py`, …) carry the build machine's
absolute interpreter path in their [shebang](#shebang). That path means nothing on a user's machine,
and shipping it leaks a developer's directory layout.

</div>

The repair rewrites each affected script to resolve Python next to itself:

```sh
#!/bin/sh
'''exec' "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/python" "$0" "$@"
' '''
```

This shape is a **shell trampoline**: `/bin/sh` runs the second line, which re-executes the file with
the interpreter sitting beside it, and Python then reads the same two lines as a triple-quoted string
and ignores them. It exists because a direct absolute shebang can exceed the POSIX length limit, and
because there is no way to write "the interpreter next to this file" in a shebang at all.

Two details in the implementation are easy to get wrong and are handled explicitly:

- **The whole file is searched for a build path, not just line one.** A trampoline hides the path
  below the first line, so a first-line-only check would miss exactly the scripts most likely to
  carry one. The forbidden set is the prefix, the pixi workspace and the payload directory.
- **An existing trampoline is unwrapped before rewriting.** The header closes its quote either on
  its own `' '''` line or at the end of the same line, so the parser scans forward to whichever line
  closes it and keeps only the Python body.

Only POSIX launchers are repaired. Windows console scripts are executables, not text with a shebang,
and are handled by the launcher shape the adapter records.

<div class="h3-section-initial-part">

### 6.7 Staging assets — `assets.mjs`


Every [asset](#asset) is declared with a size and a SHA-256 in the scroll, and nothing enters the
payload before both match. That is what makes a box reproducible even though its inputs live on
servers outside anyone's control: if an upstream file is moved, replaced or silently re-uploaded,
the build fails instead of quietly producing a different box under the same version.

</div>

<div class="h4-section">

#### `downloadVerified`

The interesting part is resumption, because model weights are large enough that a connection reset
near the end of a multi-gigabyte transfer is a real event rather than a hypothetical one.

```text
destination exists?  →  reuse only if size AND hash match
                     ↓
loop (max 5 attempts):
  resumeAt = size of <destination>.part, or 0
  fetch with Range: bytes=<resumeAt>-  when resumeAt > 0
  append only if the server answered 206; a 200 overwrites
  on network error: wait 2000 × attempt ms, retry
                     ↓
size must equal sizeBytes  →  hash must equal sha256  →  rename .part into place
```

Four decisions are worth naming.

**The `.part` file is renamed into place only after the hash matches.** An interrupted or corrupted
transfer therefore can never masquerade as a finished asset — a completed file at the destination
path is a verified file, always.

**A 200 response overwrites rather than appends.** A server that ignores `Range` replies with the
whole body and status 200; appending that to a partial would produce a file of the right length made
of the wrong bytes, which is exactly the failure the hash exists to catch and exactly the failure
that is cheapest to avoid.

**A failed HTTP status is not retried.** A 404 or a 403 is a hard error, not a transient drop;
retrying it five times with backoff only delays the message.

**A full-size partial with the wrong digest is deleted.** It cannot be resumed — asking for bytes
after its end would either fail forever or append unrelated data — so removing it lets the next
build start from byte zero and recover from a corrupt mirror response.

This is deliberately **not** a cross-process cache. The build scratch tree is recreated at process
start, so resumption is scoped to one download operation, and the documentation says so rather than
implying a persistence that does not exist.

</div>

<div class="h4-section">

#### `copyVerifiedLocalFile` and `expandAssetArchive`

Local files are copied from the project's own repository and hashed against the scroll's declaration
first, so a licence notice or a runtime shim cannot drift from what was reviewed.

Asset archives are listed and validated before extraction — the archive-slip defence described in
6.12 — and `stripComponents` insists on finding exactly one top-level directory to strip, so a
surprising layout fails loudly rather than producing a wrong tree. The compressed original is
removed after expansion unless the scroll asks otherwise, since it is dead weight inside the payload
once unpacked.

</div>

<div class="h4-section">

#### `moveIntoPlace`

A box archive is measured in gigabytes, so publishing renames rather than copies: on one filesystem
the bytes never move at all. The copy-and-remove fallback exists for a project that points its build
and dist directories at different volumes, where `rename` cannot work.

</div>

<div class="h3-section-initial-part">

### 6.8 The licence inventory — `licenses.mjs` and `audit.mjs`


The inventory is derived from the committed [lockfile](#lockfile) rather than from the installed
tree. The lock already carries an [SPDX](#spdx) licence per package, and `pixi install --frozen`
guarantees the installed set equals it. So the audit is a pure function of a file a human reviews,
computable without a built prefix, and unable to drift from what was approved.

</div>

That is what lets `audit` run in a second, with no toolchain and no network, so licence review
happens when dependencies change rather than at the end of a multi-gigabyte build.

<div class="h4-section">

#### Parsing the lock

`lockedCondaDistributions()` scans the lock's `packages:` section directly rather than taking a
transitive YAML dependency — the structure is regular and machine-generated, a list of
`- conda: <url>` or `- pypi: <url>` items each followed by indented `key: value` fields.

For conda entries, name and version come from the package filename rather than from the record:

```js
// src/build/licenses.mjs — parseCondaPackageReference
// conda names may contain '-', but version and build never do, so they are the last two segments.
```

Two rules keep the result honest. A package whose licence is absent or literally `UNKNOWN`
**fails the parse outright** — an unlicensed dependency is a legal problem, not a reporting gap.
And names are kept raw rather than normalised, because conda filenames already carry the canonical
name and normalising would mangle legitimate leading-underscore names such as `_openmp_mutex`.

The result is sorted by name then version, which is what makes the inventory itself deterministic.

</div>

<div class="h4-section">

#### The audit document

`createCondaDependencyLicenseAudit()` produces:

```jsonc
{
  "schemaVersion": 2,
  "kind": "scrollcase.box.dependency-license-audit",
  "targetId": "macos-aarch64-metal",
  "dependencyLockSha256": "…",
  "packages": [{ "name": "…", "version": "…", "declaredLicense": "MIT", "source": "conda" }]
}
```

It carries the lock's hash, so the inventory names the exact input it was derived from, and its
`kind` is namespaced like every other document — a project keeps its own namespace here too.

`validateCondaDependencyLicenseAudit()` compares a reviewed copy against a freshly computed one by
exact JSON equality. During a build, that comparison happens before the inventory is written into
`THIRD_PARTY_NOTICES/conda-distributions.json`, so a box can only ship an inventory somebody
reviewed.

</div>

<div class="h4-section">

#### `audit.mjs`

The `audit` verb runs the same functions the build runs, so a reviewed audit and the one a build
produces cannot disagree by construction. It adds a summary — package count and licences ranked by
frequency — and one policy decision:

**Writing is explicit.** `--write` overwrites the reviewed file; the default compares and fails on
any difference. Making writing the default is precisely how an unreviewed licence change would slip
through.

</div>

<div class="h3-section-initial-part">

### 6.9 Execution prerequisites — `execution.mjs`


Execution metadata names either one regular payload file or one dotted Python module. Proving that
name resolves must not involve running anything, and this module is how.

</div>

For a **script**, the check is set membership: the path, screened by `safeRelativePath`, must be a
regular entry in the payload.

For a **module**, the check enumerates the places Python would find it and asks whether any exists
as a regular file:

```js
// src/build/execution.mjs
const relativeCandidates = [`${modulePath}.py`, `${modulePath}/__main__.py`];
const standardLibrary = adapter.platform === 'windows'
  ? 'venv/Lib'
  : `venv/lib/python${pythonMajorMinor(pythonVersion)}`;
const roots = ['', standardLibrary, `${standardLibrary}/site-packages`];
```

Both `foo/bar.py` and `foo/bar/__main__.py` are accepted, since `python -m` runs either. The roots
are the payload root, the standard library and `site-packages`, and the Windows standard library
lives at `venv/Lib` rather than under a version-named directory — one of the three-target
differences that no single-host test suite can catch.

**Rejected:** proving a module by importing it. Importing runs `__init__.py`, which is application
code, and would turn validation into execution before the trust chain has finished. The whole point
of a static check is that the same function can be used by the builder *and* by a consumer that has
not yet decided to trust the box.

That shared use is why the module takes a `files` set rather than a directory: the builder passes
`collectFiles()` output, the verifier passes the ZIP entry classification, and both are the same
representation.

<div class="h3-section-initial-part">

### 6.10 Self-test and parity


<div class="h4-section">

#### The self-test

```js
// src/build/box.mjs
run(interpreter, ['-c', code], {
  cwd: payloadDir,
  env: mergeEnvironmentLayers(
    adapter.platform,
    scroll.environment ?? {},
    adapter.validationEnvironments[scroll.target.accelerator],
  ),
});
```

Three things make it meaningful. The interpreter is the payload's own, so what is proven is the box
rather than the host. The working directory is the payload, so relative resolution behaves as it
will after extraction. And the environment is the target's validation environment, so a Metal box is
tested with the MPS fallback disabled rather than quietly falling back to CPU. The signed
environment declaration is applied here too, before the target controls, so a bad runtime path fails
the build while accelerator validation remains authoritative.

The code that runs is the adapter's platform assertion, then the declared imports, then the scroll's
optional extra Python. Only the import subset reaches the signed release, with
`timeoutSeconds: 180` recorded as the bound a consumer should apply when repeating it. The scroll's
Python-code and file assertions stay builder-only because they are not part of the signed release,
and claiming otherwise would tell a consumer it had verified something it never saw.

</div>

</div>

<div class="h4-section">

#### Parity — `parity.mjs`

The [parity](#parity) gate runs the declared script once per accelerator, using the declared box
environment followed by each accelerator's validation environment, and compares every run against
the first.

The check script must print a JSON array of numbers, or an object with a `values` array. Three
refusals happen before any arithmetic:

- output that is not JSON, reported with the first 200 characters so the failure is diagnosable;
- an empty or missing `values` array;
- **any non-finite value.** A `NaN` or an infinity is the classic symptom of a broken accelerator
  build, so it is reported as such rather than being allowed to poison the comparison.

`compareValues()` computes three quantities in one pass: the maximum absolute difference, the
maximum relative difference, and the cosine similarity of the two vectors. The relative error is
accumulated only where the reference entry has magnitude:

```js
// src/build/parity.mjs
if (Math.abs(expected) > 0) maximumRelative = Math.max(maximumRelative, absolute / Math.abs(expected));
```

Relative error is meaningless around zero — dividing by a reference of `0` yields infinity for any
discrepancy at all — so the absolute bound is what guards near-zero entries, and cosine similarity
catches a result that drifted in direction rather than in magnitude. That is why the schema allows
three tolerances and requires at least one: they answer different questions about the same
comparison.

`breachedTolerance()` reports which declared bound was exceeded, by how much, and against what. The
first accelerator listed is the reference — conventionally `cpu`, being the one available everywhere
and the least likely to be wrong — and the measurements are returned even when nothing failed, so
they can be recorded as evidence.

The division of labour is the point, and it is the boundary of section 3 applied to numbers:
Scrollcase owns the mechanism and enforces the declared threshold; the project owns the check
script, the fixture, and what closeness means for its model.

</div>

<div class="h3-section-initial-part">

### 6.11 Determinism primitives — `filesystem.mjs`


Two invariants live in this module: every payload tree is enumerated in one stable order and stamped
with one fixed timestamp, and every relative path that will be joined to a directory is screened
against traversal.

</div>

```js
// src/build/filesystem.mjs
export const FIXED_ARCHIVE_TIME = new Date('2000-01-01T00:00:00.000Z');
```

Any fixed instant would do; this one is a recognisable round date safely past the 1980 floor of
DOS/ZIP timestamps.

| Function | Role |
| --- | --- |
| `compareStableStrings` | Ordering by code unit, independent of host locale and ICU data |
| `safeRelativePath` | The [path-traversal](#path-traversal) screen, normalised to forward slashes |
| `collectEntries` | The canonical sorted enumeration: files and links, with link targets |
| `collectFiles` | Every payload path, links included |
| `collectRegularFiles` | Only paths backed by their own bytes |
| `payloadSize` | What a box occupies once extracted |
| `validateExtractedTree` | Refuses links and special nodes in an extracted tree |
| `normalizeTree` | Stamps the fixed mtime on every entry |
| `sha256File` | Streaming hash, so a multi-gigabyte archive is never buffered |

Several of these carry a decision that is invisible until it bites.

**Ordering is by code unit, not by locale.** `localeCompare` would make archive entry order depend
on the machine's ICU data, which is a per-host variable and therefore a determinism bug waiting for
a differently configured CI runner.

**Links are classified before directories.** A symbolic link to a directory reports
`isDirectory() === false` from `lstat` but would be walked into by any check that stats rather than
lstats, so the classification order is what keeps the walk from following a link out of the tree.

**`collectFiles` and `collectRegularFiles` are two functions on purpose.** A caller asking "is this
path in the box?" wants a link to count, because a linked path is a path that resolves. A caller
that rewrites bytes must not see links, because writing through one would edit the target twice —
once under its own name and once under the link's. Launcher repair uses the second kind of question.

**`payloadSize` uses `lstat`, not `stat`.** A link costs its own few bytes, not the size of what it
points at. Counting the target would restore on paper exactly the duplication that carrying links
removes from disk, and this number is what a consumer checks free space against.

**`normalizeTree` uses `lutimes`, not `utimes`.** Stamping through a link would stamp its target
once under its own name and again through every link pointing at it.

**Three names are skipped during enumeration**: `__pycache__`, `.DS_Store` and any `.pyc`. Bytecode
caches are written by whichever interpreter happens to run first and are the classic source of a
non-reproducible tree; the third is a macOS artefact that has no business inside a box.

Anything that is neither a regular file nor a permitted link — a socket, a device, a fifo — fails
the enumeration outright, because nothing else can be archived, hashed or relocated meaningfully.

<div class="h3-section-initial-part">

### 6.12 Archiving — `archive.mjs`


The writing side is where [determinism](#determinism) becomes bytes.

</div>

```js
// src/build/archive.mjs
const compressionLevel = isDeclaredUncompressed(entry.path, uncompressedPaths) ? 0 : 6;
zip.addFile(join(payloadDir, ...entry.path.split('/')), entry.path, {
  compress: compressionLevel !== 0,
  compressionLevel,
  mtime: FIXED_ARCHIVE_TIME,
  mode: archiveFileMode(adapter, entry.path),
  forceDosTimestamp: true,
});
```

Every variable that could differ between two runs has been removed. Entry order comes from the
sorted enumeration; the timestamp is fixed and forced into DOS form so no local timezone leaks in;
the compression level is pinned per path, because a different level produces different bytes for
identical input; and the mode comes from the **target adapter** rather than from the filesystem:

| Path | Mode | Reason |
| --- | --- | --- |
| Windows target, anything | `0644` | Windows has no executable bit to preserve |
| The interpreter entry point | `0755` | It must be executable after extraction |
| Anything under the scripts directory | `0755` | Console scripts are executables |
| Everything else | `0644` | |

Reading the mode from disk instead would make the archive depend on the umask of whoever ran the
build.

**Already-compressed paths are stored rather than deflated.** Model weights arrive compressed —
GGUF, safetensors — and deflating them buys nothing while costing real time: measured on
incompressible bytes, level 6 runs at 47 MB/s and produces a result 0.03% *larger* than its input,
and dropping to level 1 recovers 4 MB/s because the search fails either way. Lowering the level is
therefore not a fix; only not compressing is. Which paths those are comes from the scroll and never
from the file: every declared asset is stored automatically, and `uncompressedPaths` names anything
else the project knows to be compressed already, matching a path itself and everything beneath it.
Nothing here opens the file or reads its extension, so the decision depends only on the scroll and
the path — which is what keeps two builds of the same commit byte-identical.

Symbolic links are written as a small entry whose *content* is the target string, under a mode
carrying the symbolic-link type bits — the same two facts every ZIP implementation reads a link back
from. Before any of this, `assertPayloadLinksAreCarryable()` re-applies the contract rule to the
entry set about to be written: a failure there is a bug in Scrollcase rather than bad input, but
shipping a box a consumer must reject is worse than not building one.

Zip64 is emitted only where needed (`zip.end({ forceZip64Format: false })`), so a small box stays
readable by the widest range of tools while a large one is still correct.

<div class="h4-section">

#### The reading side

Nothing inside an archive is trusted before validation. `listZipEntries()` walks every entry and
refuses, in this order: encrypted entries, unsafe names, special entries, link targets over 1024
bytes, duplicate paths, file/directory collisions, links that do not resolve to a file inside the
payload, and any entry that would be written through a link.

Two details matter more than they look.

**Link targets are read during validation and reused during extraction.** Reading the target twice
would let a concurrently rewritten archive pass the check with one value and extract with another —
a time-of-check-to-time-of-use gap in the one place it would be most rewarding to exploit.

**A collision check runs before extraction, not during it.** Two entries with the same path, or a
file where another entry expects a directory, are refused up front rather than discovered when the
second write fails.

TAR is handled more strictly still: only `File`, `OldFile` and `Directory` entries are accepted, so
links and special entries in a scroll asset archive are refused outright. Those archives come from
outside, and the copy that follows extraction would write through any link they contained.

Reference: `tests/unit/archive-security.test.mjs`, `tests/unit/assets.test.mjs`.

</div>

<div class="h3-section-initial-part">

### 6.13 Naming — `identity.mjs`


Three small functions decide where a release's artefacts live relative to everything else:

</div>

```js
// src/build/identity.mjs
boxReleaseStem(release)          // <boxId>-<version>-<targetId>
boxReleaseObjectPrefix(release)  // boxes/<boxId>/<version>/<targetId>
builderVersionFields(source)     // { pixiVersion }
```

Both names are derived from the release's identity fields alone, so the archive, its release
document and the staged objects agree on their location without any of them recording the others'
paths. Whatever a project uses to serve boxes, laying storage out under this prefix means the URLs
inside the signed documents already point at the right objects.

<div class="h3-section-initial-part">

### 6.14 Signing, from the builder's side


The builder signs twice, through one call each, and treats signing as a service it consumes rather
than a concern it implements:

```js
// src/build/box.mjs
const signing = { signerCommand, privatePath, publicPath };
await signDocument(release, signing);
await signDocument(channelDocument, signing);
```

</div>

Everything about how that signature is produced — local key or external signer, the mandatory
payload echo, local re-verification — is section 7's subject. What matters here is the ordering: the
release is signed after the archive exists and has been hashed, and the channel is signed after the
release document exists and has been hashed. Neither document can commit to something that has not
been measured.

<div class="h3-section-initial-part">

### 6.15 Verifying locally — `verify.mjs`


`verify` re-runs a consumer's install-time checks locally, before anything is published. The point
is that a box which would fail on a user's machine fails here instead.

</div>

The trust chain is split without being duplicated. `inspectReleaseDocument()` performs the part
that needs only a release document and trust key; `inspectBoxArchive()` calls it and continues with
the archive. Attachment and installed-payload verification therefore reuse the same interpretation
of signature, schema, kind and target without inventing an option that makes one function's return
shape conditional.

The two functions perform the complete read-only chain in this fixed order:

1. Refuse `schemaVersion: 1` explicitly.
2. Validate the **signed envelope** against its schema.
3. **Verify the signature** against the trusted key.
4. Refuse a payload that is not `schemaVersion: 2`.
5. Validate the **release manifest** against its schema.
6. Confirm the document's `kind` parses as a *release*.
7. Resolve the target adapter and check the entry point against it.
8. Sanity-check `installedSizeBytes` if present.

Those eight steps are `inspectReleaseDocument()`. `inspectBoxArchive()` then continues:

9. Locate the archive — beside the release document, under the hash that document commits to.
10. Check the archive's **size**, then its **SHA-256**.
11. List and validate **every archive entry**.
12. Read `box.json` out of the archive and validate it against its schema.
13. Assert **agreement** between `box.json` and the signed release.
14. Confirm the declared interpreter path resolves inside the archive.
15. Confirm execution metadata names a real script or a discoverable module.

Nothing in that list executes anything from inside the box. Every step is a read, and the expensive
ones come after the cheap ones that could have ended the check.

<div class="h4-section">

#### The agreement check

```js
// src/build/verify.mjs
const AGREEMENT_FIELDS = [
  'schemaVersion', 'boxId', 'modelId', 'runtimeId', 'version', 'target',
  'pythonEntryPoint', 'modelCacheSubdir', 'environment', 'selfTest', 'execution',
  'weights', 'assets', 'provenance',
];
```

Each is compared with `isDeepStrictEqual`, so nested objects — the target, the self-test, the whole
provenance block, the environment map, the asset descriptor list — must agree recursively rather than merely being
present. This is what binds the archive's contents to its signed metadata: the release commits to
the archive by hash, and the archive's own description of itself must match the release.

Only fields that exist in *both* schema-version-2 documents belong in that list. Release-only
transport data — `kind`, `archive`, `compatibility`, `installedSizeBytes`, `payloadDigest` — has no
counterpart in `box.json`, and demanding one would be demanding agreement about a field that does
not exist. The list itself already names and hashes `box.json`; placing its commitment inside that
file would create a recursive value.

</div>

<div class="h4-section">

#### Two entry sets, deliberately

```js
// src/build/verify.mjs
const files = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path));
const resolvablePaths = new Set(entries
  .filter((entry) => entry.kind === 'file' || entry.kind === 'link')
  .map((entry) => entry.path));
```

`box.json` is read *out of* the archive, so it must be an entry with its own bytes. The interpreter
path and the execution target only need to *resolve*, and a link does resolve — to a file inside
this same payload, because the link rule allowed nothing else. Using one set for both questions
would either reject a legitimate interpreter alias or accept a manifest that was only a link.

</div>

<div class="h4-section">

#### Verifying with `--self-test`

With `--self-test`, verification extracts the archive into a temporary directory, checks that the
extracted payload size matches the signed `installedSizeBytes`, recomputes the payload digest when
the release carries one, and only then runs the box's own interpreter against the signed import
subset. This is the pre-publication point that proves the build's list describes what its archive
actually extracts to. The temporary directory is removed in a `finally` block whether or not the
check passed.

It requires a matching native host, through `assertNativeHost`. That is a deliberate limitation
rather than an oversight: running a Linux box's interpreter on macOS proves nothing, and pretending
otherwise would make the strongest check in the tool the least trustworthy.

</div>

<div class="h3-section-initial-part">

### 6.16 Setting up a project


Three modules cover everything before a build: workspace scaffolding, scroll authoring, and the
optional dependencies of the generated consumer templates.

</div>

<div class="h4-section">

#### `project.mjs` — `init` and `doctor`

`initProject()` writes four things and **never overwrites**: `scrollcase.config.json`, a short
`SCROLLCASE.md` project guide, the scrolls directory, and an appended `.gitignore` block. Existing
files are recorded as skipped, so a half-configured workspace can be completed by running the
command again without touching authored input.

The `.gitignore` block is matched by a marker comment:

```js
// src/build/project.mjs
const GITIGNORE_MARKER = '# scrollcase build state';
```

Changing that string would make an already-scaffolded project look unmarked and append the rules a
second time. It is a small thing that a blanket capitalisation pass has already broken once.

`ensureToolchain()` is where consent lives — as an **injected function**, not a terminal read:

```js
if (!await confirm(missing)) return { installed: [], missing, declined: true };
```

The CLI asks a human, a scripted setup passes a flag, and CI without a terminal answers no. Nothing
is downloaded before that call returns true. A present pixi at the *wrong* version counts as missing
when a version was requested, because resolver versions are part of the scroll's reproducibility
contract and `--pixi-version` must install what it promises.

What it records in the project config is the other half of the design:

```jsonc
{
  "toolchain": {
    "pixi": { "version": "0.73.0", "assets": { "pixi-aarch64-apple-darwin.tar.gz": "<sha256>" } },
    "condaPack": { "version": "0.9.2" }
  }
}
```

The first install trusts the checksum published beside the release; every later one is checked
against the value the project committed. A teammate or a CI runner therefore cannot silently receive
different bytes than the ones somebody reviewed.

`diagnose()` — the `doctor` verb — checks the workspace, the scrolls directory, the git checkout,
pixi and conda-pack. Every check **reports rather than throws**, so a user with neither tool learns
both in one run instead of one per attempt, and every failing check carries its remedy.

</div>

<div class="h4-section">

#### `authoring.mjs` — `new scroll`

The only command that authors real project identity, target, versions, compatibility, weights and
execution intent. Its guarantees are atomicity and non-destruction:

- Every material value is validated **before the first write**. A non-terminal call that omits one
  fails rather than guessing.
- The scroll is written into a staging directory beside its destination and moved into place with a
  single `rename`, so an interrupted run leaves no half-written scroll.
- An existing scroll directory is a hard error, and a generated starter script is written with the
  exclusive `wx` flag.
- A generated script's hash is computed **from the exact bytes written to disk**, so the
  `localFiles` declaration cannot describe something other than what was created.
- The generated scroll is validated against the schemas before anything is written at all.

Execution intent is a closed set at this level too — `python-script`, `python-module` or
`library-only` — and a `library-only` scroll declaring a script, a module or default arguments is
refused rather than silently simplified.

`ensureExampleScroll()` creates the disposable `example-box` that `init` offers, through the same
validated authoring path as any real scroll, plus two non-overwriting consumer templates. An
existing target directory is treated as authored input and left untouched, including when a user has
edited the starter.

**Rejected:** treating setup metadata as the project's real scroll, and equally, leaving a newcomer
with an empty directory. The example is explicitly disposable onboarding material; real inputs are
created independently rather than edited from guessed product metadata.

</div>

<div class="h4-section">

#### `consumer-setup.mjs`

Optional installation of the generated templates' dependencies, into the *initialised project* — not
into Scrollcase's managed toolchain. Every command runs from the workspace root.

Two platform realities are handled explicitly. On Windows, `npm` is a `.cmd` shim that `spawnSync`
cannot execute directly, so it is invoked through the command interpreter. On a PEP 668
"externally-managed environment" — the default on modern Linux distributions and Homebrew Python —
`pip install` is retried with `--user --break-system-packages`, which keeps package files out of the
distribution's managed prefix rather than fighting it.

Consent and the Python package source are chosen at the CLI edge and passed in, never read from a
terminal here.

</div>

<div class="h3-section-initial-part">

### 6.17 Process primitives — `process.mjs`


Sixty-six lines, two exported behaviours, and both of them are architecture.

```js
// src/build/process.mjs
export function fail(message) { throw new Error(message); }
```

</div>

**Every validation failure in the tool goes through `fail`.** That is what lets the CLI exit
non-zero with exactly one clear line, and it is why there is no second error path to keep consistent.

`runResult()` wraps `spawnSync` and returns the raw result; `run()` interprets it, distinguishing a
command that could not start from one that exited non-zero, and attaching captured output to the
message when there is any. `mergeEnvironmentLayers()` preserves that inheritance while removing
case-only duplicates on Windows, where `Path` and `PATH` name the same variable; later layers win
deterministically instead of leaving Node's child serializer to choose. That is what lets a
validation environment force an accelerator without discarding everything else, and the
64 MiB buffer is sized for a chatty solver rather than for a prompt.

Both are the **[injection seam](#injection-seam)** the whole test suite depends on. Passing a fake
runner is how the pipeline tests build boxes with no pixi, no conda-pack and no network, while still
exercising the real orchestration code — which is the only way to test a pipeline whose real
execution costs minutes and gigabytes.

<div class="h3-section-initial-part">

### 6.18 The build layer's public surface — `index.mjs`


`scrollcase/build` exports the pieces a project might legitimately need to drive or inspect a build
itself:

| Group | Exports |
| --- | --- |
| Archive | `createDeterministicZip`, `extractZipArchive`, `listZipEntries` |
| Filesystem | `collectFiles`, `fileExists`, `sha256File` |
| Identity | `boxReleaseObjectPrefix`, `boxReleaseStem`, `builderVersionFields` |
| Launchers | `repairPosixLaunchers` |
| Licences | `createCondaDependencyLicenseAudit`, `lockedCondaDistributions`, `parseCondaPackageReference`, `validateCondaDependencyLicenseAudit` |
| pixi | `condaPackArguments`, `findCondaPack`, `findPixi`, `installAndPackPixiEnvironment`, `pixiInstallArguments`, `pixiLockArguments` |
| Process | `fail`, `run`, `runResult` |
| Toolchain | `CONDA_PACK_VERSION` |
| Workspace | `DEFAULT_WORKSPACE_PATHS`, `SCROLLCASE_CONFIG_FILENAME`, `configureWorkspace`, `findWorkspaceConfig`, `getWorkspace`, `resolveWorkspace`, `workspaceOverridesFromArgv`, `workspaceOverridesFromFlags` |

</div>

What is *not* exported is as informative. `buildBox` itself is reached through the CLI rather than
advertised as a library entry point, and the internal orchestration — asset staging, parity, the
self-test — has no public surface. A change to any name in that table is a change to a public API;
a change inside the modules it comes from is not.

## 7. Signing and custody

A box is a file. Anyone can produce a file. What makes one box different from another file with the
same name is that a [release](#release) document commits to its bytes, and that document carries a
signature somebody's key produced. Section 5 described the shape of that document; section 6
described when the builder asks for it. This section describes the part in between: where a key
comes from, what exactly gets signed, how a signature is checked, and how an operator keeps the
private half somewhere Scrollcase never sees.

Two modules do all of it. `src/sign/keys.mjs` owns key material and verification; `src/sign/index.mjs`
owns the choice between signing paths. Together they are under three hundred lines, which is
intentional: cryptographic surface area is a liability, and everything here that could have been an
option is a constant instead.

<div class="h3-section-initial-part">

### 7.1 What the signature is for

A signature answers exactly one question — *did the holder of this key assert this payload?* — and
Scrollcase builds its entire trust chain out of that single answer:

</div>

```text
  trusted public key        keyId + ed25519 public bytes
       |
       |  verifies
       v
  signed document           payloadBase64 + payloadSha256 + signatures
       |
       |  decodes to
       v
  release manifest          archive.sha256, archive.sizeBytes
       |
       |  commits to
       v
  the archive               one exact byte string
       |
       |  contains
       v
  box.json                  must agree with the release, field by field
```

Each link is mechanical. The key verifies the document; the document *is* the release; the release
names the archive by [digest](#digest) and size; the archive contains a [`box.json`](#box-json) that
must agree with the release. A consumer that trusts one public key therefore transitively knows
everything about the box, and nothing in the chain requires trusting the transport, the mirror, the
filesystem, or the builder.

The chain is only as good as its weakest step, which is why the format refuses to let any step be
approximate. A [detached signature](#detached-signature) over "the release, more or less" would be
worthless; the signature is over exact bytes, and those exact bytes are what gets published. Section
5.3 explains why the payload travels as [base64](#base64) rather than as
[canonical JSON](#canonical-json); this section is what consumes that decision.

<div class="h3-section-initial-part">

### 7.2 Generating a key — `keys.mjs`

`scrollcase keygen` produces an [ed25519](#ed25519) pair. There is no algorithm flag, no curve
choice, and no key size: ed25519 is small, fast, deterministic, has no parameter that can be chosen
badly, and is implemented by every runtime a consumer might be written in.

</div>

<div class="h4-section">

#### The pair, and what is written where

```js
// src/sign/keys.mjs
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const publicDer = publicKey.export({ type: 'spki', format: 'der' });
const rawPublicKey = publicDer.subarray(publicDer.length - 32);
```

Two files are written, and they are not symmetrical:

| File | Default location | Contents | Mode |
| --- | --- | --- | --- |
| Private key | `.scrollcase/keys/signing-private.pem` | PKCS#8 PEM | `0600`, then `chmod` again |
| Public key | `.scrollcase/keys/signing-public.json` | JSON: `algorithm`, `keyId`, `publicKeyBase64`, `publicKeyPem` | default |

The private key is written with `mode: 0o600` **and** `chmod`ed to `0600` immediately afterwards.
That looks redundant and is not: the mode passed to `writeFile` is masked by the process umask, so a
permissive umask would widen the file at creation. The second call fixes the mode unconditionally.

The public file carries the key twice on purpose. `publicKeyPem` is what Node's `createPublicKey`
consumes directly; `publicKeyBase64` is the raw 32 bytes, which is the form every non-Node verifier
expects — a Rust client, a browser using WebCrypto, a Python consumer that would otherwise have to
parse PEM to get at the same bytes. An ed25519 SPKI DER is a fixed twelve-byte header followed by
the key, so the raw form is simply the tail of the DER encoding, and both fields are derived from
one export rather than from two independent code paths that could disagree.

</div>

<div class="h4-section">

#### The key ID

```js
// src/sign/keys.mjs
const resolvedKeyId = keyId || `scrollcase-${sha256Hex(rawPublicKey).slice(0, 16)}`;
```

A [key ID](#key-id) is a lookup label: a document's signature says which key to try, and a verifier
finds that key in its trust file. Deriving the default from the key's own bytes makes it stable
across machines, collision-resistant in practice, and free of any registry that would have to exist
somewhere and be kept correct. `--key-id` overrides it for operators whose custody system already
names keys.

**The ID is a hint, never an authority.** Verification looks up the key by ID and then verifies the
signature against that key's actual bytes. A document claiming a key ID it was not signed with fails
exactly like a document with a corrupt signature.

</div>

<div class="h4-section">

#### Why `--force` exists, and why it is dangerous

```js
// src/sign/keys.mjs
if (await fileExists(privatePath) && !force) {
  fail(`Signing key already exists: ${privatePath}. Pass --force to rotate it explicitly.`);
}
```

Overwriting a signing key is a legitimate operation — keys get rotated, and a development key gets
replaced by a real one. Doing it *silently* is not, because a key has no record of what it signed.
After an accidental overwrite, every document produced with the previous key still exists, still
looks well-formed, and no longer verifies against anything the operator holds; there is no way to
enumerate the affected documents, and no way to re-sign what has already been distributed.

::: danger `keygen --force` is not a way to fix a key mismatch
A "private and public signing keys do not match" error means the two files came from different
pairs. Regenerating makes the message go away by making a *new* identity, which invalidates every
document signed with the old one instead of repairing anything. Find the matching public key.
:::

::: warning Private keys never leave the machine
The private key lives under `.scrollcase/keys/`, which the workspace marks as generated state. It is
never printed, never logged, never included in a box, and never committed. Nothing in Scrollcase
reads it except the local signing path, and the external-signer path never sees a private key at
all.
:::

</div>

<div class="h3-section-initial-part">

### 7.3 Signing with a local key

The local path is what `keygen` makes possible: enough for development, and enough for anyone
content to hold their own key.

</div>

<div class="h4-section">

#### Reading the pair back

```js
// src/sign/keys.mjs
const privateKey = createPrivateKey(await readFile(privatePath, 'utf8'));
const publicKey = createPublicKey(privateKey);
const rawPublicKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
const metadata = JSON.parse(await readFile(publicPath, 'utf8'));
if (metadata.publicKeyBase64 !== rawPublicKey.toString('base64')) {
  fail('Private and public signing keys do not match.');
}
```

The public half is *derived* from the private key and compared against the published file. This is
the check that catches a half-restored backup, a copied private key beside somebody else's public
file, or a rotation that replaced one file and not the other — at the start of a build, with a clear
message, rather than three minutes later when a consumer cannot verify what was produced.

</div>

<div class="h4-section">

#### The envelope the signer produces

```js
// src/sign/index.mjs
const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
```

```js
// src/sign/keys.mjs
return {
  schemaVersion: BOX_SCHEMA_VERSION,
  payloadEncoding: PAYLOAD_ENCODING,
  payloadBase64: payloadBytes.toString('base64'),
  payloadSha256: sha256Hex(payloadBytes),
  signatures: [{
    algorithm: 'ed25519',
    keyId: metadata.keyId,
    signatureBase64: edSign(null, payloadBytes, privateKey).toString('base64'),
  }],
};
```

Three properties of those twelve lines carry the whole format:

- **The payload is serialised exactly once.** The same `payloadBytes` are hashed, signed, and
  base64-encoded into the [envelope](#envelope). There is no second serialisation anywhere that could
  differ by a space, and therefore no way for the published bytes to drift from the signed bytes.
- **The digest is redundant with the signature, deliberately.** `payloadSha256` lets a reader detect
  a truncated or corrupted document, and lets a tool identify a payload, without holding a key. It is
  a convenience and an integrity check, never a substitute for verification — which is why the
  function that checks it is named for what it does and not for what it does not.
- **`edSign(null, …)`** passes no digest algorithm because ed25519 hashes internally. Passing one
  would be a category error the API happens to accept.

`signatures` is an array from the outset. One key is the normal case, but the field cost nothing to
make plural and is what makes rotation expressible at all.

</div>

<div class="h3-section-initial-part">

### 7.4 Verifying a signed document

Verification lives in the same module as key generation, because a signature nobody checks is
theatre. Every code path that consumes a signed document — `build` re-verifying an external signer,
`verify`, every consumer — arrives at these two functions.

</div>

<div class="h4-section">

#### Decoding without verifying

```js
// src/sign/keys.mjs
export function decodeSignedDocument(document) {
  if (document?.schemaVersion === 1) {
    fail('Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.');
  }
  if (document?.schemaVersion !== BOX_SCHEMA_VERSION || document?.payloadEncoding !== PAYLOAD_ENCODING) {
    fail('Unsupported signed document.');
  }
  const bytes = Buffer.from(document.payloadBase64, 'base64');
  if (sha256Hex(bytes) !== document.payloadSha256) fail('Signed payload SHA-256 mismatch.');
  return { bytes, payload: JSON.parse(bytes.toString('utf8')) };
}
```

Four things happen and one deliberately does not. Version 1 is refused by name rather than being
reinterpreted; the envelope constants must match; the payload is decoded; the checksum must hold.
The signature is **not** checked, and the JSDoc says so in its first line.

This function exists because reading a document is sometimes legitimate without trusting it —
inspecting a release, displaying what a channel points at, extracting an identifier for a log line.
Making that a separate, honestly named function is safer than a single function with a `verify: false`
option, which is the shape that eventually gets called with the wrong argument.

</div>

<div class="h4-section">

#### The trust file, and rotation

```js
// src/sign/keys.mjs
function trustedKeyEntries(value) {
  return Array.isArray(value?.keys) ? value.keys : [value];
}
```

A [trust key](#trust-key) file is either a single key object — exactly what `keygen` writes — or a
`{ keys: [...] }` bundle. One shape would have been simpler; two mean a consumer can start with the
file the tool produced and grow into a bundle without any migration, and that a project can ship one
file listing every key it has ever used.

```js
// src/sign/keys.mjs
const valid = document.signatures?.some((signature) => {
  const key = trusted.find((candidate) => candidate.keyId === signature.keyId);
  return key?.publicKeyPem
    && edVerify(null, bytes, createPublicKey(key.publicKeyPem), Buffer.from(signature.signatureBase64, 'base64'));
});
if (!valid) fail('Document has no valid signature from a trusted ed25519 key.');
```

**Any one signature verifying against any one trusted key accepts the document.** That is what makes
key rotation survivable: during a rotation, documents are signed with both the outgoing and the
incoming key, holders of either trust file accept them, and the outgoing key is retired once the new
one has propagated. Requiring *all* signatures to verify would mean a consumer who has not yet
learned the new key rejects a document that was signed correctly — turning a rotation into an
outage.

The permissiveness is bounded in the way that matters: a signature whose key ID is unknown is
ignored rather than trusted, an unparseable or non-ed25519 key contributes nothing, and a document
with no verifying signature at all fails. Adding a signature to a document can never make it *less*
acceptable, and can never make it acceptable to someone who trusts none of the signers.

</div>

<div class="h3-section-initial-part">

### 7.5 The external signer

Production key custody is not Scrollcase's business. An organisation may keep its signing key in an
HSM, a cloud KMS, a signing service behind an approval workflow, or a machine no build ever runs on.
`--signer-command` hands the payload to a command the operator configures and takes back a signed
document.

</div>

<div class="h4-section">

#### The exchange

> The command receives the payload bytes on **stdin** and writes the complete signed document as
> **JSON on stdout**.

That is the entire protocol. Any language, any credential mechanism, no plugin API to keep
compatible, no dynamic loading of somebody's code into the build process. A shell script wrapping a
cloud KMS's sign call satisfies it; so does a compiled binary talking to an HSM.

```js
// src/sign/index.mjs
const result = runResult(executable, args, {
  input: payloadBytes,
  capture: true,
  maxBuffer: 16 * 1024 * 1024,
});
```

Three failure modes are distinguished, because "the signer did not work" is not an actionable
message: the command could not start (`result.error`), it exited non-zero (the message carries the
exit status and the trimmed stderr), or its stdout did not parse as JSON. The 16 MiB buffer is
generous for a document measured in kilobytes and bounded so that a runaway signer cannot exhaust
memory. `runResult` is the same [injection seam](#injection-seam) every other subprocess goes
through, which is how the external path is tested without an external signer.

</div>

<div class="h4-section">

#### Parsing the command

The command may be given as an array, in which case each element must be a string and the array is
used as-is — no parsing, no ambiguity. Given as a string, it is tokenised: single quotes are
literal, double quotes honour `\\` and `\"`, an unquoted backslash escapes whitespace, quotes and
itself, and an unmatched quote fails the build rather than guessing.

A string form exists at all because the command arrives from a config file or a command-line flag,
where an array is awkward to express. The tokeniser is deliberately not a shell: it does no
expansion, no globbing, no substitution and no pipeline handling, so a payload or an environment
value can never turn into a shell construct. What it produces is an argument vector, which is then
executed without a shell.

</div>

<div class="h4-section">

#### The three things a signer is not trusted about

```js
// src/sign/index.mjs
const document = signWithCommand(payloadBytes, signerCommand, runResult);
if (document?.payloadBase64 !== payloadBytes.toString('base64')) {
  fail('External signer returned a different payload than the one it was given.');
}
// Verified against the trust anchor the operator points at, not against the signer's word.
await verifySignedDocument(document, publicPath);
return document;
```

1. **What it signed.** The returned `payloadBase64` must equal the base64 of the exact bytes the
   signer was handed. A signer that substitutes a payload — through a bug, a re-serialisation, or
   malice — fails the build. Without this check, an external signer could return a valid signature
   over a *different* release and the builder would publish it.
2. **That the signature is real.** The document is verified locally against the operator's own
   trusted public key file before the build continues. The signer's assertion that it signed
   something is not evidence.
3. **That the key is the expected one.** Because verification runs against the trust anchor the
   operator points at — the same file a consumer would use — a signer that signs with the wrong key
   fails here rather than in the field.

::: tip This is hard rule 7 in its most concentrated form
*Verify, never trust.* The external signer is the one place where Scrollcase asks something outside
itself for a security-critical result, and it is the place with the most checks on the answer. A
signer that fails any of the three produces no box at all, which is strictly better than producing a
box nobody can install.
:::

</div>

<div class="h3-section-initial-part">

### 7.6 The CLI edge — `cli-signing.mjs`

Key *paths* are a project concern, and readiness is checked before anything expensive starts.

</div>

```js
// src/cli.mjs
function keyPaths(flags) {
  const keysDir = getWorkspace().keysDir;
  return {
    privatePath: resolve(text(flags, 'private-key') || join(keysDir, 'signing-private.pem')),
    publicPath: resolve(text(flags, 'public-key') || join(keysDir, 'signing-public.json')),
  };
}
```

Both paths default into the [workspace](#workspace)'s key directory and are overridable per
invocation, following the same rule as every other path in the tool: the project declares where
things live, and Scrollcase never derives a location from its own position on disk.

`ensureBuildSigningKeys` then runs as a **read-only preflight** before `build` does any work:

| Situation | Result |
| --- | --- |
| External signer, trusted public key present | Proceed |
| External signer, no public key | Fail — the key that verifies the signer is required |
| Local path, both files present | Proceed |
| Local path, exactly one file present | Fail — refuses to replace the existing key |
| Local path, neither present | Fail — run `keygen` first |

Every failing case is a refusal, never a repair. `build` creating or rotating identity material would
mutate the project before [provenance](#provenance) has even been established, and could silently
change the identity under documents already published. The one-file-present case is the sharpest:
the obvious "helpful" behaviour is to regenerate the missing half, which is impossible for a public
key and catastrophic for a private one. Refusing is the only correct answer.

<div class="h3-section-initial-part">

### 7.7 What signing deliberately does not do

The absences here are the same boundary the rest of the tool draws, applied to cryptography.

</div>

- **No second algorithm.** One curve, one signature format, one verification path. A second
  algorithm would double the surface every consumer implementation must get right, to buy nothing
  the first one does not already provide.
- **No revocation checking.** The [revocations](#revocations) document has a defined shape because a
  publishing project needs one; Scrollcase never fetches, consults or enforces it. Deciding that a
  release is no longer acceptable is a distribution policy, and distribution is outside the boundary.
- **No timestamping or countersignature policy.** No trusted time source, no notary, no threshold
  rules about how many signatures constitute acceptance. A project that needs those builds them on
  top of an envelope that already carries a signature array.
- **No key distribution.** How a consumer obtains the trusted public key — bundled in an installer,
  pinned in an application, fetched from a well-known URL — is the project's decision. Scrollcase
  takes a path to a file.
- **No encryption.** Signatures establish authenticity and integrity, not confidentiality. A box
  travels in the clear; anyone who wants it private encrypts the transport or the storage.
- **No key escrow, backup or recovery.** Scrollcase writes a key file with restrictive permissions
  and stops. Where it is backed up, and who can use it, is custody — which is the operator's, which
  is the whole reason the external signer exists.

## 8. The consumers

Everything up to here produces a box. This section is about the other end: a machine that holds a
signed [release](#release) document, a trusted public key, and either an archive plus destination or
an already-extracted root, and wants a working Python environment whose identity it can establish.

Scrollcase ships **three** implementations of that — in Node, in Python, and in Rust — because the
code that consumes a box usually is not the code that built it. They are not an original and its
ports; they are three mirrors of one contract, and they are held to it by the same fixtures.

<div class="h3-section-initial-part">

### 8.1 Three implementations, one contract

<div class="h4-section">

#### The parallel surfaces

| Concern | Node — `scrollcase/consumer` | Python — `scrollcase_consumer` | Rust — `scrollcase-consumer` |
| --- | --- | --- | --- |
| Verify and prepare | `verifyAndExtractBox()` | `verify_and_extract_box()` | `verify_and_extract_box()` |
| Re-attach an extracted box | `attachExtractedBox()` | `attach_extracted_box()` | `attach_extracted_box()` |
| Verify an installed payload | `verifyExtractedPayload()` | `verify_extracted_payload()` | `verify_extracted_payload()` |
| Execute a prepared box | `runExtractedBox()` | `run_extracted_box()` | `run_extracted_box()` |
| One-shot run | `runBox()` | `run_box()` | `run_box()` |
| Receipt | frozen `PreparedBox` object | frozen `PreparedBox` dataclass | `PreparedBox` with private fields |
| Failure | `fail()` → `Error` | `ScrollcaseConsumerError` | `fail!()` → opaque `Error` |
| Private state binding | `WeakMap` | `weakref.WeakKeyDictionary` | private fields, no public constructor |
| Process seam | `spawn` option | `popen_factory` argument | `SpawnBox` trait |
| Signal seam | `signalSource` option | `signal.signal` on the main thread | a channel the caller owns |
| Schemas | read from `src/contract/schema/` | bundled copies, checked by `sync_schemas.py --check` | bundled copies used by the tests, checked by `sync-assets.mjs --check` |
| Dependencies | `yauzl` for reading archives | `cryptography`, `jsonschema` | `ed25519-dalek`, `zip`, `sha2`, `serde`, `base64` |

The Python package is distributed separately (`scrollcase-consumer` on PyPI, requiring Python 3.10 or
newer), ships `py.typed`, and is checked under `mypy --strict`. It depends on `cryptography` for
ed25519 and `jsonschema` for schema validation, and on nothing else; ZIP reading uses the standard
library's `zipfile`.

The crate is distributed separately too (`scrollcase-consumer` on crates.io, requiring Rust 1.88 or
newer). It forbids `unsafe`, is synchronous throughout so an application chooses its own runtime or
none, and — being a library embedded in someone else's process — installs no signal handler of its
own. Where Node and Python validate a release against the canonical schemas at run time, the crate
encodes those schemas as types that refuse an unknown field; `rust/tests/schema.rs` then proves the
types and the schemas still agree, with `jsonschema` as a development dependency that never reaches
a consumer.

</div>

</div>

<div class="h4-section">

#### Why three, and not a binding

A native binding, or a subprocess call into the Node implementation, would make one runtime a
dependency of the others. A Python application that wants to run a box would have to ship Node; a
Node application would have to ship Python; a Rust desktop client would have to ship both to avoid
writing either. All are unacceptable for the situation these boxes exist to serve, where the point
is a self-contained artefact with a short dependency list.

**Rejected:** a shared native core through FFI. It would replace three readable implementations of a
few hundred lines each with a build matrix, a packaging problem per platform, and a class of bug no
language's tooling can see. What holds them honest is not shared code — it is
[section 8.7](#_8-7-the-shared-conformance-fixture)'s shared fixture, plus schemas copied from one
canonical source by a checked step.

</div>

<div class="h3-section-initial-part">

### 8.2 The fixed verification order

Nothing from inside a box runs until the complete trust chain has passed. The order is not an
implementation detail; it is part of the contract, and every consumer follows it.

</div>

```text
   1  signed document        schema, signature, payload digest
   2  release manifest       schema, schemaVersion 2, kind
   3  target                 adapter resolved, declared interpreter path
   4  archive                located, size, SHA-256
   5  every archive entry    safe path, kind, collisions, links
   6  box.json               read, schema, agreement with the release
   7  execution              script exists, or module is discoverable
   ---------------------------------------------------------------- read only
   8  extract                into a staging directory beside the destination
   9  on-demand assets       verified by size and digest
  10  spawn                  the box's own interpreter
```

Two properties of that order are worth stating outright. **Everything cheap that can reject comes
first** — a bad signature costs a few milliseconds to detect, and there is no reason to hash a
multi-gigabyte archive before finding out. And **extraction is late**: no byte is written outside a
staging directory until every property of the archive has been established from the archive itself.

<div class="h4-section">

#### Why the Node consumer reuses the builder's inspection

The Node consumer calls `inspectReleaseDocument()` and `inspectBoxArchive()` from
`src/build/verify.mjs` — the same functions `scrollcase verify` uses, described step by step in
section 6.15. Attachment and payload verification stop after the document half; preparation
continues through the archive half. That is a deliberate coupling.
Adding an execution API must not create a second, subtly different interpretation of a signed
release: the moment there are two, they drift, and the difference between them is a security bug
nobody is looking for.

The cost is that the consumer module graph reaches into `src/build/`. That was accepted because the
alternative — copying fifteen ordered checks — is exactly the failure this project's contract rules
exist to prevent.

</div>

<div class="h4-section">

#### The Python mirror — `_contract.py`

Python cannot import those functions, so `_inspect_release_document` and `_inspect_box_archive`
mirror the same split step for step, and `_contract.py` mirrors the behaviour schemas cannot
express: the three
[target adapters](#target-adapter), the [target ID](#target-id) rule, `safe_relative_path`, static
execution discovery, and the [symbolic link](#symbolic-link) rule with the same
`MAX_PAYLOAD_LINK_DEPTH = 8`.

The module's docstring states the boundary it lives inside: *schemas stay canonical in
`src/contract`*. What is mirrored in code is only what a schema cannot check at runtime. Everything
else is a **copy** of the canonical schema file, placed by `python/scripts/sync_schemas.py`, and
`--check` fails the test suite when a copy drifts from its source. Five schemas travel this way:
`signed-document`, `release-manifest`, `box-manifest`, `target` and `execution` — the consumer's
half of the eight.

The mirror is proved rather than asserted. `python/tests/test_contract.py` checks the Python target
rules against `fixtures/target-id-contract.json`, the same golden file every other implementation
answers to.

</div>

<div class="h3-section-initial-part">

### 8.3 Preparing a box

`verifyAndExtractBox` / `verify_and_extract_box` turns a release document, an archive and a
destination into a verified directory on disk — and executes nothing.

</div>

<div class="h4-section">

#### The staging dance

```js
// src/consumer/verify-and-extract.mjs
const stageRoot = await mkdtemp(join(parent, `.scrollcase-prepare-${basename(finalRoot)}-`));
const extractedRoot = join(stageRoot, 'payload');
```

The staging directory is created **beside the final destination**, not in the system temporary
directory. That is what keeps the final `rename` on one filesystem, which is what makes it atomic:
an observer sees either no destination at all or the complete verified tree, never a half-extracted
one. Extracting into `/tmp` and moving would degrade into a copy across a device boundary, and a
copy has an observable middle.

The sequence inside the `try` block, in order:

1. Extract the archive into the staging directory.
2. Compare the extracted [payload](#payload) size against the release's `installedSizeBytes`.
3. **Re-hash the source archive** and compare it to the release again.
4. `lstat` the staged root.
5. Check once more that the destination does not exist.
6. `rename` the staged payload onto the destination.
7. `lstat` the destination and require the same device and inode as the staged root.

Step 3 is not paranoia about the same file twice. The archive was hashed to make the trust decision;
between that moment and the tree landing in the caller's durable destination, a local file can be
replaced. Re-checking closes the window in which a swapped archive would be extracted under a
verification that no longer describes it.

Step 7 catches the mirror-image problem at the other end: a destination that was substituted between
the last existence check and the rename is no longer the object that was just verified, and is
refused rather than returned as prepared.

The destination is checked for existence **three times** — before inspection, after its parent is
created, and immediately before the rename. This narrows the race window; it does not eliminate it,
and it is not claimed to. What it does eliminate is the far larger hole of renaming onto whatever
happens to be there.

A `finally` removes the staging root on every path, so a failure at any step leaves no partial tree
and no temporary directory behind.

</div>

<div class="h4-section">

#### The opaque receipt

A prepared box is represented by a receipt that is deliberately *not* reconstructible:

```js
// src/consumer/verify-and-extract.mjs
const preparedBoxes = new WeakMap();
```

The receipt itself is public and useful — status, identity, version, [target](#target), target ID,
interpreter path, execution metadata, required assets, signing key IDs, the signed-document payload
digest, the archive digest and size, the measured installed size, and a masked environment report
for the verifying process. It is frozen recursively, so a
caller cannot mutate what was verified. `status: 'prepared'` says the directory came from an archive
whose signed hash was checked in this process; `status: 'attached'` says an existing directory was
re-identified without proving its payload bytes. The type carries both values because the two
producers do not make the same assertion.

What the receipt does *not* contain is the verified release and the identity of the extracted root.
Those live in a `WeakMap` keyed by the exact receipt object, reachable only through
`preparedBoxState()`, which is internal to the consumer module graph and is not re-exported from the
package surface. The consequence is the point:

::: warning A hand-built object cannot be executed
Passing `{ status: 'prepared', root: '/somewhere/else' }` to `runExtractedBox` fails with *Expected
a PreparedBox returned by verifyAndExtractBox() or attachExtractedBox()*. Execution authority comes
from having gone through one of those checked producers, not from having an object that looks like
their result.
:::

Python reaches the same property differently, and the difference is instructive:

```python
# python/src/scrollcase_consumer/models.py
@dataclass(frozen=True, eq=False)
class PreparedBox:
```

`eq=False` keeps the default identity-based equality and hashing. A `WeakKeyDictionary` therefore
keys on the *instance*, so a structurally identical copy of a receipt is a different key and carries
no authority. Had the dataclass used the usual field-based equality, a caller could have constructed
an equal object and found it accepted — the exact hole the Node `WeakMap` closes by object identity.
`prepared_box_state` also rejects anything that is not a `PreparedBox` at all.

</div>

<div class="h3-section-initial-part">

### 8.4 Executing a prepared box

Preparation proves what a box is. Execution re-establishes that the box is still what was prepared,
and only then starts a process.

</div>

<div class="h4-section">

#### What is re-checked before the interpreter starts

| Check | Why it is repeated here |
| --- | --- |
| Release declares an `execution` entry point | A library-only box prepares successfully and has nothing to run |
| Native host matches the target adapter | A Linux box cannot run on macOS; the message names both |
| Root is a directory with the recorded device and inode | The prepared tree may have been replaced or removed since |
| Interpreter path is present in the extracted tree | The tree on disk, not the archive that produced it |
| Execution script exists, or module is discoverable | Same static rule the builder and `verify` apply |
| Every on-demand [asset](#asset): present, regular file, exact size, exact digest | The caller materialised them; they were never verified in place before |

The root identity check is the one that is easy to leave out. Without it, preparing a box and
running it later would trust that nothing swapped the directory in between — which on a shared
machine is precisely the assumption an attacker wants.

::: warning On-demand assets are verified, never fetched
When [weights mode](#weights-mode) is `on-demand`, the release carries signed descriptors and the
receipt exposes them as `requiredAssets`. The caller places those bytes under the box root — often
in an `onPrepared` callback. The consumer then checks each one's size and SHA-256 against the signed
descriptor before spawning anything, and refuses to run if any is missing, is not a regular file, or
does not match. Downloading them is the caller's job, always.
:::

</div>

<div class="h4-section">

#### Building the argument vector

```js
// src/consumer/run-extracted.mjs
const executionArgs = release.execution.kind === 'python-script'
  ? [join(prepared.root, ...safeRelativePath(release.execution.script).split('/'))]
  : ['-m', release.execution.module];
executionArgs.push(...release.execution.defaultArgs, ...callerArgs);
```

The vector is `[interpreter, script | -m module, ...signed default arguments, ...caller arguments]`,
the working directory is the box root, and `shell` is `false` in both implementations.

Two decisions are encoded in that ordering. **The signed defaults come first**, so a caller can
append to what the publisher declared but cannot displace it. And **no shell is involved**, so a
caller argument containing `$(…)`, `;`, a quote or a newline arrives at the process as one literal
argument. The conformance suite asserts exactly that with an argument of `$(touch never)`: if any
shell ever crept into the path, the case fails and names the file that should not exist.

The environment keeps three provenance layers: the current process, caller values, and the signed
release declaration, in that precedence order. Nothing is filtered. Windows names are matched
case-insensitively, and the release therefore wins even when the host spells `Path` differently.
The three standard streams default to `inherit` in Node and to the caller's handles in Python.

The resolver returns the exact child environment and a structured diagnostic. Its compact form
contains signed declarations, inherited variables capable of changing executed code, conflicts and
their winner, and a count of omitted names. `envReport` / `env_report` expands all names;
`envReportValues` / `env_report_values` reveals inherited host values. Verification and attachment
receipts carry a host-plus-release snapshot; execution recalculates it with the caller layer. The
declaration is format. The report is local consumer output and never a box guarantee.

</div>

<div class="h4-section">

#### Signals and terminal results

Both implementations forward `SIGINT`, `SIGTERM` and `SIGHUP` to the child while it is alive, and
both undo that at the same point the result settles.

Node registers handlers on an injectable `signalSource` (defaulting to `process`) and removes every
one of them in a `cleanup` called from both the `error` and `close` paths — a handler that outlived
its child would keep a dead reference and forward a later signal to nothing. Python installs
handlers only when running on the main thread, because installing a signal handler from a worker
thread raises, and restores the previous handlers in a `finally` regardless of how the wait ended.

The terminal fields are the same in both: `{ exitCode, signal, environmentReport }`, exactly one of
`exitCode` and `signal` being non-null.
Python derives it from the negative return code convention and converts it back to a signal name, so
callers see `SIGTERM` rather than `-15`.

The result is returned **unchanged**. A non-zero exit is not an error, and a signal is not a
failure — they are the application's terminal semantics, and translating them into a Scrollcase
success/failure convention would destroy information the caller needs. The conformance suite pins
this with a case that expects exit code 23 to arrive as exit code 23.

</div>

<div class="h3-section-initial-part">

### 8.5 One-shot execution

`runBox` / `run_box` is preparation, execution and removal in a single call, for callers who want to
run a box without installing it.

</div>

```js
// src/consumer/run-box.mjs
const temporaryRoot = await mkdtemp(join(temporaryParent, 'scrollcase-run-'));
try {
  const prepared = await verifyAndExtractBox(releaseDocumentPath, { …, destination: join(temporaryRoot, 'box') });
  await options.onPrepared?.(prepared);
  return await runExtractedBox(prepared, options);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
```

It composes the two public operations rather than reimplementing either, which is why it is under
fifty lines. The `onPrepared` hook exists for exactly one purpose: an on-demand box needs its assets
placed into the extracted root after preparation and before execution, and that is the only moment
at which the root path is known.

The `finally` owns cleanup for **every** terminal path — normal exit, non-zero exit, a spawn that
never started, a forwarded signal. Three conformance cases exist solely to prove that the temporary
directory is empty afterwards in the success, spawn-failure and signal cases, because a cleanup that
only runs on the happy path is how temporary directories full of multi-gigabyte environments
accumulate.

<div class="h3-section-initial-part">

### 8.6 Defensive extraction on the Python side — `extract.py`

Section 6.12 covered the archive reader the builder and the Node consumer share. Python needs its
own, and it is written to the same rule: **classify every entry before writing any byte**, and never
delegate a security decision to whichever platform happens to be running.

</div>

The refusals, in the order they can occur:

| Condition | Rejected because |
| --- | --- |
| Encryption flag set (`flag_bits & 0x1`) | A box is never encrypted; an encrypted entry is either corrupt or a probe |
| Link target longer than 1024 bytes | A real target is a file name; anything near a path limit is corrupt or hostile |
| Entry name that is absolute, contains `..`, an empty segment, a NUL, or a drive letter | [Path traversal](#path-traversal) |
| Any type that is not file, directory or symlink | Devices, FIFOs and sockets have no place in a payload |
| Duplicate path, entry under a path already seen as a file, or a file at a path used as a parent | An archive that describes two different trees |
| A link that does not resolve to a regular file inside the payload | The link rule, re-applied to the archive as received |
| Any entry whose path passes through a link | The classic way an archive writes outside the directory it was extracted into |

Extraction then writes with `mkdir(exist_ok=False)` and `open("xb")` — exclusive creation
throughout, so nothing existing is ever overwritten — re-checks each entry's byte count as it
streams, writes symlinks as the validated relative string without ever resolving them, and applies
the recorded mode on POSIX platforms. Afterwards `validate_extracted_tree` walks the result and
rejects any special node that materialised anyway.

Two smaller decisions in the same file are easy to miss and load-bearing. `read_zip_entry` is
bounded at 1 MiB and checks both the declared size and the bytes actually read, so a lying header
cannot make a metadata read expensive. And `payload_size` uses `lstat`, counting a link as its own
few bytes rather than the size of its target — counting targets would restore on paper exactly the
duplication that carrying links removes from disk, and this number is what a caller checks free
space against.

<div class="h3-section-initial-part">

### 8.7 The shared conformance fixture

Three implementations agreeing today is worth little; what matters is that they cannot silently
diverge tomorrow. `src/contract/fixtures/consumer-conformance.json` is how that is enforced.

</div>

<div class="h4-section">

#### What is in the file

Sixty-six cases and twenty-eight error patterns, in a language-neutral JSON document. Each case is a
small declarative record:

```json
{
  "id": "shell-metacharacter-preservation",
  "action": "run-prepared",
  "runtime": { "args": ["$(touch never)", "semi;colon", "quote'\"value"], "exitCode": 0 },
  "expected": {
    "outcome": "completed",
    "argv": ["$BOX/$NATIVE_PYTHON", "$BOX/app/main.py", "--default", "value with spaces",
             "$(touch never)", "semi;colon", "quote'\"value"],
    "cwd": "$BOX",
    "shell": false
  }
}
```

`action` is one of `prepare`, `attach`, `verify-payload`, `run-prepared` or `run-box`. `fixture`
selects the box to build (signer, target, execution kind, whether an on-demand asset or payload
digest is declared), `mutation` names a single named corruption to apply, and `runtime` supplies
arguments, an exit code, a signal, stream handling, a spawn failure, an asset state, or the request
to re-attach before a prepared run. Both harnesses reject an unknown action explicitly; it cannot
fall through into `run-box` and pass as the wrong operation.

`requiresSymlinks` marks the one thing a host may be unable to do: Windows boxes are link-free and
creating a link there needs elevation, so cases that depend on one are skipped rather than
weakened.

The three tokens keep a case both exact and portable: `$NATIVE_PYTHON` and `$NATIVE_TARGET` expand
to the running host's interpreter path and target ID, and `$BOX` to the prepared root. A case can
therefore assert a complete absolute argument vector without hard-coding a platform or a temporary
path.

Note that the fixture's own `schemaVersion: 1` is the *fixture format's* version. It is unrelated to
the box format's `schemaVersion: 2`.

</div>

<div class="h4-section">

#### What the cases cover

| Group | Cases | What is pinned |
| --- | --- | --- |
| Valid preparation | 3 | Local and external signing paths both produce the same receipt; an interpreter reached through a payload link is accepted |
| Tampering | 6 | Altered signature, altered payload, altered archive bytes, altered size, release/`box.json` disagreement, altered execution metadata |
| Missing pieces | 3 | Absent interpreter, absent script, undiscoverable module |
| Hostile archives | 7 | Traversal, absolute path, escaping link, special entry, encrypted entry, duplicate entry, file/directory collision |
| Destination safety | 1 | An existing destination is refused and left untouched |
| Per-target entry points | 3 | macOS, Linux and Windows receipts, including `venv/python.exe` |
| Execution semantics | 6 | Persistent root survives, argument ordering, shell metacharacters, stream forwarding, non-zero exit, signal forwarding |
| Temporary cleanup | 3 | Empty afterwards on success, on spawn failure, on signal |
| On-demand assets | 3 | Missing, wrong size, wrong digest — each refused before spawning |
| Valid attachment | 5 | Existing roots, attach-then-run, a linked interpreter, materialised assets, and unrelated extra files |
| Attachment refusal | 8 | Missing/file/link roots, missing interpreter or script, foreign target, and missing or wrong-hash assets |
| Installed-payload verification | 11 | Match; extra files, mode and mtime ignored; tampered, deleted or retargeted entries refused; on-demand assets ignored; absent, missing or altered digest commitments refused |

The three per-target **preparation** cases run on any host because preparation has no native-host
requirement. Attachment and execution do: the foreign-target attachment case pins that distinction.
Keeping those questions separate lets a single machine prove all three interpreter layouts without
pretending it can mint an executable receipt for all three.

</div>

<div class="h4-section">

#### Error patterns, not error strings

```json
{
  "errorPatterns": {
    "archive-hash": "Archive SHA-256 mismatch",
    "unsafe-path": "Unsafe relative path|invalid relative path|absolute path",
    "link-entry": "link does not resolve to a file inside the payload|…|link target is too long"
  }
}
```

The `link-entry` pattern above is abridged; in the file it carries a third alternative, for an entry
written *through* a link.

A case asserts *which* failure occurred, not how it was phrased. Each harness matches the raised
message case-insensitively against the patterns and reports the matching code; a message that
matches nothing becomes `unclassified: <the message>`, which fails the comparison and prints the
text, so an unexpected failure is loud rather than silently mapped onto the wrong code.

Classification is first-match-wins, so new expressions are checked against the messages all older
cases already produce. The payload-entry expression is anchored at the start, for example, and
therefore cannot steal *Extracted payload size does not match the signed release* from its existing
classification.

**Rejected:** requiring byte-identical messages in every language. It would force one language's
phrasing on the others, make any wording improvement a cross-language breaking change, and prove
nothing extra — what matters is that all of them refuse the same input for the same reason.

</div>

<div class="h4-section">

#### The three harnesses

Nothing is shared between the harnesses but the JSON. `tests/helpers/consumer-conformance.mjs`
builds its fixture box with `yazl` and mutates real ZIP bytes — flipping the encryption bit in both
the local and central headers, rewriting entry names in place under a byte-length constraint so
offsets stay valid. `python/tests/conformance_support.py` builds an equivalent fixture with
`zipfile` and its own `ArchiveEntry` records. `rust/tests/support/mod.rs` builds a third with the
`zip` crate and patches the central directory itself. Each drives its own consumer through its own
fake process factory, then compares its observed result with the *same* expected object.

That independence is the point. A shared harness would let one bug hide in every language; three
harnesses agreeing on one expectation file is evidence about the contract rather than about the test
code. It has already paid for itself: bringing the Rust consumer to the file surfaced two real
defects — an archive naming one path twice, whose duplicate the `zip` crate collapses before a
reader can see it, and a linked interpreter that was refused on attach and then sized as though it
were nothing.

</div>

<div class="h3-section-initial-part">

### 8.8 The CLI's `run` — `cli-run.mjs`

`scrollcase run` is a thin edge over the Node consumer, not a third implementation.

</div>

```js
// src/cli-run.mjs
if (result.signal) terminate(result.signal);
else setExitCode(result.exitCode ?? 1);
```

The module adds two things and nothing else: two status lines printed from the `onPrepared` hook, and
a translation of the child's terminal result into this process's own. A child killed by a signal
makes the CLI kill *itself* with the same signal, so a shell sees the real termination cause rather
than an invented exit code; otherwise the child's exit code becomes the CLI's.

Both lines go to **stderr**, because stdout belongs to the box. Every other verb owns its standard
output; `run` hands it to the application, and a status line written there would land inside
whatever file or process the caller piped that output into, with the box unable to tell. The second
line states what `run` is — a one-shot extraction, deleted on exit — and prints on every run rather
than above a size threshold, because a caller who does not know that reads a repeated
multi-gigabyte extraction as the tool being slow. A box kept across runs is `verifyAndExtractBox`
once, then `attachExtractedBox` and `runExtractedBox` from the library, not this verb.

Verification, extraction, execution, signal forwarding and cleanup all stay in `runBox`. The
injectable `run`, `log`, `setExitCode` and `terminate` parameters exist so the translation can be
tested without terminating the test runner.

<div class="h3-section-initial-part">

### 8.9 Living past the process that installed the box

A `PreparedBox` is bound to the process that made it, and that binding is the point: a receipt a
caller could write out and read back would be a forgeable execution capability. But an application
that installs a box once and runs it for months restarts, and re-extracting gigabytes at each launch
is not an answer. So the receipt is not serialised — it is *earned again*.

</div>

<div class="h4-section">

#### `attachExtractedBox` — a receipt without an archive

Attachment performs every check that needs no data beyond the signed release: signature and schema,
a target this host can run, the interpreter and execution files present, the signed hashes of
on-demand assets, and the root's device and inode captured for `runExtractedBox` to re-check. It
reads no original payload file contents: it enumerates paths and measures their metadata, so an
embedded five-gigabyte weight does not add five gigabytes of work. Required on-demand assets are the
exception and are hashed in full against their separate signed descriptors.

Two asymmetries with preparation are deliberate:

| | `verifyAndExtractBox` | `attachExtractedBox` |
| --- | --- | --- |
| Native host | not required — preparation only writes files | **required** — a receipt minted here exists to be executed |
| Root must | not exist | exist, and be a real directory, never a [symbolic link](#symbolic-link) |
| `status` | `prepared` | `attached` |
| `installedSizeBytes` | compared with the signed figure | measured, never compared |

The last row is the receipt refusing to overstate itself. An installed tree legitimately grows —
on-demand assets, caches, whatever the application writes in its working directory — so holding it
to the signed figure would fail honest boxes. And `status` distinguishes the two because they do not
prove the same thing: `prepared` means the bytes came from an archive whose signed hash was checked
here; `attached` means a directory was re-identified against a release, and no more.

</div>

<div class="h4-section">

#### `verifyExtractedPayload` — the separate, opt-in question

Proving the installed bytes is a different decision with a different cost, so it is a different
call. Nothing invokes it — not attachment, not execution — and section 5.5 describes the list it
reads. Its guarantee is worth stating exactly, because it is narrower than it looks:

- **It does** bind a directory to a signed release. Without it, an application handed a stale
  install, a rollback directory, or a half-deleted tree would get a receipt confidently asserting
  the wrong `version`. And it detects ordinary corruption — an interrupted extraction, a full disk,
  a quarantined file.
- **It does not** defend against a local attacker. The tree can change between this call and any
  later import, and Python imports lazily for the whole life of a process. No consumer library can
  close that window; filesystem permissions can, and they belong to the operating system and the
  embedding application. Scrollcase does not guard the directory afterwards.
- **It cannot see** `__pycache__` or `*.pyc` at all. The entry collector excludes them by name, so a
  stale or hostile compiled module shadowing its source is invisible to the digest permanently, not
  merely between check and use.

A release built before the digest existed is refused by name rather than reported as verified. A
box that carries no commitment must not be mistaken for one that satisfies it.

The weights mode changes the cost honestly. Embedded weights are payload entries and verification
reads all of them, which can mean tens of gigabytes. On-demand assets were absent when the list was
built and appear later as ignored extras; their integrity is covered separately by the signed
per-file `requiredAssets` descriptors that attachment and execution enforce. Mode and modification
time are also outside the digest, because archive writing synthesises modes and extraction restores
neither the build mode consistently across platforms nor the fixed build timestamp.

</div>

<div class="h3-section-initial-part">

### 8.10 What the consumers deliberately do not do

Every input is local and caller-selected. The list of what that rules out is the boundary from
section 3, restated where it is most tempting to cross.

</div>

- **No downloading.** Not the archive, not the release document, not the trust key, not on-demand
  assets. The consumer verifies bytes it is given.
- **No channel selection.** A [channel](#channel) document points at a release; choosing which one to
  install is a distribution decision, and nothing in the consumer reads a channel at all.
- **No revocation lookup.** See section 7.7.
- **No installation lifecycle.** No update, no rollback, no version comparison, no garbage
  collection of old boxes, no registry of what is installed. `verifyAndExtractBox` produces one
  directory and `attachExtractedBox` re-identifies one it is handed; which directory, and what
  becomes of it, stays the caller's.
- **No policy about failure.** A failed verification raises; it does not retry, fall back to a
  cached copy, or continue in a degraded mode. There is no "verify if possible" setting, because a
  check that can be skipped is not a check.

::: info The consumer's whole promise
Given caller-supplied local inputs, a consumer either returns the precise prepared, attached, or
payload-verification result the chosen operation promises, or it refuses with a clear error. Box
code runs only from an authentic process-bound receipt, after that execution path's trust checks
have passed.
:::

## 9. The command line

<div class="h3-section-initial-part">

### 9.1 One file, and what it is allowed to do

`src/cli.mjs` is the whole command line: the `bin` entry `scrollcase` points at it, and it is the
only executable the package ships. Everything it does falls into four categories — parse arguments,
resolve the [workspace](#workspace), ask a human a question, print a line — and everything else is
delegated to a module that could equally be called from a program.

</div>

That boundary is the reason the tool is usable as a library. A verb is a few lines of glue over a
function that takes explicit inputs:

```js
// src/cli.mjs
async function verify(path, flags) {
  await verifyBox(path, {
    publicPath: keyPaths(flags).publicPath,
    archive: text(flags, 'archive'),
    selfTest: Boolean(flags.get('self-test')),
  });
}
```

**Rejected:** letting the modules beneath read `process.argv`, `process.env` or the terminal
directly. It would have removed this file almost entirely, and it would have made every one of those
modules untestable without a fake terminal and unusable from a pipeline that has no terminal at all.
Consent, choice and presentation are injected downward; nothing reaches back up for them.

<div class="h4-section">

#### The shape of `main()`

```text
  argv
   │
   ├─ -v | --version ──────────────► print the package version, exit          (no workspace)
   │
   ├─ parseArgs(rest)  ────────────► { positional, flags, passthrough }
   │
   ├─ (no command) | help | --help ► print usage, exit                        (no workspace)
   │
   ├─ configureWorkspace(overridesFromFlags)   ◄── every path below comes from here
   │
   └─ dispatch on the verb ────────► init | new | doctor | keygen | lock
                                     audit | build | verify | run
                                              │
                                    unknown ──┴──► fail()

  main().catch(error) ─────────────► "✗ scrollcase: <message>" on stderr, exit code 1
```

Three details in that order are deliberate.

**The version shortcut runs before anything else**, including argument parsing and workspace
resolution. `scrollcase --version` therefore answers from any directory, including one that contains
no project at all — which is exactly the situation an installer script or a diagnostic report is in
when it asks. `tests/unit/cli-version.test.mjs` runs the real binary from the system temporary
directory for that reason.

**The workspace is configured once, before any verb touches a path.** `workspaceOverridesFromFlags`
turns `--config`, `--project-root`, `--scrolls-dir`, `--build-dir`, `--out-dir`, `--keys-dir` and
`--toolchain-dir` into overrides, and those beat the project's `scrollcase.config.json`. A verb never
resolves a path itself, so a single invocation cannot half-use two workspaces.

**There is exactly one failure path.** Every `fail()` in the codebase throws, and every throw lands
in the same handler:

```js
// src/cli.mjs
main().catch((error) => {
  console.error(statusLine('error', `scrollcase: ${…}`, { stream: process.stderr }));
  process.exitCode = 1;
});
```

One line on stderr, a non-zero exit code, no stack trace. A shell or a CI step can rely on the status
without parsing anything, and a contributor adding a check does not have to decide how it should be
reported.

</div>

<div class="h3-section-initial-part">

### 9.2 The nine verbs

The set is closed and small. Each verb is one of the phases of a box's life, and the ones that cost
minutes are separated from the ones that cost milliseconds so that a failure is cheap.

</div>

| Verb | Does | Reads | Writes | Network |
| --- | --- | --- | --- | --- |
| `init` | Scaffold a workspace and an example, then offer the dependencies | Host, existing files | `scrollcase.config.json`, `scrolls/example-box/…`, optionally the toolchain | Only with consent |
| `new scroll` | Author one complete target-specific [scroll](#scroll) | Flags or prompts | `scrolls/<boxId>/<targetId>/` | No |
| `doctor` | Report whether this machine can build | Workspace, git, pixi, conda-pack | Nothing, ever | No |
| `keygen` | Create a local [ed25519](#ed25519) signing key | Existing key files | `signing-private.pem`, `signing-public.json` | No |
| `lock` | Resolve the scroll's pixi manifest | `scroll.json`, `pixi.toml` | `pixi.lock` | Yes — this is where solving happens |
| `audit` | Dependency licence inventory from the lock | `pixi.lock` | Optionally the reviewed audit | No |
| `build` | Solve-free install, self-test, archive, sign | The scroll, the lock, the keys | The [payload](#payload), the archive, the signed documents | Yes — package and asset downloads |
| `verify` | Check an archive, or an existing extracted payload | A [release](#release) document, a [trust key](#trust-key), and either an archive or extracted root | Nothing (a temporary tree with `--self-test`) | No |
| `run` | Verify, extract temporarily, execute | The same three inputs | A temporary extraction, removed afterwards | No |

Two properties of that table matter more than any individual row.

**Only `lock` and `build` reach the network**, and both are explicit human actions on a named scroll.
Nothing else in the tool downloads anything without being asked to — `init` only after a terminal
consent, `doctor` never, and the two consumer verbs never at all.

**`doctor` writes nothing under any circumstance.** It is the verb a user reaches for when something
is already wrong, and a diagnostic that repairs things is a diagnostic whose output cannot be
trusted. `tests/unit/project-surface.test.mjs` runs it in an empty temporary directory and asserts
that the directory is still empty afterwards — no config file, no `scrolls/`.

<div class="h4-section">

#### `init` — scaffold, then ask

`init` creates the workspace files and a fixed, disposable `example-box` scroll for the native host,
then offers three optional installations: the build toolchain, the TypeScript consumer dependencies,
and the Python consumer package.

It refuses to be used as an authoring command. Passing `--target`, `--platform`, `--accelerator`,
`--cuda-version`, `--box-id`, `--model-id` or `--runtime-id` fails with a pointer to `new scroll`:

```js
// src/cli.mjs
fail(`init accepts only the fixed example; pass ${…} to scrollcase new scroll.`);
```

**Rejected:** letting `init` author the project's first real scroll from flags. The example exists to
be run once and deleted; a scaffolded scroll that looks like a real one invites a project to inherit
identity decisions it never made. `--no-example` produces an empty workspace for a project that wants
neither.

The example's target is chosen by `nativeExampleTarget()` — Metal on macOS, CPU everywhere else — so
the demo never guesses a CUDA ABI version that the host may not have.

</div>

<div class="h4-section">

#### `new scroll` — one decision, collected completely

`new scroll` is the authoring verb. `collectNewScrollOptions` in `src/cli-authoring.mjs` gathers
every field — from flags, or from prompts when a terminal is present — and hands `createScroll` one
complete object. The scroll is written atomically after every answer exists, so an abandoned session
leaves nothing behind.

The positional grammar is checked strictly: `new` accepts exactly the single word `scroll` and
nothing else, because a mistyped subcommand that silently authored something would be worse than an
error.

</div>

<div class="h4-section">

#### `doctor` — the read-only verb

`doctor` prints one line per check with its own remedy, and exits non-zero if any failed:

```text
✓ workspace   config /path/to/project/scrollcase.config.json
✓ scrolls     /path/to/project/scrolls
✓ git         HEAD 6db8803169cc
✗ pixi        Scroll requires pixi 0.60.0, found 0.58.0.
  → Install pixi 0.60.0 from https://pixi.sh/, or pass --pixi <path>.
✓ conda-pack  /path/to/project/.scrollcase/toolchain/bin/conda-pack
```

Every check *reports* rather than throwing, so one missing tool does not hide the next problem:
someone whose machine is missing both pixi and conda-pack learns both in one run rather than one per
attempt. The `pixi` row needs a version to check against, and without one it says so explicitly —
`not checked: pass --pixi-version, or run doctor with a scroll` — instead of silently passing.
`--scroll <name>` takes that version from the scroll itself, which is the form that answers the
question a user actually has: can this machine build *this* box.

</div>

<div class="h4-section">

#### `keygen` — and the two paths it defaults to

`keyPaths(flags)` resolves both key locations against the workspace's `keysDir`, so
`--private-key` and `--public-key` are overrides rather than requirements:

```js
// src/cli.mjs
privatePath: resolve(text(flags, 'private-key') || join(keysDir, 'signing-private.pem')),
publicPath: resolve(text(flags, 'public-key') || join(keysDir, 'signing-public.json')),
```

The same function serves `build`, `verify` and `run`, so the key a build signs with and the key a
verification trusts are named by one rule rather than three. Section 7.2 describes what `keygen`
writes and why `--force` is dangerous.

</div>

<div class="h4-section">

#### `lock` — the only verb that solves

`lock` reads the scroll, locates the pixi version the scroll pins, and runs the resolver over the
generated `pixi.toml`:

```js
// src/cli.mjs
const pixi = findPixi({ requiredVersion: scroll.pixiVersion, path: text(flags, 'pixi') });
run(pixi, pixiLockArguments(join(dir, 'pixi.toml')));
```

It is a human action whose output is committed and reviewed. `build` never solves; it installs from
the committed [lockfile](#lockfile), which is what makes the reviewed set and the shipped set the
same set. Section 4.2 covers the three pixi invocations in full.

</div>

<div class="h4-section">

#### `audit` — an inventory, without a build

`audit` derives the licence inventory from the lock alone, prints the counts per licence, and
optionally writes the reviewed copy:

```text
· 412 packages for example-box-macos-aarch64-metal (macos-aarch64-metal)
    238  BSD-3-Clause
    104  MIT
     41  Apache-2.0
```

The licence rows are sorted by descending count and then by name, so two runs over the same lock
print the same list in the same order.

Without `--write` it compares against the reviewed audit already on disk and reports agreement;
with `--write` it becomes the reviewed audit. That asymmetry is the whole review mechanism: a build
fails when the two disagree, and making them agree is a deliberate act. Section 6.8 describes the
derivation.

</div>

<div class="h4-section">

#### `build` — a long pipeline behind two questions

`build` resolves the scroll reference, runs the signing preflight, asks two questions, and then hands
everything to `buildBox`:

```js
// src/cli.mjs
await ensureBuildSigningKeys(signing);
// Asked at the CLI edge and passed down: buildBox never reads a terminal itself.
const channel = await chooseCliValue('channel', ['beta', …], { flag: text(flags, 'channel') });
const weights = await chooseCliValue('weights mode', ['embed', 'on-demand'], { … });
```

The order is the point. The preflight is a read-only check that the keys exist (section 7.6), and it
runs *before* the questions, which run *before* the first expensive stage. A missing key costs a
second, not the twenty minutes it would cost if it were discovered at the signing stage.

`beta` is listed first so it is the highlighted default in the menu and the value taken when there is
no terminal — the channel a build should land on unless someone deliberately says otherwise.

</div>

<div class="h4-section">

#### `verify` and `run` — the consumer at the command line

Both take a signed release document and trust the key set at `--public-key`. In its archive form,
`verify` finds the archive beside the document or at `--archive`, performs the install-time checks,
and stops; with `--self-test` it additionally extracts, recomputes the payload digest when present,
and imports the signed module list with the box's own interpreter.

`verify --extracted <dir>` is the other form. It delegates directly to
`verifyExtractedPayload` in `scrollcase/consumer`, needs no archive, and refuses `--archive` or
`--self-test` rather than combining two operations with different meanings. `run` always takes the
archive path: it performs verification, extracts to a temporary directory, executes, forwards
signals, and removes the extraction on every terminal path.

Neither downloads anything. Both are described from the library side in sections 6.15 and 8.

</div>

<div class="h3-section-initial-part">

### 9.3 Parsing arguments — `cli-args.mjs`

Thirty lines, no dependency, and one rule that matters more than the rest.

</div>

| Form | Result |
| --- | --- |
| `value` | Appended to `positional` |
| `--name value` | `flags.set('name', 'value')`, and the value is consumed |
| `--name=value` | `flags.set('name', 'value')` |
| `--name` (followed by another `--flag`, or last) | `flags.set('name', true)` |
| everything after `--` | `passthrough`, verbatim |

**The `--` separator is a hard boundary.** Every string after it belongs to the box application
unchanged, even when it looks like a Scrollcase flag, even when it contains shell metacharacters:

```bash
scrollcase run release.json -- --public-key 'not; a flag' "$(echo unexpanded)"
```

All four of those tokens reach the box application exactly as written. Nothing after `--` is parsed,
rewritten, or interpreted, and — because the consumer spawns without a shell (section 8.4) — nothing
in them is expanded either. `tests/unit/cli-args.test.mjs` asserts that byte-for-byte preservation.

**Rejected:** an argument-parsing library. The grammar above is the entire surface, the passthrough
rule is the only subtle part of it, and a dependency here would be a dependency in the security path
of every `run` invocation. Section 4.4 states the same reasoning for the runtime dependencies.

One consequence is worth stating plainly: a flag value that itself begins with `--` cannot be written
in the separated form, because the parser reads the next token as a new flag. Write it as
`--name=--value`.

<div class="h3-section-initial-part">

### 9.4 Where the boundary runs

The CLI owns interaction. Every module below it receives the *answer*, never the question.

</div>

<div class="h4-section">

#### Consent — `confirm()`

```js
// src/cli.mjs
if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
```

Both ends must be a terminal, the default is no, and the only accepted affirmative is `y` or `yes`.
Without a terminal — a CI job, a pipe, a container build — there is nobody to answer, and **silence
must not be read as consent**. This is the guard that keeps `init` from downloading a toolchain in an
automated environment that never agreed to one.

`--install-toolchain` and `--no-install-toolchain` are how an automated caller states the answer it
would have given. They are passed into `ensureToolchain` as a `confirm` callback that ignores the
terminal, so the module below still sees one uniform consent interface.

</div>

<div class="h4-section">

#### Closed choices — `cli-menu.mjs`

`selectCliMenu` draws a raw-key menu: arrow keys move, Enter selects, Ctrl-C rejects. It redraws in
place with `\x1b[<n>A`, hides the cursor while it runs, and its `cleanup()` restores the previous raw
mode and shows the cursor again on **every** exit path, including the rejection. A menu that left a
terminal in raw mode would break the shell that invoked it.

`chooseCliValue` wraps it with the policy:

| Situation | Behaviour |
| --- | --- |
| A flag was passed | Validated against the closed list, unless `open` — an unknown value fails |
| A terminal is present | The menu, preselecting the first choice |
| No terminal | The first choice, **and a line saying which default it took** |

That last row is the interesting one. A silent default in a log is indistinguishable from a decision;
a stated one can be noticed in review.

**Rejected:** offering free-form values through the menu. A menu implies the list is exhaustive, so
anything open-ended — a path, an identifier, a version — stays an explicit flag or a text prompt.
Safety consent stays out of it for the same reason: a "yes/no" rendered as a list of choices reads as
a preference rather than a decision.

</div>

<div class="h4-section">

#### Target and scroll selection — `cli-targets.mjs`

This module owns the one interactive policy that is not a plain menu, because a wrong answer here
packages the wrong thing.

```text
  --target <id> given? ──yes──► must be one of the candidates, or fail
        │
        no
        ▼
  exactly one candidate? ──yes──► take it
        │
        no
        ▼
  terminal? ──yes──► menu, preselecting the host default
        │
        no
        ▼
  a single native candidate, or macOS + Metal? ──yes──► take it, and say so
        │
        no
        ▼
  fail, listing the candidates and asking for --target
```

Scroll selection is deliberately **not** symmetrical with this. When the positional argument is
omitted and there is no terminal, `chooseScroll` fails rather than defaulting:

```js
// src/cli-targets.mjs
fail('scroll selection requires an interactive terminal; pass <boxId>/<targetId> explicitly.');
```

A default target is a fact about the host, and picking it wrong wastes a build. A default *scroll* is
a guess about intent, and picking it wrong locks or packages a different product. Both refuse
ambiguity; they just disagree about what counts as ambiguous.

Both sort their candidates with `compareStableStrings` — the same raw-string ordering the archive
writer uses (section 6.11) — so the menu is in the same order on every machine, and both refuse
duplicate references outright rather than presenting two indistinguishable rows.

</div>

<div class="h4-section">

#### Authoring input — `cli-authoring.mjs`

`collectNewScrollOptions` builds three helpers over the same flag map, and the difference between
them is what happens without a terminal:

| Helper | With a terminal | Without |
| --- | --- | --- |
| `required(flag, …)` | Prompts, optionally with a default | Fails, naming the missing flag |
| `optional(flag, …)` | Prompts, empty answer accepted | Returns null — an omitted optional is not an error |
| `finite(flag, …, choices)` | Menu | Fails, naming the flag *and its allowed values* |

Some questions are asked only when they can apply: `--min-macos-version` only for a macOS target,
`--min-nvidia-driver-version` only for a CUDA one, and the CUDA ABI version only after CUDA has been
chosen — which is why `cliTargetFamilies()` lists CUDA without a version and the complete target ID
is assembled afterwards. A question that cannot apply is not asked, rather than asked and discarded.

`--default-args` is parsed as a JSON array of strings and rejected as a whole if it is anything else,
including an array containing one number. Those strings end up in a signed document and then in an
argument vector; a silently coerced value there would be a signed lie about what the box runs.

</div>

<div class="h4-section">

#### Ordering optional work — `cli-init.mjs`

`runInitDependencySetup` exists to enforce one sequence: **every answer is collected before the first
installer runs.**

```js
// src/cli-init.mjs
if (hasExample) {
  shouldInstallTypeScript = await confirmTypeScript();
  if (await confirmPython()) pythonSource = await choosePythonSource();
}
const toolchain = await installToolchain();
const typescript = shouldInstallTypeScript ? installTypeScript() : null;
const python = pythonSource ? installPython(pythonSource) : null;
```

Interleaving them would let a multi-minute download interrupt the remaining questions, leaving a user
who walked away with a half-collected set of choices and a half-installed project. It also makes the
whole interaction reviewable as one block before anything irreversible happens.

`resolvePythonConsumerSource` handles the one branch that cannot be decided in advance: conda-forge
was chosen but conda is not installed. It offers PyPI, and a declined offer returns `null` — which
skips the Python install rather than silently substituting a different package source.
`tests/unit/cli-init.test.mjs` asserts both the ordering and the declined fallback.

</div>

<div class="h4-section">

#### The two remaining edges

`cli-signing.mjs` is a read-only preflight over the key files, described in section 7.6. It never
creates a key: generating one silently would produce a box signed by a key nobody chose to trust.

`cli-run.mjs` translates the child process's terminal result into the CLI's own, described in section
8.8. It is the only place in the tool that terminates the current process on purpose.

</div>

<div class="h3-section-initial-part">

### 9.5 Presentation — `cli-output.mjs`

Library modules produce values and messages; this module decides what they look like. Keeping the two
apart is what lets a program embed the build without inheriting a terminal aesthetic.

</div>

| Kind | Symbol | Used for |
| --- | --- | --- |
| `success` | `✓` | Something exists now that did not before |
| `step` | `→` | A stage starting, or the next command to run |
| `info` | `·` | A path or a fact, subordinate to the line above |
| `warning` | `⚠` | Something was skipped that the user may have wanted |
| `error` | `✗` | The single failure line, on stderr |

**Only the symbol is coloured**, never the message. Colour is applied when the stream is a terminal,
`NO_COLOR` is absent, and `TERM` is not `dumb`:

```js
// src/cli-output.mjs
const colour = Boolean(stream.isTTY && !Object.hasOwn(env, 'NO_COLOR') && env.TERM !== 'dumb');
```

`Object.hasOwn` rather than a truthiness test: `NO_COLOR=` with an empty value is still the user
asking for no colour, and reading it as "false" would be a bug in exactly the environment that took
the trouble to set it. The symbols survive redirection, so a captured log is still readable without
any escape sequences in it.

`buildDistributionSummary` prints the closing line of a successful build as two paths relative to
`dist/`, with the content hashes left out — those are in the file names, and repeating a 64-character
digest in a terminal line helps nobody. The `build` verb also filters the pipeline's own log,
dropping the lines `buildBox` emits about what to publish and printing this one summary instead, so
the human-facing instruction is written once at the edge that formats it.

<div class="h3-section-initial-part">

### 9.6 What the command line deliberately does not do

Every item below is a thing a packaging CLI is routinely expected to do, and each is left out for the
reason given in section 3.

</div>

- **No publishing.** There is no `scrollcase publish`, no upload, no credentials, no bucket. `build`
  leaves two files under `dist/` and says where they are; copying them somewhere is the project's
  job, and the content-addressed layout makes it a copy rather than a mapping.
- **No fetching a box.** `verify` and `run` take local paths. A verb that downloaded a release would
  have to decide what to trust before verifying it.
- **No promotion, rollback or revocation.** A channel document is a file; moving a channel to a new
  release means signing a new one.
- **No persistent state.** There is no cache directory, no lock file of its own, no daemon, and no
  record of what was previously built. Everything the CLI knows comes from the workspace, the scroll
  and the arguments of the current invocation.
- **No mutation of the project's configuration** outside `init`. Flags override the workspace for one
  invocation and are never written back, so a `--out-dir` used once does not silently become the
  project's setting.
- **No interactive fallback below the edge.** No module beneath `src/cli*.mjs` reads `process.stdin`.
  A missing answer in a non-interactive environment is an error with the flag that would supply it,
  never a prompt that hangs a pipeline forever.

## 10. The invariants

<div class="h3-section-initial-part">

### 10.1 What an invariant is here

The previous sections described mechanisms. This one states the four properties those mechanisms
exist to hold, names every place each is enforced, and says what would break it.

</div>

An invariant in this codebase is not an aspiration. It is a property that some specific code refuses
to let fail, and the refusal is the feature. Three of the four are promises made to whoever receives
a [box](#box) — that it can be rebuilt, that it says truthfully where it came from, and that nothing
in it is believed before it is checked. The fourth is a promise made to whoever changes the code:
that a small set of paths, invisible to the test suite on any one machine, are checked by hand.

::: info The one-sentence form
Rebuilding the same commit produces the same bytes; a box never lies about its origin; nothing is
believed before it is verified; and four paths that the suite cannot exercise are read against every
change that touches them.
:::

<div class="h3-section-initial-part">

### 10.2 Determinism

**Rebuilding the same commit must produce a byte-identical archive.** Not an equivalent one — the
same SHA-256.

</div>

This is what makes the whole content-addressed chain worth having. If two builds of one commit could
differ, then the hash in a [release](#release) document would identify a particular *run* rather than
a particular *input*, and an auditor could never reproduce what they were asked to trust.

Determinism is not achieved by a single mechanism. It is achieved by removing, one at a time, every
source of per-run variation that a normal build tool happily lets through:

| Source of variation | What removes it | Where |
| --- | --- | --- |
| Wall-clock time in file metadata | `FIXED_ARCHIVE_TIME`, stamped with `lutimes` | `filesystem.mjs`, section 6.11 |
| Wall-clock time in the documents | Build time read from the HEAD commit, epoch outside a checkout | `scroll.mjs`, section 6.2 |
| Local timezone in ZIP timestamps | `forceDosTimestamp: true` | `archive.mjs`, section 6.12 |
| Directory enumeration order | One sorted walk, reused by every consumer of the tree | `filesystem.mjs` |
| Host locale and ICU data | `compareStableStrings` — code-unit ordering, never `localeCompare` | `filesystem.mjs` |
| The builder's umask | Entry modes derived from the [target adapter](#target-adapter) | `archive.mjs` |
| Compression settings | One pinned compression level | `archive.mjs` |
| Randomness | `cohortSalt` derived from box and version | `box.mjs`, section 6.1 |
| Interpreter bytecode caches | `__pycache__` and `*.pyc` skipped during enumeration | `filesystem.mjs` |
| Host filesystem artefacts | `.DS_Store` skipped | `filesystem.mjs` |
| Install-specific conda records | `conda-meta/` reduced to an identity allowlist | `pixi.mjs`, section 6.5 |
| Leftovers from a previous build | The build tree and object directory are removed before use | `box.mjs`, stage 4 |
| Dependency drift over time | Installation from the committed [lockfile](#lockfile), never a fresh solve | `pixi.mjs`, section 4.2 |

Two of those rows are worth reading twice. **The epoch fallback outside a git checkout is deliberate,
not a shortcut** — a wall-clock fallback would silently reintroduce exactly the variation the rest of
the list removes, in the one case where nobody would look. And **`conda-meta/` canonicalisation is
determinism applied to someone else's file format**: those records carry paths, timestamps and link
counts from the machine that installed them, which are facts about a build host rather than about a
package.

<div class="h4-section">

#### How it is proven

`tests/unit/build-pipeline.test.mjs` builds the same fixture twice and compares the archives byte for
byte, and separately compares the signed execution metadata across rebuilds. That second assertion
exists because the archive is the obvious thing to check and the documents are the easy thing to
forget: a timestamp leaking into a manifest would leave the archive identical and the release
document different, which breaks the chain just as thoroughly.

</div>

<div class="h4-section">

#### The exact scope of the promise

Determinism is claimed **per commit, per target, per pinned toolchain**. Same commit, same host
platform, same pinned pixi and conda-pack, same committed lock, same weights mode — same bytes.

It is not a claim that two different operating systems produce the same archive: they cannot, because
they package different native code, and section 5.2 is why a box is built on the host it ships for.
It is not a claim about a *re-solve* either. `lock` is where dependency resolution happens and its
output is a reviewed, committed file; `build` never solves. The lock is what turns "the same
dependencies" from a hope about upstream availability into a fact about a file in the repository.

::: warning What breaks it
Any per-run value introduced anywhere in the build: a clock read, a random number, an unsorted
`readdir`, a mode read from disk, a temporary path that reaches the payload, a compression setting
left to a library default. Each is individually harmless-looking, which is why the list above is
written out rather than left as a principle.
:::

</div>

<div class="h3-section-initial-part">

### 10.3 Provenance

**A box records the commit it was built from and whether that tree was dirty — and never
fabricates either.**

</div>

Two facts are read from git before anything expensive happens, and both end up inside the signed
release: the revision, and whether the working tree had any modification, staged or not, tracked or
untracked. `--untracked-files=all` is what makes the second answer match what a reader expects, while
Git's own ignore rules keep generated workspace state out of it.

| Situation | `build` does | The box says |
| --- | --- | --- |
| Clean checkout | Builds | The revision, `sourceTreeDirty: false` |
| Dirty tree, no flag | **Refuses** | — |
| Dirty tree, `--allow-dirty` | Builds | The revision, `sourceTreeDirty: true` |
| Not a git checkout | **Refuses** | — |

The last row is the one people try to route around, and it is the most important. A box built outside
a checkout has no revision to record; the alternatives would be to invent one, to leave the field
empty, or to refuse. Inventing is a lie. Leaving it empty makes an unverifiable box structurally
indistinguishable from a verifiable one, which is worse than a lie because it is deniable. So the
build refuses, and `doctor` reports the missing checkout with the reason attached.

The dirty case is allowed *because* it is recorded. A developer testing a change locally has a
legitimate need to build from an edited tree; what they must not be able to do is hand the result to
someone else without that fact travelling with it. `--allow-dirty` is not permission to hide the
state — it is the acknowledgement that turns it into a recorded one.

::: danger Never downgrade a dirty build
There is no path, flag or environment variable that makes a dirty build report itself as clean, and
adding one would silently invalidate every provenance claim the format makes. This is one of the
repository's hard rules, and it is enforced by the code that fails the build rather than by
convention.
:::

<div class="h3-section-initial-part">

### 10.4 Verify, never trust

**Every byte that enters the system from somewhere else is checked before it is used**, and the
check happens before the byte can have any effect.

</div>

This is a single rule applied at eight boundaries. The table is the whole invariant; nothing in
Scrollcase accepts external input without appearing in it.

| Boundary | What arrives | Checked against | On failure |
| --- | --- | --- | --- |
| Toolchain install | A pixi or conda-pack download | The published checksum, or the pinned digest | Nothing is installed |
| Asset staging | A downloaded weight file | Declared size **and** SHA-256 from the [scroll](#scroll) | Nothing is promoted into the payload |
| Asset staging | A local file or asset archive | The same declared hash; TAR entries restricted to files and directories | The build fails |
| Licence audit | The committed lock | The reviewed audit document | The build fails |
| External signing | A signed document from another process | The payload must be echoed exactly, and the signature verifies locally | The build fails |
| Release document | A signed envelope | Shape, payload hash, `schemaVersion`, a signature from a [trust key](#trust-key) | Nothing is extracted |
| Archive | The box bytes | Size and SHA-256 from the release, then per-entry validation | Nothing is extracted |
| Extracted tree | The payload on disk | Manifest agreement, safe entries, installed size, on-demand asset hashes | Nothing is executed |

Four properties of that list are what make it an invariant rather than a checklist.

**Order is part of the check.** Verification precedes execution absolutely: no consumer runs a box's
interpreter, script, module or import before signature, payload shape, archive identity, safe-entry
and manifest-agreement checks have all succeeded (section 8.2). A check performed after the thing it
protects is not a check.

**A check is re-run when the gap between checking and using is exploitable.** The consumer re-hashes
after staging rather than trusting the hash it computed before the move, and the archive reader reads
each link target once and reuses it, because reading it twice would leave a window between the value
that was validated and the value that is used (sections 8.3 and 6.12).

**No check is optional.** There is no "verify if possible" setting, no `--skip-verify`, no degraded
mode, and no fallback to a cached copy when verification fails. A check that a caller can turn off is
a check an attacker can arrange to have turned off.

**Being given something is not evidence about it.** An external signer is not trusted about the
payload it signs, a scroll is not trusted about the bytes at a URL, a release is not trusted about
the archive beside it, and an archive is not trusted about its own entries. In each case the party
supplying the input is precisely the party that would benefit from lying about it.

::: warning For contributors
An inconvenient check is not a check to delete. Every row above has cost someone time; that is what
they are for. If one is genuinely wrong, the fix is a different check, not a missing one.
:::

<div class="h3-section-initial-part">

### 10.5 The rules that constrain every change

Beyond the three guarantees, four rules bound what the project may become. Each has a mechanical
guard, because a rule with no guard survives exactly as long as everyone remembers it.

</div>

| Rule | Why | Guard |
| --- | --- | --- |
| No consuming project's name anywhere in the tool | It must stay usable by projects with nothing to do with the one that first needed it | `tests/unit/v2-migration.test.mjs` greps the whole tracked tree, content and paths |
| The document namespace belongs to the publishing project | A project with boxes in the field keeps emitting the kinds its clients recognise | `documentKinds(namespace)`; the schemas accept any well-formed namespace and nothing else |
| One substrate, and only one | Two dependency backends means proving every guarantee twice | The absence of any second backend, and section 4's single-substrate description |
| Published v1 is immutable; v2 is a clean break | A reinterpreted old document is a silent wrong answer | `decodeSignedDocument` rejects `schemaVersion: 1` with an explicit remedy |

The first guard is worth a note for anyone who reads it. It runs `git grep` over every tracked file
*and* every tracked path, and the retired term it searches for is assembled from two string fragments
inside the test so that the test file itself does not contain the word it forbids. That is not
cleverness for its own sake: a guard that trips on itself gets weakened, and a weakened guard is how
the name comes back.

<div class="h3-section-initial-part">

### 10.6 The four paths that break silently

The suite runs on one host, with the toolchain stubbed and the network unavailable. Four things are
therefore true in exactly one configuration during testing and in several in the field. **A green
suite says nothing about them.**

</div>

<div class="h4-section">

#### 1. The three targets

macOS, Linux and Windows differ in interpreter layout, scripts directory, launcher repair and native
library inspection. A change to packing, relocation or path handling has to be read against all
three, because the machine running the tests exercises one.

| | macOS / Linux | Windows |
| --- | --- | --- |
| Interpreter | `venv/bin/python` | `venv/python.exe` |
| Scripts | `venv/bin` | `venv/Scripts` |
| Launcher repair | Rewrites the [shebang](#shebang) into a shell trampoline | None — the launchers are executables, not text |
| Native inspection | `otool -L` / `ldd`, `.dylib` `.so` | `dumpbin /DEPENDENTS`, `.dll` `.pyd` |
| Payload links | Carried when they pass the link rule | None — creating one needs elevation |

The last row is the one that is easiest to forget, and `tests/unit/contract-links.test.mjs` asserts
it directly: a Windows box is link-free by contract, so any code that assumes a link is present, or
that assumes one is absent on POSIX, is wrong on one of the two.

</div>

<div class="h4-section">

#### 2. `embed` versus `on-demand` weights

The two [weights modes](#weights-mode) produce different archives, different release documents and
different consumer behaviour from the same scroll:

| | `embed` | `on-demand` |
| --- | --- | --- |
| Assets in the archive | Yes | No |
| Descriptors in the signed release | Not needed | Required |
| `assetArchives` | Allowed | **Refused** |
| Air-gapped install | Works | Needs the assets materialised first |
| Consumer before execution | Nothing extra | Verifies every materialised asset against its signed hash |

Any change to asset staging, to the manifest, or to what the consumer checks before spawning affects
both, and a test that only covers the default mode covers half the behaviour.

</div>

<div class="h4-section">

#### 3. Local key versus external signer

The local path signs in-process. The external path hands a payload to another program and gets a
document back — and that document must echo the exact payload it was given, then verify locally
before the build continues (section 7.5).

The suite covers both, but not equally. `tests/unit/signing.test.mjs` drives the dispatch through an
injected process runner, and the shared conformance fixture carries a `valid-external-signer` case
beside its `valid-local-signer` one, so both kinds of document are consumed for real. What no test
does — deliberately, since a test must never reach the network — is run an actual external signing
command. A change to the exchange itself is therefore proven against a fake process and not against
whatever a cloud KMS or an HSM does with the same bytes.

</div>

<div class="h4-section">

#### 4. Toolchain from `PATH` versus the project's own

Discovery order is the four-row table in section 4.2: an explicit flag, then `SCROLLCASE_PIXI` or
`SCROLLCASE_CONDA_PACK`, then the project's installed toolchain, then a bare name left to `PATH`.

```js
// src/build/pixi.mjs
if (path) return String(path);
const fromEnvironment = process.env[environmentVariable];
if (fromEnvironment) return String(fromEnvironment);
// … the workspace's toolchain directory, if the executable is there …
return installed && existsSync(installed) ? installed : name;
```

A machine with no project toolchain takes a different branch from one that has run
`init --install-toolchain`, and a developer's machine usually has both. Discovery changes must be
checked in both states; the fall-through when no workspace can be resolved at all is a third.

</div>

<div class="h4-section">

#### What to do about them

Read the change against each of the four, including the ones that cannot be executed on the machine
at hand. That is not a weaker form of testing — it is the honest description of what the suite
covers, written down so that "the tests pass" is never mistaken for "the four paths are fine". Where
a path *can* be exercised through an [injection seam](#injection-seam) — a fake process factory, a
stubbed host descriptor, an injected `fetch` — the suite already does, and adding a case there is
always better than adding a note here.

</div>

## 11. Test map

<div class="h3-section-initial-part">

### 11.1 Three suites, one contract

There are three independent test suites, in three languages, and none is authoritative over the
others. They meet at the shared conformance fixture described in section 8.7.

</div>

| Suite | Runner | Command | Covers |
| --- | --- | --- | --- |
| Node | Vitest | `npm test` | The contract, the build pipeline, signing, the Node consumer, the CLI, the package surface, the docs |
| Python | `unittest` | `python -m unittest discover -s tests -t .` from `python/` | The contract mirror, the Python consumer, the packaging surface |
| Rust | `cargo test` | `cargo test --all-targets` from `rust/` | The contract mirror, the schemas the types stand in for, the Rust consumer |

The Python suite is also gated by three checks that are not tests but fail the same way: `mypy src`
for static types, `python scripts/sync_schemas.py --check` for the bundled schema copies, and
`python scripts/check_distribution.py dist/*` for what the wheel and sdist actually contain. The
Rust suite is gated the same way by `cargo clippy --all-targets -- -D warnings`, by
`node scripts/sync-assets.mjs --check` for the copied fixtures and schemas, and by `cargo package`
for what the crate would actually publish. None of the three passes `--locked`, because the crate is
a library and ships no committed `Cargo.lock`: a consuming application pins its own versions, and
here the flag would only forbid writing the lockfile each command needs. All three run on Linux,
macOS and Windows,
because the layout differences of section 10.6 are exactly where a consumer breaks.

<div class="h4-section">

#### The conventions the suite is written to

**Exercise the real path, not just the import.** A module that loads is not a module that works. An
early refactor dropped a constant the licence parser used; every `audit` invocation threw a
`ReferenceError` while the suite stayed green, because nothing called that function end to end. The
lesson is written into the tests as a habit: assert the observable outcome of a real call, not the
existence of an export.

**Prefer a behaviour someone depends on.** A tampered archive is rejected; a rebuild is
byte-identical; a dirty tree is refused; a checksum mismatch installs nothing. Each of those is a
sentence a user could have written. Implementation details are asserted only where they *are* the
contract — entry ordering, argument vectors, file modes.

**Prove a new guard can fail.** A test never seen red is not yet a guard. When one is added, whatever
it protects is broken once, the failure is observed, and then it is restored.

**Never reach the network, and never write outside a temporary directory.** Every test that needs a
project creates one under the system temp directory and removes it afterwards; every test that would
need a download injects a `fetch` instead. A suite that touches the network fails for reasons that
have nothing to do with the change being tested, and a suite that writes into the repository
eventually deletes something.

</div>

<div class="h3-section-initial-part">

### 11.2 The seams that make it testable

Section 2 defines an [injection seam](#injection-seam) as a dependency passed in rather than reached
for. The suite is the reason they exist, and four of them carry most of the weight.

</div>

<div class="h4-section">

#### The fake toolchain

`run` and `runResult` are parameters, so a test can stand in for pixi and conda-pack by
*materialising exactly what each real invocation is contracted to produce*: an environment
[prefix](#prefix) with an interpreter, `conda-meta/` records, and a tarball packed from it.

```js
// tests/unit/build-pipeline.test.mjs
if (command === 'pixi' && args[0] === 'install') { … writeDeep(prefix, …); }
if (command === 'conda-pack') { … tar.c({ file: output, cwd: prefix, gzip: true }, ['.']); }
// Anything else is the box's own interpreter, running the self-test.
```

Solving is the one step that genuinely needs external tools and a network. Everything after it —
asset staging, pruning, the self-test gate, `box.json`, the deterministic archive, signing, the
publish-ready move — is the real implementation running against a real filesystem. That is the line
the suite draws: simulate the substrate, never the code under test.

The fake prefix is not a tidy stub. It plants the [symbolic link](#symbolic-link) shapes a real conda
prefix carries — icu's `current` → `78.3` directory link and a `pkgdata.inc` pointing *through* it —
because that exact shape once made a plain `python` environment fail to unpack, and a stub made only
of regular files would never have caught it. It also plants a link escaping the tree, next to a real
file at the escape target, so that a regression which followed links would copy a build-machine file
into the box and be caught doing it.

</div>

<div class="h4-section">

#### The other three

**An injectable `fetch`**, plus injectable sleep and log functions, let the asset tests assert the
exact `Range` header of a resumed download, the restart after a same-size wrong-hash response, and
the retry behaviour after a dropped connection — none of which could be provoked reliably against a
real server.

**An injectable host descriptor** (`{ platform, arch }`) lets the target-selection tests assert the
macOS Metal default, the ambiguous-host refusal, and the example target chosen for all three hosts
from any one machine — the closest the suite gets to covering the three-target path.

**A fake process factory** on both consumer sides lets execution be asserted without spawning a
Python that does not exist: the argument vector, the shell-free invocation, signal forwarding and
listener cleanup are all observable. The fake is not trusted on its own, though. Both languages also
run a *real* child — a shell trampoline that re-executes the test runner's own interpreter, standing
in for the box's Python — and assert that shell metacharacters in the arguments arrive as literal
text and create nothing. Those cases are skipped on Windows, where the trampoline shape does not
exist.

Every one of these is also how the modules stay usable as a library. A seam added for a test is a
seam an integrator can use.

</div>

<div class="h3-section-initial-part">

### 11.3 The Node suite, file by file

Twenty-seven test files under `tests/unit/`, plus two shared fixtures under `tests/helpers/`.

</div>

| File | What it proves |
| --- | --- |
| `archive-security.test.mjs` | Traversal spellings are rejected before any join; a traversal entry stops extraction before the destination is created; a link resolving inside the payload is carried, one reaching outside is refused, nothing is written *through* a link, an over-long link target is refused; scroll tarball links are rejected before any extracted asset is copied; entries are ordered by raw path strings, not host collation |
| `assets.test.mjs` | Only bytes matching the declared size **and** hash are written; a resumed download sends the exact `Range` header; a same-size wrong-hash response is never promoted and restarts cleanly; a dropped connection is retried through injected time and logging |
| `build-pipeline.test.mjs` | The pipeline end to end: scroll layout and target resolution, every refusal that must happen before probing or fetching, a full build-sign-verify, signed environment propagation into both manifests and self-tests, platform-correct symlink handling, `conda-meta/` reduced to identity, the `dist/` layout with nothing written twice, a **byte-identical rebuild** of the same commit, dirty-tree and non-checkout refusals, on-demand descriptors instead of packed assets, detection of a tampered archive, rejection of an untrusted key, and manifest agreement field by field |
| `cli-args.test.mjs` | Every application argument after `--` is preserved byte for byte; the inline, separated and bare flag forms still parse as before |
| `cli-init.test.mjs` | Every answer is collected before any installer runs; PyPI is offered when conda-forge was chosen without conda; a declined fallback installs nothing; no consumer questions are asked when there is no example |
| `cli-output.test.mjs` | Symbols survive redirection while ANSI does not; only the symbol is coloured; `NO_COLOR` wins even when empty; the distribution summary is relative and hash-free |
| `cli-run.test.mjs` | Exactly one release path before the separator; `runBox` is called once and the child's exit code is preserved; environment report flags and stderr formatting; a termination signal is re-raised *after* cleanup; the real CLI preserves application arguments and exit status, and forwards Ctrl-C while still removing the temporary box; a library-only release and an unmaterialised on-demand asset are refused; a non-native target is refused before any interpreter is spawned |
| `cli-signing.test.mjs` | The preflight fails clearly when no local keys exist, refuses to overwrite an incomplete pair, and requires the trust key for an external signer without offering to generate one |
| `cli-target-choice.test.mjs` | The whole selection policy: sole host target without a terminal, refusal of an ambiguous non-terminal choice, the macOS Metal default and preselection, the navigable menu, explicit `--target` honoured and validated, scroll selection through the menu and its non-terminal refusal, canonical target parsing including the CUDA ABI, example-scroll creation, `--no-example`, non-terminal `new scroll`, and the channel and weights menus |
| `cli-version.test.mjs` | `-v` and `--version` print exactly the package version, run from an unrelated working directory |
| `cli-verify.test.mjs` | `verify --extracted` delegates to the consumer, reports signed identity and entry count, names a tampered path through the CLI failure edge, emits masked and explicitly revealed environment reports, refuses archive/self-test combinations, and requires a directory value |
| `consumer-conformance.test.mjs` | Every case in the shared fixture, through the Node consumer |
| `consumer-setup.test.mjs` | Conda detection from the workspace root; npm run through `cmd.exe` on Windows; the PEP 668 user-install fallback; a clear error when conda disappears after selection; an unknown package source rejected before anything runs |
| `consumer.test.mjs` | Preparation, attachment, installed-payload verification, execution and one-shot: immutable process-bound receipts, environment precedence and reports at every surface, root and asset checks, list-not-directory semantics, named corruption failures, shell-free invocation, signals, and cleanup on every terminal path |
| `contract-links.test.mjs` | The link rule: the shapes a real prefix produces are accepted; targets escaping the payload, host-only shapes, cycles, over-long chains, dangling links and directory targets are refused; writing through a directory link is refused while an unused one is fine; and a Windows box is link-free |
| `contract-payload-digest.test.mjs` | The canonical payload entry stream against shared golden vectors, including byte ordering above the BMP, newline framing, link/file discrimination, parsing refusals, and the collector's self-exclusion |
| `contract-schema.test.mjs` | The schemas describe what the builder actually emits — real release, channel, box and scroll documents validate, the channel vocabulary is the same in code and schema, every shipped example scroll validates, the execution union is canonical, release and box manifests carry the same optional execution contract; the namespace defaults to `scrollcase.box`, accepts a project's own, and rejects a malformed one; the envelope rejects a payload-hash mismatch and any missing field; and a shipped signed example verifies against its public key |
| `contract-targets.test.mjs` | Every golden target-ID case; every unsupported target and invalid CUDA combination refused; adapters cover the accepted matrix and describe a layout consumers can rely on; the archive backend names the versions the package actually installs; the conda subdir mapping; the native-host and entry-point assertions |
| `docs-contract.test.mjs` | The documentation is checked against the code: schemas are published byte-identically on the routes their `$id`s claim, the privacy page exists and is linked, no third-party script is loaded, every CLI verb and option appears in the CLI reference, every public runtime export appears in the API reference, every complete JSON example parses and validates, internal routes resolve — and the three white-paper drift cases in section 11.5 |
| `execution-contract.test.mjs` | A Python script must be a regular archive file at its exact safe path; runnable modules are found in both the POSIX and Windows layouts; a module in neither the box root nor its environment is refused |
| `package-surface.test.mjs` | Every advertised subpath exists and resolves; `files` ships everything the exports map points at; the executable ships under the canonical command name; each entry point imports the way a dependent would; the browser graph reaches no Node built-in; a strict TypeScript consumer type-checks every entry point; an `npm pack` dry run contains the complete consumer import closure; the schema and fixture wildcards resolve; and both generated surfaces still match their sources |
| `environment.test.mjs` | Case-aware Windows precedence, inherited-environment preservation, compact selection, host-value masking, explicit reveal, and report formatting |
| `parity.test.mjs` | The metrics themselves — absolute error, relative error, cosine similarity, the zero-reference case, a length mismatch, which bound was breached — and the gate: one run per accelerator under each accelerator environment with the declared box environment applied, a failing build on drift, non-finite output refused, non-numeric output refused, at least two accelerators required, and the whole gate skipped when a scroll declares none |
| `project-surface.test.mjs` | `init` scaffolds the workspace and never overwrites, so re-running is safe; `doctor` reports every problem at once with a remedy each, reports a wrong pixi version as a failure rather than an absence, and **writes nothing**; `audit` summarises straight from the lock, writes the reviewed copy only when asked, and fails when the lock no longer matches it |
| `scroll-authoring.test.mjs` | Every authored shape — library-only, wizard answers, a module with default arguments, the Windows interpreter and conda platform derived from the adapter — plus a staged script hashed at a safe payload path, a generated starter whose declared hash matches its bytes, an initialised example left untouched, and refusal to overwrite anything |
| `signing.test.mjs` | The external signer: a quoted command with spaces is parsed and its result verified locally; a signer that validly signs a *different* payload is rejected; an invalid signature is rejected even when the payload was echoed exactly |
| `toolchain.test.mjs` | The published asset name and URLs per host, a null rather than a guessed URL for an unsupported host, digest parsing in both checksum-file forms, verified installation including across filesystems, a checksum mismatch installing **nothing**, the pinned digest preferred over the server's, the pinned conda-pack version, and the `init` offer — nothing downloaded on a no, only what is missing asked for, both pins recorded, an unsupported host reported |
| `v2-migration.test.mjs` | Only the canonical v2 scroll schema is published; a v1 signed document is rejected with the migration remedy; the channel vocabulary is closed; the workspace exposes no legacy field; and no retired product terminology survives in tracked content or paths |

The two helpers are shared rather than duplicated: `consumer-box-fixture.mjs` builds a real signed box
— through `createDeterministicZip`, `signDocument` and the real target adapter — for both the local
and the external signer, and `consumer-conformance.mjs` builds the mutated archives the shared
fixture describes.

<div class="h3-section-initial-part">

### 11.4 The Python and Rust suites

Six test files under `python/tests/`, plus two support modules.

</div>

| File | What it proves |
| --- | --- |
| `test_contract.py` | The mirror is faithful: every canonical target-ID and payload-digest vector in the shared fixtures, bundled schemas are exact generated copies, and the payload link rule accepts and refuses exactly what the Node implementation does |
| `test_verify.py` | Verification, extraction, attachment and installed-payload checking: immutable typed receipts with honest status, existing/file/link roots handled correctly, native-host and asset checks, list-not-directory semantics, named tampering failures, v1 and invalid signatures refused before extraction, archive/manifest disagreement, installed size, and hostile ZIP entries |
| `test_run.py` | Execution: signed and caller arguments preserved in order without a shell, environment reports from verification, attachment and execution, release precedence and masking, `-m` invocation, a **real** child process preserving shell metacharacters, on-demand assets verified before spawning, replaced roots and forged receipts and library-only boxes refused, a non-native target refused before spawning, signals forwarded with parent handlers restored, one-shot execution removing its temporary bytes on every terminal path, and the real standard streams routed through the box interpreter |
| `test_conformance.py` | Every case in the shared fixture, through the Python consumer |
| `test_public_api.py` | The package exports the five consumer operations and immutable environment report models, with every public name declared in `__all__` |
| `test_release.py` | The release tag check accepts `python-v<version>`, and rejects both the Node tag namespace and a mismatched version — so the two packages cannot be released under each other's tags |

`support.py` and `conformance_support.py` are the Python counterparts of the Node helpers, and
deliberately share no code with them: `zipfile` and hand-built `ArchiveEntry` records against `yazl`
and mutated ZIP bytes. Three independent harnesses agreeing on one expectation file is evidence
about the contract; one shared harness would only be evidence about itself.

Seven test files under `rust/tests/`, plus one support module.

| File | What it proves |
| --- | --- |
| `contract.rs` | The mirror is faithful: every canonical target-ID and payload-digest vector in the shared fixtures, and the link rule accepting and refusing exactly what the other implementations do |
| `schema.rs` | The types the crate parses with and the canonical schemas reach the same verdict on the examples and on mutations chosen where a typed parse and a schema most plausibly drift — an unknown field, a missing required field, a pattern violation, a broken bound, the `weights`/`assets` co-requirement |
| `release_document.rs` | The half of the trust chain that needs no archive, over a real release signed the way `signWithLocalKey` signs — so the crate is proved against documents the signer it exists to read produced, not documents it produced itself |
| `archive.rs` | The read-only chain over real archives: each case breaks exactly one thing and asserts *which* check fired, because a check that fires for the wrong reason has stopped working |
| `prepare.rs` | Preparation, attachment and payload verification: the only three ways to obtain the receipt the execution surface accepts |
| `run.rs` | Execution against a really spawned fixture interpreter — the argument vector, the environment, the process lifecycle, and forwarded signals |
| `conformance.rs` | Every case in the shared fixture, through the Rust consumer |

`support/mod.rs` is the third harness: the `zip` crate, its own `Entry` records, and its own
central-directory patching for the cases that need a hostile archive. `run.rs` is unix-gated, because
its stand-in interpreter is a shell script; the code it exercises is not, and its Windows branches
are read against the same expectations. The rest of the suite does run there, which is how a
Windows-only defect in preparation — a staging path canonicalised after the rename that had moved
it, so that every preparation failed — was caught before the crate was published.

<div class="h3-section-initial-part">

### 11.5 The three drift cases for this document

A white paper describing a codebase is a document that decays silently. Three cases in
`docs-contract.test.mjs` make the decay loud.

</div>

| Case | Fails when |
| --- | --- |
| Every module under `src/**/*.mjs` appears in the white paper | A module is added, renamed or moved without documenting it |
| Every public export in `package.json` `exports` appears, with every named runtime export | A new export is published without describing it, or one is renamed |
| Every intra-page `](#…)` anchor resolves to a heading that exists | A glossary entry is renamed, or a heading it points at is reworded |

The third exists because nothing else covers it. VitePress fails a build on a dead link *between*
pages, but an anchor into the same page that matches no heading renders as a link that quietly goes
nowhere — and in a document whose every technical term links to a glossary entry, that would be the
first thing to rot. The check recomputes each heading's slug the way the site generator does, from
the raw Markdown, so it needs no built site to run.

The first two are what keep the module-by-module promise honest. This document claims to describe
every module and every public surface; the test is what makes that claim falsifiable rather than
aspirational.

<div class="h3-section-initial-part">

### 11.6 What the suite deliberately does not prove

Stated plainly, because "the tests pass" is only meaningful next to this list.

</div>

- **No real box is ever built.** No pixi solve, no conda-pack, no gigabytes, no network. The build
  tests exercise every stage around the substrate, with the substrate simulated (section 11.2).
- **No real toolchain is ever installed.** Downloads, checksums and installation are driven through
  injected primitives; the bytes are fabricated in the test.
- **One host at a time.** The build tests target whichever platform the suite is running on, because
  the native-host gate rightly refuses anything else. Section 10.6 is the list of what that leaves
  uncovered.
- **No real external signer.** The dispatch is proven against an injected process runner.
- **No printed output.** The print layout of this page is verified by a human printing it, not by a
  test.
- **The docs build is a separate gate.** `cd docs && npm run build` is what fails on a dead link
  between pages; `npm test` does not render the site.

::: info The escalation ladder
`npm test` after every change. `cd docs && npm run build` when documentation changed. `npm run types`
then `npm test` when a schema changed. The Python suite, `mypy`, the schema check, the wheel build
and the distribution inspection when `python/` changed. `cargo test`, `cargo clippy`, the asset
check and `cargo package` when `rust/` changed. A real build only when a human asks for one.
:::

## 12. Appendices

<div class="h3-section-initial-part">

### 12.1 Module summary

Every JavaScript module the package ships, with the section that describes it. Four directories, one
responsibility each: the format, what produces it, what signs it, what consumes it — and the command
line over all of them. The Rust crate follows at the end, since it ships separately.

</div>

<div class="h4-section">

#### `src/contract/` — the format

| Module | Role | Section |
| --- | --- | --- |
| `src/contract/index.mjs` | The contract entry point: the single source of truth for what a box is | 5.1 |
| `src/contract/browser.mjs` | The same model without any Node built-in, for a browser or an edge runtime | 5.1 |
| `src/contract/targets.mjs` | The [target](#target) model, the identity rule, and the adapter per target | 5.2 |
| `src/contract/document-shape.mjs` | The platform-neutral parts of the [envelope](#envelope): shape checks and namespacing | 5.3 |
| `src/contract/documents.mjs` | The envelope reference implementation, including payload decoding | 5.3 |
| `src/contract/links.mjs` | The rule deciding which [symbolic links](#symbolic-link) a payload may carry | 5.4 |
| `src/contract/payload-digest.mjs` | The canonical entry list a release commits to, so an extracted install can be re-identified | 5.5 |

</div>

<div class="h4-section">

#### `src/build/` — what produces a box

| Module | Role | Section |
| --- | --- | --- |
| `src/build/index.mjs` | The build layer's public surface | 6.18 |
| `src/build/box.mjs` | `buildBox` — the pipeline itself, as one ordered function | 6.1 |
| `src/build/scroll.mjs` | Reading a [scroll](#scroll), resolving a reference, and reading git [provenance](#provenance) | 6.2 |
| `src/build/workspace.mjs` | [Workspace](#workspace) discovery and path resolution | 6.3 |
| `src/build/schema-validation.mjs` | Dependency-free runtime validation against the shipped schemas | 6.4 |
| `src/build/pixi.mjs` | Tool discovery, the exact pixi and conda-pack arguments, packing and relocation | 6.5 |
| `src/build/launchers.mjs` | Repairing the console scripts a conda environment generates | 6.6 |
| `src/build/assets.mjs` | Verified download, verified copy, archive expansion, and the publish-ready move | 6.7 |
| `src/build/licenses.mjs` | The [SPDX](#spdx) licence inventory derived from the [lockfile](#lockfile) | 6.8 |
| `src/build/audit.mjs` | `auditScroll` — the inventory as a command, with the reviewed-copy comparison | 6.8 |
| `src/build/execution.mjs` | Static execution prerequisites shared by the builder and the verifier | 6.9 |
| `src/build/parity.mjs` | The optional cross-accelerator numerical gate | 6.10 |
| `src/build/filesystem.mjs` | [Determinism](#determinism) and path-safety primitives | 6.11 |
| `src/build/archive.mjs` | Deterministic ZIP writing, and defensive reading | 6.12 |
| `src/build/identity.mjs` | Where a release's artefacts live relative to everything else | 6.13 |
| `src/build/verify.mjs` | `verifyBox` — a consumer's install-time checks, run locally | 6.15 |
| `src/build/project.mjs` | `init` and `doctor`: scaffolding, and diagnosis that writes nothing | 6.16 |
| `src/build/authoring.mjs` | Atomic creation of one target-specific scroll | 6.16 |
| `src/build/consumer-setup.mjs` | The optional consumer dependencies an initialised project may want | 6.16 |
| `src/build/toolchain.mjs` | Checksum-verified installation of pixi and conda-pack, only on consent | 4.2 |
| `src/build/process.mjs` | `fail`, `run` and `runResult` — the one error path and the subprocess seam | 6.17 |

</div>

<div class="h4-section">

#### `src/sign/` and `src/consumer/`

| Module | Role | Section |
| --- | --- | --- |
| `src/environment.mjs` | Case-aware environment precedence, provenance reports, masking and CLI formatting | 6.17, 8.4 |
| `src/sign/index.mjs` | Two signing paths and one envelope: a local key, or an external signer | 7.3, 7.5 |
| `src/sign/keys.mjs` | Key generation, reading a pair back, and signature verification | 7.2, 7.4 |
| `src/consumer/index.mjs` | The local execution surface: the five operations and nothing else | 8.1 |
| `src/consumer/verify-and-extract.mjs` | Preparation, attachment and installed-payload verification, with opaque receipts for the executable paths | 8.3, 8.9 |
| `src/consumer/run-extracted.mjs` | Shell-free execution of a box this process already prepared | 8.4 |
| `src/consumer/run-box.mjs` | One-shot: prepare into a private temporary root, run, remove every byte | 8.5 |

</div>

<div class="h4-section">

#### `src/cli*.mjs` — the edge

| Module | Role | Section |
| --- | --- | --- |
| `src/cli.mjs` | Argument dispatch, workspace configuration, and the single failure path | 9.1, 9.2 |
| `src/cli-args.mjs` | The flag grammar and the `--` passthrough boundary | 9.3 |
| `src/cli-menu.mjs` | The raw-key menu, and the policy that turns a flag or a terminal into a choice | 9.4 |
| `src/cli-targets.mjs` | Target and scroll selection, including the host defaults | 9.4 |
| `src/cli-authoring.mjs` | Input collection for `new scroll`, from flags or prompts | 9.4 |
| `src/cli-init.mjs` | The order of `init`'s optional work: every answer before any installer | 9.4 |
| `src/cli-signing.mjs` | The read-only signing preflight | 7.6 |
| `src/cli-run.mjs` | Translating a child's terminal result into this process's own | 8.8 |
| `src/cli-output.mjs` | Status symbols, optional colour, and the distribution summary | 9.5 |

</div>

<div class="h4-section">

#### `rust/src/` — the crate

Published separately, and listed here because it implements the same section 8 as the modules above.

| Module | Role | Section |
| --- | --- | --- |
| `error.rs` | One opaque error type and the `fail!` macro — the single failure path, deliberately not an enum a caller could match on and come to depend on | 8.1 |
| `path.rs` | The path-safety primitive every extraction and attachment goes through | 8.2 |
| `contract/` | The mirror: `targets.rs`, `documents.rs`, `links.rs`, `payload_digest.rs` | 5.2–5.5 |
| `trust.rs` | The trust file, key rotation, and strict ed25519 verification | 7.4 |
| `release.rs` | The typed release and box manifests, refusing an unknown field where the others run a schema | 8.1 |
| `archive.rs` | Defensive reading and extraction, including the duplicate-name check the ZIP backend cannot make | 8.2, 8.6 |
| `filesystem.rs` | Walking, sizing and validating an extracted tree, links included | 8.3 |
| `execution.rs` | The static execution prerequisites | 8.4 |
| `environment.rs` | Environment precedence, masking and the report | 8.4 |
| `verify.rs` | Release inspection, manifest agreement, archive inspection | 8.2 |
| `prepare.rs` | `PreparedBox` and the three ways to obtain one | 8.3, 8.9 |
| `run.rs` | Shell-free execution, the `SpawnBox` seam, and caller-owned signal forwarding | 8.4, 8.5 |

</div>

<div class="h3-section-initial-part">

### 12.2 Index of public exports

Anything in this appendix is a public API. Changing a name, a signature or a meaning here is a
change to the package's contract, not an implementation detail.

</div>

<div class="h4-section">

#### The subpaths

| Subpath | Provides |
| --- | --- |
| `scrollcase/contract` | The complete contract, including payload decoding and hashing through Node's `crypto` |
| `scrollcase/contract/browser` | The same model with no Node built-in reachable from it |
| `scrollcase/contract/types` | The generated TypeScript definitions for every document the format defines |
| `scrollcase/contract/schema/*.json` | The canonical JSON Schemas, resolvable by a mirror implementation |
| `scrollcase/contract/fixtures/*.json` | The golden fixtures a mirror implementation proves itself against |
| `scrollcase/build` | Building, packing, verifying, auditing and workspace resolution |
| `scrollcase/sign` | Key generation, signing, decoding and verification |
| `scrollcase/consumer` | The five local execution operations |

There is deliberately **no root export**. Importing `scrollcase` gets nothing; every consumer names
the surface it depends on, which is what lets the browser-safe subset stay browser-safe and lets a
consumer-only dependent avoid the entire build layer.

</div>

<div class="h4-section">

#### `scrollcase/contract`

| Export | Kind | Meaning |
| --- | --- | --- |
| `BOX_SCHEMA_VERSION` | constant | `2` — the only format version this release reads or writes |
| `CHANNELS` | constant | The closed vocabulary: `nightly`, `beta`, `stable` |
| `DEFAULT_DOCUMENT_NAMESPACE` | constant | `scrollcase.box`, used when a project declares none |
| `PAYLOAD_ENCODING` | constant | The envelope's payload encoding identifier |
| `SIGNATURE_ALGORITHM` | constant | `ed25519` |
| `boxTargetId` | function | The canonical [target ID](#target-id) for a validated target |
| `boxTargetAdapter` | function | The [target adapter](#target-adapter) for one target |
| `boxTargetAdapters` | function | A fresh array of every adapter the format defines |
| `condaSubdir` | function | The [conda subdir](#conda-subdir) a target maps to |
| `pixiAccelerator` | function | The accelerator descriptor a scroll selects |
| `assertNativeHost` | function | Refuses a build on a host that is not the target it ships for |
| `assertPythonEntryPoint` | function | Refuses an entry point that disagrees with the adapter layout |
| `documentKinds` | function | The three `kind` strings for a publishing project's namespace |
| `parseDocumentKind` | function | Splits a `kind` back into namespace and document type |
| `isSignedBoxDocument` | function | The structural envelope guard — shape only, never trust |
| `decodeDocumentPayload` | function | Decodes an envelope payload after checking its hash |
| `schemaUrl`, `fixtureUrl` | function | Resolve a shipped schema or fixture from a dependent package |

`scrollcase/contract/browser` exports the same set minus `decodeDocumentPayload`, `schemaUrl` and
`fixtureUrl`. The first needs Node's `crypto` to hash a payload; the other two build no more than a
`URL` against the module's own location, and are left out because what they resolve to is a file on
disk beside the installed package rather than something a browser can fetch.

</div>

<div class="h4-section">

#### `scrollcase/sign` and `scrollcase/consumer`

| Export | Meaning |
| --- | --- |
| `generateSigningKey` | Creates a local [ed25519](#ed25519) pair, writing the private and public files |
| `readSigningKey` | Reads a pair back, cross-checking that the two files belong together |
| `signDocument` | Signs a payload with a local key, or through an external signer command |
| `verifySignedDocument` | Verifies an envelope against a [trust key](#trust-key) set |
| `decodeSignedDocument` | Decodes an envelope **without** verifying it — named for what it does not do |
| `verifyAndExtractBox` | Verifies a local box and prepares it at a destination, returning a receipt |
| `attachExtractedBox` | Re-identifies an already-extracted box in a new process, without its archive |
| `verifyExtractedPayload` | Proves an installed tree against the entry list its release commits to |
| `runExtractedBox` | Executes a box this process prepared or attached, shell-free, forwarding signals |
| `runBox` | One-shot: prepare into a temporary root, execute, remove every byte |

</div>

<div class="h4-section">

#### `scrollcase/build`

| Export | Meaning |
| --- | --- |
| `CONDA_PACK_VERSION` | The conda-pack version a managed install pins |
| `DEFAULT_WORKSPACE_PATHS`, `SCROLLCASE_CONFIG_FILENAME` | The workspace defaults and the config file name |
| `resolveWorkspace`, `configureWorkspace`, `getWorkspace`, `findWorkspaceConfig` | Workspace resolution and the per-process installed workspace |
| `workspaceOverridesFromArgv`, `workspaceOverridesFromFlags` | Turning caller arguments into workspace overrides |
| `findPixi`, `findCondaPack` | Toolchain discovery, in the documented precedence order |
| `pixiLockArguments`, `pixiInstallArguments`, `condaPackArguments` | The exact argument vectors, as data |
| `installAndPackPixiEnvironment` | Solve-free install, pack, extract and repair into the payload |
| `repairPosixLaunchers` | The [shebang](#shebang) trampoline repair |
| `createDeterministicZip`, `listZipEntries`, `extractZipArchive` | Deterministic writing and defensive reading |
| `collectFiles`, `fileExists`, `sha256File` | Payload enumeration and streaming hashing |
| `payloadDigest` | The canonical entry list of an extracted tree, reduced to one hash |
| `boxReleaseStem`, `boxReleaseObjectPrefix`, `builderVersionFields` | Release naming and builder identity |
| `lockedCondaDistributions`, `parseCondaPackageReference` | Reading the lock into package identities |
| `createCondaDependencyLicenseAudit`, `validateCondaDependencyLicenseAudit` | Producing and checking the licence inventory |
| `run`, `runResult`, `fail` | The subprocess seam and the single error path |

</div>

<div class="h3-section-initial-part">

### 12.3 Closing

</div>

Scrollcase is a small tool with a narrow promise, and almost every design decision in this document
exists to keep the promise narrow. A [box](#box) is a Python environment for one operating system and
one accelerator, built from a reviewed [lockfile](#lockfile), packed so that it runs elsewhere,
signed so that it can be proven, and accompanied by an inventory of what it contains. It is not a
registry, not a scheduler, not a distribution system, and not a judge of whether the thing inside it
is scientifically right.

::: info The whole thing, in one sentence
Given a scroll and a committed lock, Scrollcase produces bytes that can be rebuilt exactly, proven to
come from a known commit and a known key, and refused entirely when any part of that fails.
:::


<style>
  @media print {
    .VPNav,.VPLocalNav,.VPSidebar,.aside,.VPDocFooter,.VPSkipLink,#download-options-list {
      display: none !important;
    }

    /* #download-options-list ul li:nth-child(3) {
      display: none !important;
    } */

    .VPContent {
      padding: 0 !important;
    }

    .container {
      max-width: 100% !important;
      display: flex !important;
    }

    .container .content {
      max-width: 1000px !important;
    }

    .container .content-container {
      max-width: 100% !important;
    }

    h1,h2,h3,.h4-section,.h3-section-initial-part,p {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    h2 {
      page-break-before: always !important;
      break-before: always !important;
    }
  }
</style>
