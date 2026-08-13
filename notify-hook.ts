/**
 * Notify Hook Extension
 *
 * Generic lifecycle bridge for external notification platforms.
 *
 * Current adapters:
 * - Kitty (`notify-hook/adapters/kitty.ts`)
 * - Herdr (`notify-hook/adapters/herdr.ts`) — attention → herdr:blocked only
 *
 * Lifecycle semantics:
 * - working: before_agent_start / agent_start / tool_* / message_end
 * - done: agent_settled (or agent_end + isIdle fallback)
 * - compact / /new teardown do not emit completion
 * - AskUserQuestion waits use attention → request_user_input
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	NOTIFY_HOOK_ATTENTION_EVENT,
	type NotifyHookAttentionEvent,
} from "./notify-hook/attention";
import { createHerdrNotifyHookAdapter } from "./notify-hook/adapters/herdr";
import { createKittyNotifyHookAdapter } from "./notify-hook/adapters/kitty";
import type {
	NotifyHookAdapter,
	NotifyHookContext,
	NotifyHookLifecycleEvent,
	NotifyHookLifecycleSignal,
	NotifyHookLifecycleSource,
} from "./notify-hook/adapters/types";

// Why: agent_end can fire while retry/compact/follow-up work is still queued;
// isIdle flips slightly later, so recheck before treating the turn as done.
const AGENT_END_IDLE_RECHECK_MS = 25;
const AGENT_END_IDLE_RECHECK_MAX_MS = 250;

type HookCtx = Pick<ExtensionContext, "hasUI" | "sessionManager" | "isIdle">;

function shouldSkip(ctx: { hasUI?: boolean }): boolean {
	// In modern pi, non-interactive/subagent contexts report hasUI === false.
	// Keep the strict comparison so older pi builds (without hasUI) still work.
	return ctx.hasUI === false;
}

function extractAssistantText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let out = "";
	for (const part of content) {
		if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string") out += text;
		}
	}
	return out;
}

export default function notifyHook(pi: ExtensionAPI) {
	const kittyAdapter = createKittyNotifyHookAdapter();
	const herdrAdapter = createHerdrNotifyHookAdapter(pi);
	const adapters = [kittyAdapter, herdrAdapter].filter(
		(adapter): adapter is NotifyHookAdapter => adapter !== null,
	);
	if (adapters.length === 0) return;

	let lastCtx: HookCtx | undefined;
	const activeAttentionIds = new Set<string>();

	// Why: once agent_settled is observed, prefer it forever for this process.
	// agent_end is then ignored.
	let agentSettledSupported = false;
	let agentEndReported = false;
	let agentEndIdleRecheckMs = AGENT_END_IDLE_RECHECK_MS;
	let pendingAgentEndCheck: ReturnType<typeof setTimeout> | null = null;
	let pendingAgentEndContext: HookCtx | null = null;

	function rememberCtx(ctx: HookCtx | undefined): void {
		if (ctx) lastCtx = ctx;
	}

	function clearPendingAgentEndCheck(): void {
		if (pendingAgentEndCheck) {
			clearTimeout(pendingAgentEndCheck);
			pendingAgentEndCheck = null;
		}
		pendingAgentEndContext = null;
	}

	function fireLifecycle(
		eventName: NotifyHookLifecycleEvent,
		source: NotifyHookLifecycleSource,
		ctx?: HookCtx,
		details?: Record<string, unknown>,
	): void {
		rememberCtx(ctx);
		if (eventName === "UserPromptSubmit" || eventName === "Start") {
			clearPendingAgentEndCheck();
		}

		const effectiveCtx = (ctx ?? lastCtx) as NotifyHookContext | undefined;
		const signal: NotifyHookLifecycleSignal = { eventName, source, details };

		// Why: local attention cue even when no external adapter is active.
		if (eventName === "request_user_input") {
			process.stdout.write("\x07");
		}

		// Why: adapters must not block pi's awaited extension handlers.
		// Fire-and-forget delivery keeps the extension path non-blocking.
		for (const adapter of adapters) {
			void Promise.resolve(adapter.fire(signal, effectiveCtx)).catch(() => undefined);
		}
	}

	function postStopOnce(source: NotifyHookLifecycleSource, ctx?: HookCtx): void {
		if (agentEndReported) return;
		agentEndReported = true;
		activeAttentionIds.clear();
		clearPendingAgentEndCheck();
		fireLifecycle("Stop", source, ctx);
	}

	function checkPendingAgentEnd(): void {
		pendingAgentEndCheck = null;
		const ctx = pendingAgentEndContext;
		if (!ctx || agentSettledSupported || agentEndReported) {
			pendingAgentEndContext = null;
			return;
		}

		try {
			if (ctx.isIdle()) {
				pendingAgentEndContext = null;
				postStopOnce("agent_end", ctx);
				return;
			}
		} catch {
			pendingAgentEndContext = null;
			return;
		}

		pendingAgentEndCheck = setTimeout(checkPendingAgentEnd, agentEndIdleRecheckMs);
		if (typeof pendingAgentEndCheck.unref === "function") pendingAgentEndCheck.unref();
		agentEndIdleRecheckMs = Math.min(agentEndIdleRecheckMs * 2, AGENT_END_IDLE_RECHECK_MAX_MS);
	}

	function handleAttentionEvent(data: unknown): void {
		const event = data && typeof data === "object" ? (data as Partial<NotifyHookAttentionEvent>) : undefined;
		if (!event?.id || !event.phase) return;

		const previousSize = activeAttentionIds.size;
		if (event.phase === "start") {
			activeAttentionIds.add(event.id);
			if (previousSize === 0 && activeAttentionIds.size === 1) {
				fireLifecycle("request_user_input", "attention_start", undefined, {
					source: event.source,
					kind: event.kind,
				});
			}
			return;
		}

		activeAttentionIds.delete(event.id);
		if (previousSize > 0 && activeAttentionIds.size === 0) {
			// Why: soft "waiting" ends; re-assert working without claiming the turn settled.
			fireLifecycle("Start", "attention_end");
		}
	}

	pi.events.on(NOTIFY_HOOK_ATTENTION_EVENT, handleAttentionEvent);

	pi.on("before_agent_start", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		// Why: event.prompt is authoritative; branch may not include the user turn yet.
		fireLifecycle("UserPromptSubmit", "before_agent_start", ctx, {
			prompt: typeof event.prompt === "string" ? event.prompt : "",
		});
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		clearPendingAgentEndCheck();
		agentEndReported = false;
		fireLifecycle("Start", "agent_start", ctx);
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		fireLifecycle("tool_execution_start", "tool_execution_start", ctx, {
			tool_name: event.toolName,
			tool_input: event.args,
		});
	});

	pi.on("tool_call", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		fireLifecycle("tool_call", "tool_call", ctx, {
			tool_name: event.toolName,
			tool_input: event.input,
		});
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		fireLifecycle("tool_execution_end", "tool_execution_end", ctx, {
			tool_name: event.toolName,
		});
	});

	pi.on("message_end", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		if ((event.message as { role?: unknown } | undefined)?.role !== "assistant") return;
		const text = extractAssistantText(event.message);
		if (!text) return;
		fireLifecycle("message_end", "message_end", ctx, { text });
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		agentSettledSupported = true;
		postStopOnce("agent_settled", ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		if (agentSettledSupported) return;

		// Why: legacy pi/OMP without agent_settled. Wait until isIdle so compact
		// retry and queued follow-ups do not look like completion.
		if (typeof ctx.isIdle !== "function") {
			postStopOnce("agent_end", ctx);
			return;
		}

		clearPendingAgentEndCheck();
		agentEndIdleRecheckMs = AGENT_END_IDLE_RECHECK_MS;
		pendingAgentEndContext = ctx;
		pendingAgentEndCheck = setTimeout(checkPendingAgentEnd, 0);
		if (typeof pendingAgentEndCheck.unref === "function") pendingAgentEndCheck.unref();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		// Why: /new /resume /fork teardown is not turn completion. Still emit a
		// session_shutdown-sourced Stop so adapters like Kitty can dismiss UI.
		clearPendingAgentEndCheck();
		activeAttentionIds.clear();
		fireLifecycle("Stop", "session_shutdown", ctx);
	});
}
