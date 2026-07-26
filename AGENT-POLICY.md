# AGENT-POLICY.md

How an AI coding agent should *work* in this repository: planning, delegation, expensive actions,
and long-running processes.

This is deliberately separate from `AGENTS.md`. That file holds what is true about **Scrollcase** —
its invariants, vocabulary, layout and commands — and is worth carrying in context at all times.
This one holds process rules that only matter for multi-step or costly work, so read it when you
reach that kind of task rather than by default.

Nothing here overrides `AGENTS.md`, the user's plan, or the hard rules.

---

## Rule zero — start simple

Use the least complex approach that solves the task. Reading three files and making one edit is
usually the whole job. Every added layer — a plan, a delegation, a second pass — adds latency, token
cost and failure surface, and has to be justified by something you can point at. Do not add a step
"for completeness" when one step already works.

## Task-specific execution checklists

- For every medium-complexity or complex task, keep a **living checklist** while working. A user's
  plan gives direction but cannot predict every implementation detail; turn discoveries,
  dependencies and risks into explicit items as you find them.
- Refresh it before each materially complex step. At minimum: prerequisites and current state; the
  exact file, command and inputs; the expected change; what counts as success evidence; failure and
  stop conditions; rollback or cleanup; and any cost or authorization boundary.
- **Mark an item complete only from concrete evidence** — a test result, a generated artifact, a
  hash, a diff, an observed state transition. Never infer completion from an adjacent step having
  worked.
- When a defect appears, add it with its root cause, the regression coverage it needs, and the
  cleanup, before attempting another expensive action.
- Keep it proportional: a few lines for bounded work, more for releases and multi-stage changes.
  Never turn it into repetitive commentary.

## Consequential actions

`AGENTS.md` lists the specific dangerous operations in this repository. The procedure for all of
them is the same:

1. **Never act from memory or name inference.** Read back the exact command, its arguments and its
   target before running it.
2. Confirm they match the intended operation — the right ref, the right registry, the right
   directory.
3. Run it, then **verify the result immediately**: the new state, the identity of what was created,
   the ref that moved. Stop on any mismatch.
4. If it is irreversible and the user has not explicitly asked for it in this session, ask first.

A rewrite of published history, a force-push, a publish, a key rotation and a recursive delete all
belong in this category. So does anything that spends the user's money.

## Long-running processes

- **Never waste user credits or context on repetitive polling.** Environment solves, real builds,
  asset downloads and CI runs all take minutes.
- Do not use verbose watch commands or repeated status calls that inject unchanged state into the
  context window.
- Prefer an event-driven completion signal or a silent background wait. If neither exists, check
  once after a meaningful interval and stop until the next one.
- Report only real transitions: actionable progress, failure, completion, or something that needs a
  decision. Never repeatedly report that a process is still running.

## Delegation and subagents

- **Default to a single linear agent** for writing, editing and debugging code.
- **Never run parallel agents that write to the same codebase.** Two writers make conflicting
  implicit decisions — naming, structure, error handling — that cannot be merged cleanly afterwards.
  Delegate sequentially, handing over full context.
- **Subagents are for reading**: locating code across many files, gathering context, answering a
  question that would otherwise cost many turns. Reads parallelize; writes do not.
- Spawning an agent starts from a cold context and re-derives what you already know. A task being
  large is not a reason to delegate it; a task being *wide and read-only* is.
- Cap iterations. If a loop is not converging after a few passes, stop and report what you tried
  rather than continuing to spend.

## Verification is the gate

- Run the test suite after each significant step, not only at the end. `AGENTS.md` has the commands
  and the escalation ladder.
- A guard that has never been observed failing is not yet a guard. When you add one, break what it
  protects once, watch it fail, then restore.
- Report outcomes as they are. If a test fails, say so with the output. If a step was skipped, say
  which and why. Do not describe work as finished on the strength of it having been written.
