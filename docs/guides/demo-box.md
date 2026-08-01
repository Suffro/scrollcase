---
title: Demo Box
description: Try a box run, without installing a toolchain.
---

# Demo Box

<big> **Try a box run easily, without installing a toolchain** </big>

Building a box needs pixi and conda-pack. But **consuming does not**: <br>
If you only want to see what a box is, and how to run it, try this public demo.
> You can find the demo box **GitHub release** [here](https://github.com/suffro/scrollcase/releases/tag/demo-box-v1).

## Downloads

Download the demo for your system:

|macOS (Metal)|Linux (CPU)|Windows (CPU)|
|--|--|--|
|[`macos-aarch64-metal`](https://github.com/suffro/scrollcase/releases/download/demo-box-v1/hello-box-1.0.0-macos-aarch64-metal.zip)|[`linux-x86_64-cpu`](https://github.com/suffro/scrollcase/releases/download/demo-box-v1/hello-box-1.0.0-linux-x86_64-cpu.zip)|[`windows-x86_64-cpu`](https://github.com/suffro/scrollcase/releases/download/demo-box-v1/hello-box-1.0.0-windows-x86_64-cpu.zip)|


::: tip NOTE

The file you download (eg. <samp>hello-box-1.0.0-macos-aarch64-metal.zip</samp>) is **NOT** the demo box — it is just a container, named so you can tell which machine it is for.

The demo box is the <samp>.zip</samp> you find inside it, next to the <samp>.release.json</samp>. Do not unzip that one: **it's ready to run**. Leave both files named as they are and side by side, because that is how `verify` finds the box.

:::

## Run the box

Once you have downloaded the demo, follow these steps:

1. **Install scrollcase and unzip the demo:**

```sh
npm install -g scrollcase # this will install it globally
unzip hello-box-1.0.0-<target>.zip -d hello-box
cd hello-box
```

> **hello-box** contains 2 files: the **demo box** `.zip` to run, and its matching `.release.json`. <br>

---

2. **Download the demo public key into the same folder:**

```sh
curl -O https://raw.githubusercontent.com/suffro/scrollcase/main/examples/keys/example-signing-public.json
```

or alternatively here's its GitHub link: [`example-signing-public.json`](https://github.com/suffro/scrollcase/blob/main/examples/keys/example-signing-public.json) 

---

3. **Verify and run the box:**

<Tabs :titles="['macOS / Linux', 'Windows (PowerShell)']">
  <Tab title="macOS / Linux">

```sh
scrollcase verify *.release.json --public-key example-signing-public.json
scrollcase run *.release.json --public-key example-signing-public.json
```

  </Tab>
  <Tab title="Windows (PowerShell)">

```powershell
scrollcase verify (Get-ChildItem *.release.json).Name --public-key example-signing-public.json
scrollcase run (Get-ChildItem *.release.json).Name --public-key example-signing-public.json
```

  </Tab>
</Tabs>

> <small>The `*.release.json` above is a real shell glob, not a placeholder — your shell replaces it
> with the one release document in the folder. PowerShell does not expand globs for a command like
> this, which is why it needs `Get-ChildItem`. Either way you can always type the file name you see
> after unzipping.</small>



---

4. **Check out the results, that's it.**


## What just happened

`verify` checks the signature, the archive's size and hash, the entry names and manifest agreement,
and works on any machine. `run` extracts the box to a temporary directory and executes its entry
point with the interpreter *inside* it — so it needs a machine matching the box's target. What it
prints is `sys.prefix`, which is the point: the interpreter answering is the one from the box.

::: warning The demo key is a demo key
Those boxes are signed with a key that exists only for the example. It signs nothing else and no
trust chain depends on it. A signature from it means the example is intact — nothing more.
:::
