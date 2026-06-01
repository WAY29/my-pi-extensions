/**
 * Notify Hook Extension
 *
 * Generic lifecycle bridge for external notification platforms.
 *
 * Current adapters:
 * - Superset (`notify-hook/adapters/superset.ts`)
 *
 * The extension itself is platform-agnostic: it tracks pi lifecycle events and
 * temporary "awaiting user attention" signals, then forwards normalized events
 * to every active adapter.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	NOTIFY_HOOK_ATTENTION_EVENT,
	type NotifyHookAttentionEvent,
} from "./notify-hook/attention";
import {
	createSupersetNotifyHookAdapter,
	type NotifyHookAdapter,
	type NotifyHookContext,
	type NotifyHookLifecycleEvent,
} from "./notify-hook/adapters/superset";

const STOP_DEBOUNCE_MS = 250;

type HookCtx = Pick<ExtensionContext, "hasUI" | "sessionManager">;

function shouldSkip(ctx: { hasUI?: boolean }): boolean {
	// In modern pi, non-interactive/subagent contexts report hasUI === false.
	// Keep the strict comparison so older pi builds (without hasUI) still work.
	return ctx.hasUI === false;
}

export default function notifyHook(pi: ExtensionAPI) {
	const adapters = [createSupersetNotifyHookAdapter()].filter(
		(adapter): adapter is NotifyHookAdapter => adapter !== null,
	);
	if (adapters.length === 0) return;

	let lastCtx: HookCtx | undefined;
	let notifyQueue: Promise<void> = Promise.resolve();
	let pendingStopTimer: ReturnType<typeof setTimeout> | null = null;
	const activeAttentionIds = new Set<string>();

	function rememberCtx(ctx: HookCtx | undefined): void {
		if (ctx) lastCtx = ctx;
	}

	function cancelPendingStop(): void {
		if (pendingStopTimer) {
			clearTimeout(pendingStopTimer);
			pendingStopTimer = null;
		}
	}

	function queueLifecycle(eventName: NotifyHookLifecycleEvent, ctx?: HookCtx): Promise<void> {
		rememberCtx(ctx);
		const effectiveCtx = (ctx ?? lastCtx) as NotifyHookContext | undefined;

		notifyQueue = notifyQueue.catch(() => undefined).then(async () => {
			for (const adapter of adapters) {
				await adapter.fire(eventName, effectiveCtx);
			}
		});
		return notifyQueue;
	}

	function fireLifecycle(eventName: NotifyHookLifecycleEvent, ctx?: HookCtx): void {
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
		cancelPendingStop();
		return queueLifecycle("Stop", ctx);
	}

	function handleAttentionEvent(data: unknown): void {
		const event = data && typeof data === "object" ? (data as Partial<NotifyHookAttentionEvent>) : undefined;
		if (!event?.id || !event.phase) return;

		const previousSize = activeAttentionIds.size;
		if (event.phase === "start") {
			activeAttentionIds.add(event.id);
			if (previousSize === 0 && activeAttentionIds.size === 1) {
				fireLifecycle("request_user_input");
			}
			return;
		}

		activeAttentionIds.delete(event.id);
		if (previousSize > 0 && activeAttentionIds.size === 0) {
			fireLifecycle("Start");
		}
	}

	pi.events.on(NOTIFY_HOOK_ATTENTION_EVENT, handleAttentionEvent);

	pi.on("before_agent_start", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		fireLifecycle("UserPromptSubmit", ctx);
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		fireLifecycle("Start", ctx);
	});

	pi.on("session_compact", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		activeAttentionIds.clear();
		scheduleStop(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		if (event.willRetry) return;
		if (ctx.hasPendingMessages()) return;

		activeAttentionIds.clear();
		scheduleStop(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		await flushStop(ctx);
	});
}
