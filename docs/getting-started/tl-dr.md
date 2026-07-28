---
title: TL;DR
description: Scrollcase in a nutshell.
---

# TL;DR

The Scrollcase mental model is simple:

```text
write a scroll
↓
define and lock dependencies
↓
build the box
```

```mermaid
flowchart TB
    subgraph Dev ["1. Developer Workspace"]
        direction TB
        A["Scroll & Code"]
        B["Dependencies"]
        C["Scrollcase CLI"]
    end

    subgraph CLI ["2. Scrollcase Engine"]
        direction TB
        D["scrollcase lock"] --> E["scrollcase build"]
    end

    subgraph Package ["3. Build Result"]
        direction TB
        F["Box (.zip)"]
        G["Signed Manifest"]
    end

    subgraph Consumer ["4. Consuming Application"]
        direction TB
        H["Download, Verify & Run"]
    end

    Dev --> CLI
    CLI --> Package
    Package --> I["Distribution"]
    I["Distribution"] --> Consumer
    Consumer --> L["End User"]
```

## Initial setup

1. run `npm install -g scrollcase` to install the [CLI](/reference/cli)
2. run `scrollcase init`
3. write the [scroll](/reference/scroll)
4. define the **dependencies**
5. run `scrollcase lock`
6. generate or configure the [signing key](/guides/signing-and-custody)
7. run `scrollcase build`

## Normal update

1. update code, version, weights, or dependencies
2. re-run `scrollcase lock` only when required
3. run `scrollcase build`

## Responsibility split

<Tabs :titles="['The Developer', 'Scrollcase', 'The Consuming Application', 'The End User']">
<Tab title="The Developer">

Decides what the box contains, writes the scroll, defines dependencies, runs the commands, publishes releases, and implements integration in the application.

</Tab>
<Tab title="Scrollcase">

Builds the environment, downloads and verifies assets, prepares the box, runs tests, creates archives, generates manifests, calculates hashes, and signs the release.

</Tab>
<Tab title="The Consuming Application">

Selects the box, downloads it, verifies it, extracts it, starts it, and manages updates and uninstallation.

</Tab>
<Tab title="The End User">

Uses the feature exposed by the application; does not interact with Scrollcase directly.

</Tab>
</Tabs>


The most demanding parts are usually:

- defining a correct scroll;
- dealing with difficult scientific dependencies;
- implementing download, verification, and execution in the consuming application.

Conceptually, Scrollcase is therefore fairly linear: the developer declares the desired environment, and the tool turns that declaration into a distributable and verifiable release.

## What Scrollcase simplifies

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

With Scrollcase, these concerns are collected into a scroll and a small number of commands.
