// Superset pi extension v2
/**
 * Superset Notification Extension for pi
 *
 * Mirrors Superset's agent-hook integration by calling Superset's own
 * `notify.sh` with Claude/Codex-compatible payloads, so Superset can:
 * - mark the pane/agent as running
 * - clear the running state on completion
 * - fire its normal system notifications/chimes
 * - optionally surface "needs attention" when pi asks the user something
 *
 * Mapping:
 *   pi `before_agent_start`    -> `UserPromptSubmit`
 *   pi `tool_execution_start`  -> `request_user_input` (AskUserQuestion only)
 *   pi `tool_execution_end`    -> `Start` (AskUserQuestion finished; agent resumes work)
 *   pi `session_before_compact`-> `Start` (/compact starts; show amber working dot)
 *   pi `session_compact`       -> `Stop` (/compact finished; show end)
 *   pi `agent_end`             -> `Stop` (final end only; skip auto-retry handoff)
 *   pi `session_shutdown`      -> `Stop`
 *
 * Notes:
 * - Superset's `notify.sh` already knows how to forward events to the current
 *   host-service endpoint and fall back to the older localhost hook server.
 * - We intentionally call `notify.sh` instead of implementing curl/HTTP here,
 *   so this extension stays compatible with Superset's protocol changes.
 * - Outside Superset, this extension is a no-op.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	SUPERSET_ATTENTION_EVENT,
	type SupersetAttentionEvent,
	type SupersetAttentionKind,
} from "./superset-hooks/attention";

type HookCtx = Pick<ExtensionContext, "hasUI" | "sessionManager">;

function isSupersetTerminal(): boolean {
	return Boolean(
		process.env.SUPERSET_TERMINAL_ID ||
			process.env.SUPERSET_PANE_ID ||
			process.env.SUPERSET_TAB_ID,
	);
}

function getNotifyScriptPath(): string {
	const supersetHome = process.env.SUPERSET_HOME_DIR || join(homedir(), ".superset");
	return join(supersetHome, "hooks", "notify.sh");
}

function shouldSkip(ctx: HookCtx): boolean {
	// In modern pi, non-interactive/subagent contexts report hasUI === false.
	// Keep the strict comparison so older pi builds (without hasUI) still work.
	return ctx.hasUI === false;
}

function getSessionId(ctx: HookCtx): string | undefined {
	return ctx.sessionManager.getSessionFile() ?? undefined;
}

function fire(notifyScript: string, eventName: string, ctx?: HookCtx): Promise<void> {
	const payload: Record<string, string> = {
		hook_event_name: eventName,
	};

	const sessionId = ctx ? getSessionId(ctx) : undefined;
	if (sessionId) {
		payload.session_id = sessionId;
	}

	return new Promise((resolve) => {
		try {
			const child = spawn(notifyScript, [JSON.stringify(payload)], {
				stdio: "ignore",
				env: { ...process.env, SUPERSET_AGENT_ID: "pi" },
			});
			child.once("error", () => {
				// Never let notification failures affect pi.
				resolve();
			});
			child.once("close", () => {
				resolve();
			});
		} catch {
			// spawn() can throw synchronously (ENOENT/EACCES). Stay silent.
			resolve();
		}
	});
}

export default function (pi: ExtensionAPI) {
	if (!isSupersetTerminal()) return;

	const notifyScript = getNotifyScriptPath();
	if (!existsSync(notifyScript)) return;

	let lastCtx: HookCtx | undefined;
	let notifyQueue: Promise<void> = Promise.resolve();
	let pendingStopTimer: ReturnType<typeof setTimeout> | null = null;
	const activeAttentionIds = new Set<string>();
	const attentionKinds = new Map<string, SupersetAttentionKind>();
	const STOP_DEBOUNCE_MS = 250;

	function rememberCtx(ctx: HookCtx | undefined): void {
		if (ctx) lastCtx = ctx;
	}

	function cancelPendingStop(): void {
		if (pendingStopTimer) {
			clearTimeout(pendingStopTimer);
			pendingStopTimer = null;
		}
	}

	function queueLifecycle(eventName: string, ctx?: HookCtx): Promise<void> {
		rememberCtx(ctx);
		const effectiveCtx = ctx ?? lastCtx;

		// Serialize notify.sh invocations so Start/Stop cannot overtake each
		// other when consecutive lifecycle events happen close together.
		notifyQueue = notifyQueue
			.catch(() => undefined)
			.then(() => fire(notifyScript, eventName, effectiveCtx));
		return notifyQueue;
	}

	function fireLifecycle(eventName: string, ctx?: HookCtx): void {
		cancelPendingStop();
		void queueLifecycle(eventName, ctx);
	}

	function scheduleStop(ctx?: HookCtx): void {
		rememberCtx(ctx);
		const effectiveCtx = ctx ?? lastCtx;
		cancelPendingStop();
		pendingStopTimer = setTimeout(() => {
			pendingStopTimer = null;
			void queueLifecycle("Stop", effectiveCtx);
		}, STOP_DEBOUNCE_MS);
	}

	function flushStop(ctx?: HookCtx): Promise<void> {
		activeAttentionIds.clear();
		attentionKinds.clear();
		cancelPendingStop();
		return queueLifecycle("Stop", ctx);
	}

	pi.events.on(SUPERSET_ATTENTION_EVENT, (data: unknown) => {
		const event = data && typeof data === "object" ? (data as Partial<SupersetAttentionEvent>) : undefined;
		if (!event?.id || !event.phase) return;

		const previousSize = activeAttentionIds.size;
		if (event.phase === "start") {
			activeAttentionIds.add(event.id);
			attentionKinds.set(event.id, event.kind ?? "input");
			if (previousSize === 0 && activeAttentionIds.size === 1) {
				fireLifecycle("request_user_input");
			}
			return;
		}

		activeAttentionIds.delete(event.id);
		attentionKinds.delete(event.id);
		if (previousSize > 0 && activeAttentionIds.size === 0) {
			fireLifecycle("Start");
		}
	});

	// Do not emit SessionStart from pi's `session_start`.
	//
	// In pi, `session_start` fires as soon as the UI/session opens or reloads,
	// before the user has submitted any prompt. Superset treats that as an
	// active/running lifecycle signal, which causes a false yellow dot the
	// moment pi opens. For pi, the first real "working" signal should be the
	// actual prompt submission (`before_agent_start`).

	pi.on("before_agent_start", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		fireLifecycle("UserPromptSubmit", ctx);
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		if (event.toolName !== "AskUserQuestion") return;
		fireLifecycle("request_user_input", ctx);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		if (event.toolName !== "AskUserQuestion") return;

		const details = (event.result as { details?: { cancelled?: boolean } } | undefined)?.details;
		if (details?.cancelled === true) return;

		// The question was answered and the tool finished, so pi is about to
		// continue the turn. Emit Start again so Superset transitions from the
		// red "needs attention" state back to amber "working" until agent_end.
		fireLifecycle("Start", ctx);
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;

		// `/compact` is a harness-level operation rather than a normal agent run,
		// so `before_agent_start`/`agent_end` do not cover it. Emit Start so
		// Superset shows the amber working dot while compaction is running.
		fireLifecycle("Start", ctx);
	});

	pi.on("session_compact", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;

		activeAttentionIds.clear();
		attentionKinds.clear();
		scheduleStop(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		if (event.willRetry) return;
		if (ctx.hasPendingMessages()) return;

		activeAttentionIds.clear();
		attentionKinds.clear();
		scheduleStop(ctx);
	});

	// Ensure Superset does not get stuck in a running state on quit/reload/
	// new-session/resume/fork, even if pi stops mid-turn.
	pi.on("session_shutdown", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		await flushStop(ctx);
	});
}
