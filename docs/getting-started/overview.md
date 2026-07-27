---
title: Overview
description: A comprehensive overview of how Scrollcase works, automated steps, and developer workflows.
---

# Scrollcase Overview

Scrollcase is a tool for packaging and distributing complete Python environments, especially when a project needs to include:

- a specific Python version;
- exact libraries and dependencies;
- application code;
- model weights or other assets;
- support for a specific platform or hardware accelerator;
- integrity checks and signed releases.

Its purpose is to avoid forcing each end user to install Python, native libraries, model dependencies, and model files manually.

The developer describes what the runtime box should contain, runs a small number of commands, and Scrollcase produces a package that can be published and later installed by another application.

## Who Uses Scrollcase

There are two main roles:

<Tabs :titles="['The Developer','The Consuming Application']">
<Tab title="The Developer">

This is the person or team that builds and publishes the box.

---

The developer must:

- defines the Python environment;
- specifies the dependencies;
- provides model files or downloadable assets;
- chooses the target platform;
- builds the box;
- publishes the generated files.

</Tab>
<Tab title="The Consuming Application">

This is the application that installs and uses the box.

---

The consuming application must:

- choose the correct box for the user's computer;
- download it;
- verify it;
- extract it;
- start the Python runtime or scripts contained inside it.

The end user should not normally interact with Scrollcase directly.

</Tab>
</Tabs>

## What Scrollcase Automates

Scrollcase automatically handles:

- creating the Python environment;
- installing dependencies;
- using the locked dependency versions;
- downloading declared assets;
- verifying asset sizes and hashes;
- making the environment relocatable;
- copying local code and files;
- running configured tests;
- creating the runtime box;
- generating the ZIP archive;
- generating release manifests;
- calculating hashes;
- signing the release;
- preparing files for publication.

These operations happen during the build. The developer does not run them one by one.

## Initial Setup

The initial setup is usually performed once per project.

### 1. Install Scrollcase

Install Scrollcase in the repository using the method supported by the project.

### 2. Initialise the Workspace

Run:

```bash
scrollcase init
```

This creates the initial project structure.

### 3. Generate a Signing Key

Run:

```bash
scrollcase keygen
```

This creates the key pair used to sign releases.

The private key must be stored securely and must not be committed to the repository.

The public key must be distributed to the consuming application so that it can verify releases.

## Writing a Recipe

A recipe is the configuration that describes the box to build.

The developer specifies information such as:

- box name and version;
- target operating system;
- target architecture;
- hardware accelerator;
- Python version;
- local files to include;
- remote assets or model weights;
- expected file hashes;
- Python modules to import during tests;
- optional custom checks.

Conceptually, the recipe says:

```text
Box: model-x
Version: 1.0.0
Operating system: macOS
Architecture: Apple Silicon
Accelerator: Metal
Python: 3.11
Dependencies: PyTorch, NumPy, model-x library
Weights: URL, file size, SHA-256
Tests: import torch, import model_x
```

The recipe describes the desired result. It does not require the developer to implement the internal packaging process.

## Defining Dependencies

Dependencies are declared in the dependency file used by the recipe, normally through Pixi.

Conceptual example:

```toml
# pixi.toml

[dependencies]
python = "3.11.*"
pytorch = "2.*"
numpy = "2.*"
```

This file defines acceptable dependency versions.

It does not necessarily select the exact build of every package yet.

## Locking Dependency Versions

After defining the dependencies, run:

```bash
scrollcase lock recipe-name
```

This generates a lock file containing the exact resolved dependency versions.
> This should normally be committed to the Git repository.

### When to Run `lock`

Run it:

- the first time the recipe is created;
- when a dependency changes;
- when upgrading a library;
- when changing the environment configuration.

It does not need to be rerun for every build if the dependencies have not changed.

## Checking the Configuration

Before building, the developer can run:

```bash
scrollcase doctor --recipe recipe-name
```

This checks things such as:

- workspace configuration;
- recipe availability;
- Git repository state;
- required tools;
- whether the current machine can build the selected target;
- whether required files exist.

`doctor` helps detect configuration problems before starting a full build.

## First Build Workflow

The practical workflow for the first box is:

### 1. Initialise the Project

```bash
scrollcase init
```

### 2. Write the Recipe

Define:

- box identity;
- target platform;
- Python version;
- dependencies;
- assets;
- tests.

### 3. Lock Dependencies

```bash
scrollcase lock recipe-name
```

### 4. Commit the Configuration

Commit the recipe and lock file to Git.

### 5. Generate or Configure the Signing Key

```bash
scrollcase keygen
```

### 6. Build the Box

```bash
scrollcase build recipe-name
```

### 7. Review the Output

The build typically produces:

- the box ZIP archive;
- the release document;
- the channel document;
- a publication-ready object structure.

### 8. Distribute the files (if needed)

Upload the generated files to the chosen distribution system, such as:

- object storage;
- static hosting;
- a release repository;
- a private server.

Scrollcase prepares the files, but does not upload them anywhere.

## What Happens During `build`

From the developer's perspective, the build is a single command:

```bash
scrollcase build recipe-name
```

Scrollcase then performs the internal packaging steps automatically.

The developer does not need to:

- install Python manually inside the box;
- copy libraries one by one;
- download every asset manually;
- repair environment paths manually;
- create the ZIP archive;
- calculate hashes;
- write release manifests;
- sign every file manually.

The internal complexity remains inside the tool.

## Publishing and distribution

Scrollcase is not a hosting/distribution service.

After the build, the developer can publish the generated files on its own.

This can be done:

- manually;
- with a script;
- through CI/CD;
- with GitHub Actions;
- through an object-storage deployment pipeline.

A typical flow could be:

```text
Scrollcase builds the files
↓
the deployment system uploads them
↓
the consuming application downloads them
```

## Update Workflow

After the initial setup, publishing a new version requires fewer steps.

### Case 1: Only Code or Included Files Change

1. update the code;
2. increase the version;
3. run the build;
4. publish the new files.

```bash
scrollcase build recipe-name
```

### Case 2: Dependencies Change

1. update the dependency configuration;
2. regenerate the lock file;
3. review the result;
4. run the build;
5. publish the new files.

```bash
scrollcase lock recipe-name
scrollcase build recipe-name
```

### Case 3: Model Weights Change

1. update the asset URL, file size, and hash in the recipe;
2. increase the version;
3. run the build;
4. publish the new release.

## Supporting Multiple Platforms

A box is specific to one target.

Examples include:

- macOS Apple Silicon with Metal;
- macOS Apple Silicon with CPU only;
- Linux x86_64 with CPU;
- Linux x86_64 with CUDA;
- Windows x86_64 with CPU;
- Windows x86_64 with CUDA.

Supporting several targets requires several builds and usually separate target-specific recipes or configurations.

The workflow becomes:

```text
macOS recipe
↓
macOS build

Linux CPU recipe
↓
Linux CPU build

Linux CUDA recipe
↓
Linux CUDA build

Windows recipe
↓
Windows build
```

Each build must run on a machine compatible with the target.

This is one of the main sources of complexity when supporting a large platform matrix.

## What the Consuming Application Must Implement

Scrollcase creates the box, but it does not implement installation inside the final application.

The consuming application must handle:

1. detecting the operating system and architecture;
2. detecting the available accelerator when relevant;
3. choosing the correct channel and release;
4. downloading the manifests;
5. verifying the signatures;
6. checking runtime requirements;
7. downloading the ZIP archive;
8. verifying its size and hash;
9. extracting the box;
10. downloading optional on-demand assets;
11. starting the correct Python runtime or script;
12. handling updates, errors, and uninstallation.


## What the End User Does

An ideal could be:

```text
the user access the application that uses Scrollcase
↓
the user selects a feature or model
↓
the application selects the correct box
↓
the user press install (or a similar call to action)
↓
the application downloads it, verifies it and extracts it
↓
the application starts it when requested
```

## Is Scrollcase Complicated?

### Conceptually

The mental model is simple:

```text
describe the environment
↓
lock the versions
↓
build the box
↓
publish the files
```

For a single box with common dependencies, the workflow can be fairly straightforward.

### In Practice

The complexity increases when the project includes:

- difficult native libraries;
- strict version requirements;
- old scientific packages;
- dependencies unavailable through supported channels;
- several operating systems;
- several CUDA versions;
- very large model files;
- complex scientific validation;
- advanced signing and release pipelines.

In most cases, the complexity comes more from the Python environment and the model than from Scrollcase itself.

## What Scrollcase Actually Simplifies

Scrollcase removes much of the repetitive work required to turn a Python environment into a distributable product.

Without a tool like this, the developer would have to manage:

- environment creation;
- exact dependency versions;
- relocatability;
- native dependencies;
- verified downloads;
- manifests;
- signatures;
- hashes;
- release structure;
- tests;
- distribution conventions.

With Scrollcase, these concerns are collected into a recipe and a small number of commands.

## TL;DR

For a quick summary, check out the Scrollcase **tl;dr** page [here](/getting-started/tl-dr.md).