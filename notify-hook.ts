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
import { createKittyNotifyHookAdapter } from "./notify-hook/adapters/kitty";
import { createSupersetNotifyHookAdapter } from "./notify-hook/adapters/superset";
import type {
	NotifyHookAdapter,
	NotifyHookContext,
	NotifyHookLifecycleEvent,
	NotifyHookLifecycleSignal,
	NotifyHookLifecycleSource,
} from "./notify-hook/adapters/types";

const STOP_DEBOUNCE_MS = 250;

type HookCtx = Pick<ExtensionContext, "hasUI" | "sessionManager">;

function shouldSkip(ctx: { hasUI?: boolean }): boolean {
	// In modern pi, non-interactive/subagent contexts report hasUI === false.
	// Keep the strict comparison so older pi builds (without hasUI) still work.
	return ctx.hasUI === false;
}

export default function notifyHook(pi: ExtensionAPI) {
	const supersetAdapter = createSupersetNotifyHookAdapter();
	const kittyAdapter = supersetAdapter ? null : createKittyNotifyHookAdapter();
	const adapters = [supersetAdapter, kittyAdapter].filter(
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

	function queueLifecycle(signal: NotifyHookLifecycleSignal, ctx?: HookCtx): Promise<void> {
		rememberCtx(ctx);
		const effectiveCtx = (ctx ?? lastCtx) as NotifyHookContext | undefined;

		notifyQueue = notifyQueue.catch(() => undefined).then(async () => {
			for (const adapter of adapters) {
				await adapter.fire(signal, effectiveCtx);
			}
		});
		return notifyQueue;
	}

	function fireLifecycle(eventName: NotifyHookLifecycleEvent, source: NotifyHookLifecycleSource, ctx?: HookCtx): void {
		cancelPendingStop();
		void queueLifecycle({ eventName, source }, ctx);
	}

	function scheduleStop(source: NotifyHookLifecycleSource, ctx?: HookCtx): void {
		rememberCtx(ctx);
		const effectiveCtx = ctx ?? lastCtx;
		cancelPendingStop();
		pendingStopTimer = setTimeout(() => {
			pendingStopTimer = null;
			void queueLifecycle({ eventName: "Stop", source }, effectiveCtx);
		}, STOP_DEBOUNCE_MS);
	}

	function flushStop(source: NotifyHookLifecycleSource, ctx?: HookCtx): Promise<void> {
		activeAttentionIds.clear();
		cancelPendingStop();
		return queueLifecycle({ eventName: "Stop", source }, ctx);
	}

	function handleAttentionEvent(data: unknown): void {
		const event = data && typeof data === "object" ? (data as Partial<NotifyHookAttentionEvent>) : undefined;
		if (!event?.id || !event.phase) return;

		const previousSize = activeAttentionIds.size;
		if (event.phase === "start") {
			activeAttentionIds.add(event.id);
			if (previousSize === 0 && activeAttentionIds.size === 1) {
				fireLifecycle("request_user_input", "attention_start");
			}
			return;
		}

		activeAttentionIds.delete(event.id);
		if (previousSize > 0 && activeAttentionIds.size === 0) {
			fireLifecycle("Start", "attention_end");
		}
	}

	pi.events.on(NOTIFY_HOOK_ATTENTION_EVENT, handleAttentionEvent);

	pi.on("before_agent_start", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		fireLifecycle("UserPromptSubmit", "before_agent_start", ctx);
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		fireLifecycle("Start", "session_before_compact", ctx);
	});

	pi.on("session_compact", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		activeAttentionIds.clear();
		scheduleStop("session_compact", ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (shouldSkip(ctx)) return;
		if ((event as { willRetry?: boolean }).willRetry) return;
		if (ctx.hasPendingMessages()) return;

		activeAttentionIds.clear();
		scheduleStop("agent_end", ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (shouldSkip(ctx)) return;
		await flushStop("session_shutdown", ctx);
	});
}
