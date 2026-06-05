# pi-debug-mode

Minimal Cursor-style debug mode for Pi.

## What it adds

- `/debug <bug summary>` command to trigger `/skill:debug-mode`
- `debug_mode_state` and `debug_mode_session` tools for the debug workflow
- footer status showing the active debug phase
- session-persisted debug state per branch
- immediate initial `collecting` state when `/debug ...` or `/skill:debug-mode ...` is triggered manually

## Injection behavior

The debug tools are **not** meant to be generally available all the time.

They are injected only:

- for turns manually started with `/debug ...`
- for turns manually started with `/skill:debug-mode ...`
- for later turns while the current branch still has an active debug session phase

Outside those cases, the extension removes the debug tools from the active tool set.

## Installed files

- Extension: `~/.pi/agent/extensions/pi-debug-mode/index.ts`
- Skill: `~/.pi/agent/skills/debug-mode/`

## Reload

Inside Pi run:

```text
/reload
```

## Usage

### Start debug mode

```text
/debug login submit shows blank page
```

or directly:

```text
/skill:debug-mode login submit shows blank page
```

### Show latest state

```text
/debug-status
```

### Force cleanup

```text
/debug:cleanup
```

This command:

- best-effort stops any collector sessions recorded in `.pi-debug/`
- removes the `.pi-debug/` directory
- if inside a git repo, checks only the current modified files for `PI_DEBUG_START` / `PI_DEBUG_END` blocks
- if not in a git repo, falls back to a workspace scan for those debug blocks

## Collector

The skill uses a local collector script at:

- `~/.pi/agent/skills/debug-mode/scripts/collector.mjs`

It writes artifacts under:

```text
.pi-debug/
```

Typical files:

- `<session>.ndjson`
- `<session>.ready.json`
- `<session>.stdout.log`
- `<session>.stderr.log`

## Notes

This MVP intentionally focuses on the core loop:

- hypotheses
- runtime instrumentation
- reproduction
- evidence-based diagnosis
- root-cause confirmation before fixes
- verification
- cleanup

It does **not** yet include:

- DAP / breakpoints
- custom overlay viewer
- auto-activation heuristics
