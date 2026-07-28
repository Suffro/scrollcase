---
title: Accelerator Parity
description: Require a box to compute the same thing on the GPU as on the CPU, within tolerances you declare.
---

# Accelerator Parity

*Does this box compute the same thing on the GPU as on the CPU?* The question sounds scientific,
but it is a packaging question. It catches the failures a packaging tool is responsible for — the
wrong wheels solved in, a CPU-only build shipped as CUDA, a broken BLAS — and it catches them on
the build machine rather than on a user's.

The division of labour is deliberate:

| Scrollcase owns | Your project owns |
| --- | --- |
| Running the check once per accelerator, under each target's validation environment | What the check computes — which input, which tensor, which model |
| Comparing every run against the first | What closeness means for your model |
| Enforcing the tolerances you declared, and failing the build on a breach | The fixture, and reviewing the numbers |

Scrollcase never decides what is scientifically correct. It enforces a threshold you wrote down.

## Declaring the gate

```jsonc
"parity": {
  "script": "checks/parity.py",
  "accelerators": ["cpu", "cuda"],
  "tolerances": { "absolute": 1e-4, "relative": 1e-3, "minimumCosine": 0.9999 }
}
```

| Field | Meaning |
| --- | --- |
| `script` | A path **inside the box**, run with the box's own interpreter, from the payload root |
| `accelerators` | At least two. The **first is the reference**; every other run is compared against it. Conventionally `cpu`, being the one available everywhere and the least likely to be wrong |
| `tolerances` | At least one of `absolute`, `relative`, `minimumCosine` |

Valid accelerator combinations follow the target: `["cpu", "metal"]` on macOS, `["cpu", "cuda"]`
on Linux and Windows. An accelerator the target defines no validation environment for is
rejected.

## The check script

The script ships inside the box — either produced by the environment, or copied in through
[`localFiles`](/reference/scroll#localfiles):

```jsonc
"localFiles": [
  { "sourcePath": "checks/parity.py", "relativePath": "checks/parity.py", "sha256": "…" }
]
```

It must print **a JSON array of numbers**, or an object with a `values` array:

```python
# checks/parity.py
import json, torch

torch.manual_seed(0)                      # a fixed input: the comparison is between accelerators,
x = torch.randn(1, 64)                    # not between random draws

model = load_model()                      # your model, loaded from the box's own weights
model.eval()
with torch.no_grad():
    out = model(x.to(model.device))

print(json.dumps({"values": out.flatten().tolist()}))
```

Two rules make the comparison meaningful:

- **Deterministic input.** Seed it, or read a committed fixture. Comparing two different inputs
  tells you nothing.
- **Let the environment choose the device.** Scrollcase sets `CUDA_VISIBLE_DEVICES` per run
  (`""` for `cpu`, `"0"` for `cuda`; `PYTORCH_ENABLE_MPS_FALLBACK=0` for `metal`). Write the
  script so it picks up what the environment offers rather than hard-coding a device.

## How the comparison works

The first accelerator is the reference. Every later accelerator is a candidate compared against
that same reference, in declaration order.

For each run after the reference, three quantities are computed element-wise:

| Measurement | Meaning | Bounded by |
| --- | --- | --- |
| Maximum absolute error | The largest `\|candidate − reference\|` | `absolute` |
| Maximum relative error | The largest `\|candidate − reference\| / \|reference\|`, **counted only where the reference has magnitude** | `relative` |
| Cosine similarity | Agreement in direction across the whole vector | `minimumCosine` |

Relative error is meaningless around zero, so it is skipped there — the absolute bound is what
guards near-zero entries. Cosine similarity catches a result that drifted in direction rather
than magnitude, which element-wise bounds can miss.

Outputs of differing length fail immediately, and **non-finite values are rejected explicitly**:
a `NaN` or an infinity is the classic symptom of a broken accelerator build, so it is reported as
such rather than allowed to poison the arithmetic.

All declared tolerances are conjunctive. If `absolute`, `relative`, and `minimumCosine` are
present, the candidate must pass all three. Absolute and relative bounds are finite numbers greater
than zero; minimum cosine is finite and at most 1. Values below -1 are accepted by schema v1 but
are vacuous because cosine similarity cannot be lower than -1. Output must be a non-empty JSON array of
finite numbers, directly or under a `values` property.

## Choosing tolerances

There is no universally right answer, which is exactly why Scrollcase does not pick one. A useful
procedure:

1. Build with a deliberately loose tolerance and read what the build reports.
2. Set the bound a little above the observed spread — tight enough to catch a real regression,
   loose enough to survive legitimate floating-point differences between devices.
3. Record why you chose it, next to the scroll.

The project must derive bounds from its workload, numeric precision, fixture, and scientific
requirements. Scrollcase cannot infer a safe threshold from the accelerator name.

## When it runs, and what it prints

Parity runs during `build`, **after** the self-test and on the same payload — there is no point
comparing accelerators in a box that cannot import its dependencies in the first place. On
success the build logs the comparison:

```text
Parity passed on cuda against cpu
```

On a breach the build fails with the measurement and the bound it exceeded:

```text
scrollcase: Parity check cpu vs cuda: maximum relative error 0.041 exceeds 0.001.
```

Measurements are used internally for the gate. The public CLI logs only a short success summary or
the first breached bound; it does not persist or sign the measurements, and `scrollcase/build`
does not export the build orchestrator. A project that needs retained scientific evidence must
record it in its own pipeline.

## When not to use it

Parity needs at least two accelerators available on the build machine — a CPU/CUDA gate needs a
GPU present. If a box has only one meaningful accelerator, or your CI cannot provide the second
device, leave `parity` out and lean on the self-test's `pythonCode` instead. The gate is optional
by design; a scroll without it is complete.
