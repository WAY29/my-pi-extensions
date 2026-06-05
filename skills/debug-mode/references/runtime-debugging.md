# Runtime Debugging Reference

Use this reference for the exact collector bootstrap, payload shape, and instrumentation templates.

## Collector bootstrap

The bundled collector lives at `scripts/collector.mjs` relative to the skill directory.

When the Pi extension `pi-debug-mode` is loaded, prefer the `debug_mode_session` tool instead of manual shell bootstrap. That tool is intentionally injected only for debug-mode turns triggered manually via `/skill:debug-mode ...` or `/debug ...`, and for later turns while a debug session remains active.

Preferred manual bootstrap from the project root when the tool is unavailable:

```bash
SESSION_SLUG="<short-bug-slug>-$(date +%s)"
mkdir -p .pi-debug
nohup node "<SKILL_DIR>/scripts/collector.mjs" \
  --workspace-root "$PWD" \
  --session-id "$SESSION_SLUG" \
  > ".pi-debug/${SESSION_SLUG}.stdout.log" \
  2> ".pi-debug/${SESSION_SLUG}.stderr.log" &
READY_FILE=".pi-debug/${SESSION_SLUG}.ready.json"
for i in $(seq 1 50); do
  [ -f "$READY_FILE" ] && break
  sleep 0.1
done
cat "$READY_FILE"
```

Resolve `<SKILL_DIR>` to the installed skill directory before running commands.

If the ready file does not appear, inspect:

- `.pi-debug/<session>.stderr.log`
- `.pi-debug/<session>.stdout.log`

## Ready file shape

Example:

```json
{
  "sessionId": "login-blank-1733456789",
  "host": "127.0.0.1",
  "port": 43125,
  "endpoint": "http://127.0.0.1:43125/log",
  "healthUrl": "http://127.0.0.1:43125/health",
  "clearUrl": "http://127.0.0.1:43125/clear",
  "shutdownUrl": "http://127.0.0.1:43125/shutdown",
  "logFile": "/abs/path/.pi-debug/login-blank-1733456789.ndjson",
  "readyFile": "/abs/path/.pi-debug/login-blank-1733456789.ready.json",
  "workspaceRoot": "/abs/path/to/workspace",
  "pid": 12345,
  "startedAt": "2026-06-05T12:00:00.000Z"
}
```

## Health, clear, shutdown

Check collector health:

```bash
curl -fsS "<healthUrl>"
```

Clear logs before a new pass:

```bash
curl -fsS -X POST "<clearUrl>"
```

Stop the collector during cleanup:

```bash
curl -fsS -X POST "<shutdownUrl>"
```

## Log format

The collector writes one JSON object per line (NDJSON).

Typical entry:

```json
{"ts":"2026-06-05T12:00:00.000Z","sessionId":"login-blank-1733456789","hypothesisId":"H2","message":"before fetch","data":{"userId":null},"location":"src/app.tsx:42"}
```

Recommended fields:

- `hypothesisId`
- `message`
- `data`
- `location`
- `runId` (optional, useful for before/after verification)

## Browser / client JavaScript template

Prefer direct collector delivery.

```ts
// PI_DEBUG_START session:<id>
const PI_DEBUG_ENDPOINT = "http://127.0.0.1:<port>/log";

function piDebugLog(hypothesisId, message, data, location) {
  const payload = JSON.stringify({ hypothesisId, message, data, location });
  if (navigator.sendBeacon?.(PI_DEBUG_ENDPOINT, payload)) return;
  fetch(PI_DEBUG_ENDPOINT, {
    method: "POST",
    body: payload,
    headers: { "Content-Type": "text/plain" }
  }).catch(() => {});
}
// PI_DEBUG_END session:<id>
```

Usage:

```ts
piDebugLog("H1", "submit clicked", { formState, isLoading }, "src/login.tsx:88");
```

## Node / server JavaScript template

Direct file append is acceptable when simpler than HTTP.

```ts
// PI_DEBUG_START session:<id>
import fs from "node:fs";
const PI_DEBUG_FILE = "/abs/path/.pi-debug/<session>.ndjson";

function piDebugLog(hypothesisId, message, data, location) {
  fs.appendFileSync(
    PI_DEBUG_FILE,
    JSON.stringify({
      ts: new Date().toISOString(),
      hypothesisId,
      message,
      data,
      location,
    }) + "\n"
  );
}
// PI_DEBUG_END session:<id>
```

If an HTTP endpoint is easier in the current runtime, using the collector endpoint is also fine.

## Phase publishing via extension tools

If the tools are available, use them in this order:

1. `debug_mode_session` to start/reuse, status-check, clear, and stop the collector
2. `debug_mode_state` to publish phase transitions

State transitions look like:

```text
start/collecting
waiting-for-repro
analyzing
fixing
verifying
cleanup
done
```

Recommended payload fields:

- `phase`
- `bugSummary`
- `sessionId`
- `logFile`
- `collectorPort`
- `logCount` (optional after analysis)
- `note` (optional)

## Reading evidence

Prefer targeted reads when logs grow:

```bash
wc -l "/abs/path/.pi-debug/<session>.ndjson"
tail -n 80 "/abs/path/.pi-debug/<session>.ndjson"
rg '"hypothesisId":"H2"' "/abs/path/.pi-debug/<session>.ndjson"
```

## Cleanup

After successful verification:

1. remove all `PI_DEBUG_START` / `PI_DEBUG_END` blocks
2. stop the collector via `shutdownUrl` (or `debug_mode_session action=stop`, which also removes the standard collector artifacts)
3. delete any remaining session artifacts:
   - `.pi-debug/<session>.ndjson`
   - `.pi-debug/<session>.ready.json`
   - `.pi-debug/<session>.stdout.log`
   - `.pi-debug/<session>.stderr.log`
4. delete the `.pi-debug/` directory if it becomes empty

Never treat a clean git status as proof that debug artifacts are gone.
