---
title: Scrollcase vs Other Packaging Tools
description: Choosing between Scrollcase and other solutions and packaging tools.
aside: false
---

# Scrollcase *vs* Other Packaging Tools

Complete comparison between Scrollcase and other packaging tools, understanding when Scrollcase is a better fit, and how it differs from Docker, Pixi, conda-pack, PEX, PyInstaller and other tools, and when a simpler solution is the better choice.

**Scrollcase** primary goal is:

> “Build a target-specific scientific models or AI runtime once, publish it as an immutable signed artifact, and let another application verify, install, and run it without resolving dependencies or requiring a container runtime.”

## Tools and decision guide

<Tabs :titles="['TL;DR','Pixi','conda-pack','Containers','PEX','PyInstaller','AppImage']">
<Tab title="Pixi">

### vs Pixi alone

Pixi is the environment manager underneath Scrollcase.

It is responsible for work such as:

- declaring Conda and PyPI dependencies;
- resolving compatible packages;
- recording exact package builds in `pixi.lock`;
- installing and running project environments;
- supporting platform-specific environments and tasks.

For many projects, that is the complete solution.

A developer can commit `pixi.toml` and `pixi.lock`, ask another developer or CI runner to install Pixi, and recreate the environment locally.

Scrollcase starts where that workflow stops.

A Scrollcase consumer is not asked to install Pixi, resolve packages, or reconstruct an environment. It receives an already built artifact and verifies what it received before using it.

Scrollcase adds:

- installation strictly from the committed lock during the build;
- a target-specific, relocatable environment;
- deterministic archive construction;
- declared local files and verified assets;
- self-tests using the interpreter inside the box;
- source and lock provenance;
- dependency licence inventory;
- signed release metadata;
- content-addressed archives;
- safe extraction and execution through Node and Python consumers.

### Choose Pixi alone when

- every machine may install Pixi;
- reconstructing the environment at installation time is acceptable;
- the environment is mainly for developers, notebooks, CI, or internal jobs;
- you do not need a signed distributable artifact;
- you do not need a stable contract between a publisher and an external consuming application.

### Choose Scrollcase with Pixi when

- the environment must be built once and delivered as an artifact;
- the end user should not resolve or install dependencies;
- the consuming application must verify the exact bytes it receives;
- builds need recorded provenance and reproducible output;
- the project distributes several operating-system or accelerator variants.

</Tab>
<Tab title="conda-pack">

### vs conda-pack alone

Scrollcase uses conda-pack, but is not only conda-pack. Conda environments are not generally relocatable by copying their directory, so conda-pack packages an existing environment and applies relocation logic.

Scrollcase deliberately uses that implementation rather than inventing another environment packer.

Using conda-pack directly can be the right design:

```text
create environment
↓
run conda-pack
↓
upload archive
↓
extract it elsewhere
```

Scrollcase turns that operation into a stricter release pipeline:

```text
describe target and runtime
↓
resolve and commit the exact lock
↓
install and pack from that lock
↓
stage code and verified assets
↓
prune and repair the payload
↓
self-test with the payload interpreter
↓
build a deterministic archive
↓
sign the release document
↓
verify and consume it through a defined contract
```

### Choose conda-pack alone when

- you already have a working Conda environment;
- a normal archive is sufficient;
- your deployment system owns all metadata, signing, validation, and extraction policy;
- byte-identical rebuilds and a public artifact contract are not requirements.

### Choose Scrollcase when

- the archive must be tied to a declarative source and committed lock;
- the release needs signed identity, hashes, provenance, and runtime metadata;
- hostile or malformed archives must be rejected before extraction;
- Node and Python applications need the same documented consumption semantics;
- model files, licence inventory, and target metadata belong in the build contract.

</Tab>
<Tab title="Containers">

### vs container systems (eg. Docker)

Container systems like Docker packages an application and its runtime into a container image. A container runs as an isolated process through a container runtime and is a natural fit for services, servers, CI, orchestration, and container-native infrastructure.

Scrollcase produces a host-native environment archive.

A box is extracted onto the machine and its own Python interpreter is run directly. It does not provide:

- process isolation;
- kernel namespaces;
- container networking;
- image layers;
- volumes;
- service orchestration;
- a registry;
- a daemon or container runtime.

This difference is intentional.

A desktop application may need to install a local scientific model and invoke it like an ordinary child process. Requiring Docker Desktop, a daemon, container permissions, image management, and host integration may be inappropriate for that product.

Conversely, a backend service already deployed on Kubernetes usually benefits more from a container image than from a Scrollcase box.

### Choose a container system when

- the deployment environment already supports containers;
- process isolation is part of the requirement;
- the application is a service or infrastructure component;
- standard container registries and orchestration solve your distribution problem;
- including a Linux userland is acceptable.

### Choose Scrollcase when

- a desktop or local application must run Python directly on the host;
- installing a container runtime is undesirable;
- macOS Metal, Windows, or host-specific accelerator integration matters;
- the application wants to own download, installation, activation, rollback, and removal;
- the delivered environment must be verified independently of its download path.

::: warning A box is not a sandbox
Signature and archive verification establish what was received. They do not make the Python code safe to execute. A consuming application must trust the publisher whose public key it accepts.
:::

</Tab>
<Tab title="PEX">

### vs PEX

Scrollcase is environment-oriented; PEX is Python-application-oriented. PEX builds executable Python environments from Python distributions. It is especially useful for Python applications and command-line tools that should be distributed as a single executable environment.

Scrollcase has a different unit of delivery.

A box contains a complete target-specific Python prefix built from Conda and PyPI dependencies. That makes it suitable for scientific stacks whose runtime may depend on:

- a particular Python interpreter;
- Conda-provided native libraries;
- compiled extension modules;
- BLAS or other numerical libraries;
- accelerator-specific packages;
- files and model assets that are not Python distributions.

Scrollcase also separates the runtime artifact from the application that consumes it. A desktop application can download and prepare a box, retain a verified receipt, and invoke a declared script or module when needed.

### Choose PEX when

- the deliverable is fundamentally one Python application or CLI;
- dependencies are naturally represented as Python distributions;
- PEX's execution and interpreter model fits the target systems;
- you do not need Scrollcase release, channel, asset, or consumer semantics.

### Choose Scrollcase when

- the deliverable is a reusable scientific or model runtime;
- Conda packages and native dependencies are first-class inputs;
- the box is installed and managed by another application;
- release identity, signatures, hashes, self-tests, and target metadata must travel together.


</Tab>
<Tab title="PyInstaller">

### vs PyInstaller

Scrollcase is not an application freezer like PyInstaller. PyInstaller analyzes a Python application and bundles it with the interpreter and dependencies needed to run it. It can produce a one-directory bundle or a single executable.

That is often the most direct way to ship a Python desktop application.

Scrollcase does not attempt to turn the model runtime into a native-looking executable. It preserves a real Python environment and exposes declared Python scripts or modules through a verified consumer.

This is useful when the Python runtime is one component inside a larger product rather than the product's top-level executable.

For example:

```text
native or web-based desktop application
↓
downloads the correct model box
↓
verifies and prepares it
↓
runs the declared Python entry point
↓
handles UI, updates, storage, and lifecycle itself
```

### Choose PyInstaller when

- you are shipping one Python application directly to the end user;
- a frozen executable or application bundle is the desired product;
- automatic import analysis and application-centric packaging fit the project;
- you do not need an independently installable model environment.

### Choose Scrollcase when

- the main application is not necessarily written in Python;
- Python is a managed runtime component of a larger application;
- several boxes or versions may be installed independently;
- the application needs explicit release documents and verification;
- the environment must remain inspectable as a normal Python prefix.


</Tab>
<Tab title="AppImage">

### vs AppImage

Scrollcase is not a Linux application format like AppImage. AppImage packages a Linux application and the dependencies that cannot be assumed to exist on the target system into one executable file. Users can download it, mark it executable, and run it without a traditional installation or root privileges.

Scrollcase packages a different unit: a target-specific Python runtime intended to be verified,
prepared, and invoked by another application. It supports Linux, macOS, and Windows targets and
treats operating system, architecture, accelerator, dependency lock, release identity, and
verification metadata as part of the artifact contract.

### Choose AppImage when

- the deliverable is a complete Linux desktop application;
- one downloadable executable file is the desired user experience;
- support for macOS and Windows is handled through separate packaging formats;
- the application itself owns its top-level UI and lifecycle;
- a separately managed Python-runtime contract is unnecessary.

### Choose Scrollcase when

- Python is one runtime component inside a larger product;
- the consuming application must install or switch between several runtime boxes;
- CPU, CUDA, Metal, macOS, Windows, and Linux variants need explicit identities;
- signed release documents and independent archive verification are requirements;
- the runtime should remain separate from the application's own distribution format.

</Tab>
<Tab title="TL;DR">

| Tool | Primary job | Best fit | What Scrollcase adds |
| --- | --- | --- | --- |
| [Pixi](https://pixi.sh/) | Resolve, lock, install, and run project environments | Development, CI, and reproducible environment management | Relocation, packaging, signed release metadata, deterministic archives, verification, and consumer APIs |
| [conda-pack](https://conda.github.io/conda-pack/) | Archive an existing Conda environment so it can be moved | Direct environment deployment with a small custom delivery layer | A declarative source, locked build pipeline, pruning, assets, provenance, signing, manifests, verification, and safe consumers |
| [Docker](https://docs.docker.com/get-started/docker-overview/) | Package and run applications as isolated containers | Services, infrastructure, reproducible server deployment, and container-native systems | Host-native execution without a container runtime, target-specific accelerator boxes, signed local artifacts, and application-owned installation |
| [PEX](https://pex.readthedocs.io/) | Build executable Python environments from Python distributions | Python applications and command-line tools distributed as executable environments | A complete Conda-based prefix, non-Python native dependencies, model assets, signed release documents, and a separate consumer contract |
| [PyInstaller](https://pyinstaller.org/en/stable/) | Freeze a Python application and its dependencies into an executable bundle | Shipping a standalone end-user application | A reusable environment box rather than one frozen application, plus locks, provenance, content addressing, release channels, verification, and consumer APIs |
| [AppImage](https://appimage.org/) | Distribute a Linux desktop application as one portable executable file | Shipping self-contained applications across Linux distributions without installation | Cross-platform scientific runtime boxes, dependency locks, target and accelerator metadata, signed releases, deterministic archives, and consumer APIs |


</Tab>
</Tabs>

## Next steps

- Follow the [Quickstart](/getting-started/quickstart) to build and run the example box.
- Read [Why Scrollcase](/getting-started/why-scrollcase) to understand if Scrollcase is the right choice for your needs.
- Read the [Overview](/getting-started/overview) for the complete developer and consumer workflow.
- Read [Architecture](/concepts/architecture) to see how the builder, artifacts, publisher, and consumer fit together.
- Read [Security & Trust](/concepts/security-and-trust) for the exact guarantees and non-guarantees.
- Read [Why Pixi & Conda-Forge](/concepts/why-pixi) for the dependency substrate decision.


<style>
    .vp-tabs__content {
        padding: 0 !important;
    }
    .vp-tabs__nav {
        margin-bottom: 20px !important;
        border: 1px solid var(--vp-c-divider) !important;
        border-radius: 20px 20px 0px 0px !important;

    }
    .vp-tabs {
        border: none !important;
    }
    .vp-tabs table {
        margin-top: -21px !important;
    }
</style>