---
name: debug-mode
description: Evidence-first debugging for reproducible bugs. Use when code behaves incorrectly and the root cause is unclear, especially for frontend state issues, async timing bugs, regressions, or any case where the agent would otherwise add logs and ask the user to report output manually.
---

# Debug Mode

Use runtime evidence before changing behavior.
Do **not** jump straight to a fix.

Core loop:

```text
Understand → Hypothesize → Instrument → Reproduce → Analyze → Fix → Verify → Clean up
```

This skill is a minimal Cursor-style debug loop for Pi.

## Use this skill when

- the bug is reproducible but the cause is unclear
- you need variable values or execution-path evidence
- the issue may involve timing, branching, state transitions, or frontend/backend interaction
- you would otherwise add logs and ask the user to copy-paste console output

Do **not** use this skill for:

- obvious syntax/type errors already explained by compiler output
- one-line fixes where runtime evidence is unnecessary
- bugs that cannot be reproduced at all

## Required workflow

### 1. Understand the bug

Before editing code, gather:

- expected vs actual behavior
- exact reproduction steps
- error messages / stack traces if available
- where the bug appears (browser, server, CLI, API, etc.)

Read the relevant code paths first.

### 2. Generate hypotheses

Produce **3-5 precise, testable hypotheses**.

Each hypothesis should say:

- what might be wrong
- why that would explain the observed behavior
- what log evidence would confirm or reject it

### 3. Start or reuse a local collector

Read [runtime-debugging.md](references/runtime-debugging.md) before bootstrapping.

If the tool `debug_mode_session` is available, prefer it over ad-hoc shell commands:

- `action: start` to create or reuse the collector
- `action: status` to verify health before another recording pass
- `action: clear` before each reproduction run
- `action: stop` during final cleanup

Only fall back to manual bootstrap with `scripts/collector.mjs` when that tool is unavailable.

If a tool named `debug_mode_state` is available, call it after collector startup to publish at least:

- `phase: collecting`
- `sessionId`
- `bugSummary`
- `logFile`
- `collectorPort`

### 4. Add minimal instrumentation

Add the minimum logs needed to test the active hypotheses in parallel.

Rules:

- Prefer **2-6 high-signal log points** per pass.
- Every injected log must include a `hypothesisId` like `H1`, `H2`, etc.
- Include `location` when practical.
- For browser/client JavaScript, prefer direct HTTP posts to the collector endpoint.
- For server/runtime code, direct file append is acceptable when simpler than HTTP.
- Wrap temporary instrumentation in clear markers so cleanup is reliable.

Required markers:

- `// PI_DEBUG_START session:<id>` / `// PI_DEBUG_END session:<id>`
- `# PI_DEBUG_START session:<id>` / `# PI_DEBUG_END session:<id>`

Every temporary instrumentation edit must live inside one matching `PI_DEBUG_START` / `PI_DEBUG_END` block using comment syntax valid for the file.
Before calling `debug_mode_pause_for_repro`, verify every instrumentation-touched file still contains both markers and fix any missing marker first.
Never leave plain `console.log` or ad-hoc debug prints without markers.

### 5. Clear logs and ask for reproduction

Before each recording pass:

- verify collector health (`debug_mode_session` with `action: status` when available)
- clear the active log file / session (`debug_mode_session` with `action: clear` when available)
- publish `phase: waiting-for-repro` with `debug_mode_state` if available

Then **must pause the workflow** before any diagnosis or fix attempt:

- If `debug_mode_pause_for_repro` is available, call it with exact reproduction instructions and let it terminate the current tool batch.
- Only if that tool is unavailable, ask the user to reproduce the bug and end your turn immediately.

Do **not** continue to diagnosis or fixes in the same turn after instrumentation.

### 6. Analyze evidence

After reproduction, read the active NDJSON log file.

For **every hypothesis**, mark one of:

- `CONFIRMED`
- `REJECTED`
- `INCONCLUSIVE`

Do not skip hypotheses.

If all are rejected or inconclusive, generate a new set and iterate.

If a tool named `debug_mode_state` is available, publish `phase: analyzing` before presenting diagnosis.

### 7. Confirm the root cause before fixing

After analysis identifies a likely root cause:

- present the per-hypothesis verdicts and the proven root cause to the user
- explain the smallest fix you intend to apply
- ask for confirmation before editing code
- end the turn after the confirmation request

Do **not** apply the fix in the same turn as the first root-cause diagnosis.

If a tool named `debug_mode_state` is available, publish `phase: awaiting-root-cause-confirmation` before asking for confirmation.

### 8. Fix only the proven cause

Only after the user confirms the diagnosis/fix direction:

- apply the smallest fix that addresses the confirmed root cause
- keep the temporary instrumentation in place

If a tool named `debug_mode_state` is available, publish `phase: fixing`.

### 9. Verify with fresh evidence

Before verification:

- confirm collector is still alive (`debug_mode_session` with `action: status` when available)
- clear old logs (`debug_mode_session` with `action: clear` when available)
- publish `phase: verifying` if the tool is available

Then **must pause the workflow** before claiming success:

- If `debug_mode_pause_for_repro` is available, call it with verification instructions and let it terminate the current tool batch.
- Only if that tool is unavailable, ask the user to reproduce again with the fix in place and end your turn immediately.

Compare before/after evidence only after the user comes back from that verification run.

### 10. Clean up

Only after:

- the runtime evidence shows the fix worked
- the user confirms the issue is resolved

Then:

- remove all temporary instrumentation blocks
- stop the collector (`debug_mode_session` with `action: stop` when available; this also removes this session's collector log artifacts)
- delete any remaining `.pi-debug` artifacts for this session unless the user asked to keep them
- publish `phase: done` through `debug_mode_state` if available

## Guardrails

- Never claim the root cause from code inspection alone.
- Never fix before collecting runtime evidence.
- Never apply a code fix in the same turn as the first root-cause diagnosis.
- Never remove instrumentation before post-fix verification succeeds.
- Never pause or claim success while any instrumentation-touched file is missing `PI_DEBUG_START` or `PI_DEBUG_END`.
- Never leave temporary debug code behind after success.
- Never log secrets, tokens, passwords, or PII.
- Never route browser debug traffic through a project-local proxy unless direct delivery is proven blocked.

## Tool integration

If extension tools exist, use them like this:

- `debug_mode_session`
  1. `start` after hypotheses, before instrumentation
  2. `status` before each new recording pass
  3. `clear` before each reproduction / verification run
  4. `stop` during final cleanup
- `debug_mode_state`
  1. after collector startup → `collecting`
  2. before user reproduction → `waiting-for-repro`
  3. during diagnosis → `analyzing`
  4. after diagnosis, before asking to fix → `awaiting-root-cause-confirmation`
  5. before applying the fix → `fixing`
  6. before verification run → `verifying`
  7. during teardown / after success → `cleanup` then `done`
- `debug_mode_pause_for_repro`
  1. after instrumentation/log clear → pause for reproduction and terminate the current turn
  2. before verification analysis → pause for verification and terminate the current turn

Do not use `debug_mode_pause_for_repro` for root-cause confirmation. Present the diagnosis, ask for confirmation in a normal assistant message, and end the turn.

Do not fail the workflow if these tools are unavailable, but when they exist you must use them instead of merely saying "please reproduce" and continuing.

## Response shape

Before user reproduction:

1. bug understanding summary
2. numbered hypotheses
3. instrumentation plan / files changed
4. reproduction request

After reproduction:

5. per-hypothesis analysis
6. proven root cause
7. proposed minimal fix
8. confirmation request

After user confirmation:

9. minimal fix
10. verification request

After success:

11. short root-cause summary
12. cleanup summary
13. remaining caveats, if any

For exact collector commands, payload shape, and logging templates, read [runtime-debugging.md](references/runtime-debugging.md).
