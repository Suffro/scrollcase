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

1. **Install scrollcase and unpack the demo into a folder of its own:**

```sh
npm install -g scrollcase # this will install it globally
mkdir scrollcase-demo && cd scrollcase-demo
unzip ../hello-box-1.0.0-<target>.zip -d box
```

> **box/** now holds 2 files: the **demo box** `.zip` to run, and its matching `.release.json`. <br>

---

2. **Download the demo public key, next to the box rather than inside it:**

```sh
mkdir keys
curl -o keys/example-signing-public.json \
  https://raw.githubusercontent.com/suffro/scrollcase/main/examples/keys/example-signing-public.json
```

or alternatively here's its GitHub link: [`example-signing-public.json`](https://github.com/suffro/scrollcase/blob/main/examples/keys/example-signing-public.json) 

::: tip Why the key lives outside the box
A signature only proves where something came from if the key does not travel with it. Keeping the
key in its own folder — and downloading it from the repository rather than the release — is the
habit to carry into a real project, where the key will not be a demo key.
:::

---

3. **Verify and run the box:**

<Tabs :titles="['macOS / Linux', 'Windows (PowerShell)']">
  <Tab title="macOS / Linux">

```sh
scrollcase verify box/*.release.json --public-key keys/example-signing-public.json
scrollcase run    box/*.release.json --public-key keys/example-signing-public.json
```

  </Tab>
  <Tab title="Windows (PowerShell)">

```powershell
scrollcase verify (Get-ChildItem box\*.release.json).FullName --public-key keys\example-signing-public.json
scrollcase run    (Get-ChildItem box\*.release.json).FullName --public-key keys\example-signing-public.json
```

  </Tab>
</Tabs>

> <small>The `box/*.release.json` above is a real shell glob, not a placeholder — your shell replaces
> it with the one release document in the folder. PowerShell does not expand globs for a command like
> this, which is why it needs `Get-ChildItem`. Either way you can always type the file name you see
> after unzipping. You never name the box archive: `verify` finds it beside the release document,
> under the hash that document commits to.</small>



---

4. **Check out the results, that's it.**

At this point the folder looks like this — the box untouched in its own directory, the key beside
it, nothing loose:

```text
scrollcase-demo/
├── box/
│   ├── <archive sha256>.zip          # the demo box, left exactly as downloaded
│   └── <document sha256>.release.json
└── keys/
    └── example-signing-public.json
```

## Run it from your own app

The CLI is the quickest way to see a box work, but an application does not shell out to it: both
consumers expose the same verify-then-run semantics as a library, and they take the very files you
just downloaded. Same folder, same key, nothing rebuilt.

<Tabs :titles="['TypeScript', 'Python']">
  <Tab title="TypeScript">

```sh
npm install scrollcase
npm install --save-dev tsx typescript
```

```ts
// run-box.ts
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runBox } from 'scrollcase/consumer';

const release = readdirSync('box').find((name) => name.endsWith('.release.json'))!;

runBox(join('box', release), {
  publicPath: 'keys/example-signing-public.json',
  stdout: 'inherit',
  stderr: 'inherit',
  onPrepared: ({ boxId, version, targetId }) => {
    console.log(`Running ${boxId} ${version} (${targetId})`);
  },
}).then((result) => {
  process.exitCode = result.exitCode ?? 1;
});
```

```sh
npx tsx run-box.ts
```

  </Tab>
  <Tab title="Python">

```sh
python -m pip install scrollcase-consumer
```

```python
# run_box.py
from pathlib import Path

from scrollcase_consumer import PreparedBox, run_box

release = next(Path("box").glob("*.release.json"))


def report(prepared: PreparedBox) -> None:
    print(f"Running {prepared.box_id} {prepared.version} ({prepared.target_id})", flush=True)


result = run_box(
    release,
    public_key_path="keys/example-signing-public.json",
    on_prepared=report,
)
raise SystemExit(result.exit_code or 0)
```

```sh
python run_box.py
```

  </Tab>
</Tabs>

Drop either file at the top of `scrollcase-demo/` and run it from there. `runBox` verifies the
signature, extracts to a private temporary directory, executes, and cleans up after itself — the
same chain `scrollcase run` performs, minus the terminal. `onPrepared` fires after verification and
before execution, which is how an application shows what it is about to run without repeating the
trust chain itself.

The Python package is published separately: `npm install scrollcase` does not install it, and
`pip install scrollcase-consumer` needs no Node at all. Full surface in the
[Library APIs reference](/reference/api).

## What just happened

`verify` checks the signature, the archive's size and hash, the entry names and manifest agreement,
and works on any machine. `run` extracts the box to a temporary directory and executes its entry
point with the interpreter *inside* it — so it needs a machine matching the box's target. What it
prints is `sys.prefix`, which is the point: the interpreter answering is the one from the box.

::: warning The demo key is a demo key
Those boxes are signed with a key that exists only for the example. It signs nothing else and no
trust chain depends on it. A signature from it means the example is intact — nothing more.
:::
