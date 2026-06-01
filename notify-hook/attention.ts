import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const NOTIFY_HOOK_ATTENTION_EVENT = "notify-hook:attention";

export type NotifyHookAttentionPhase = "start" | "end";

export type NotifyHookAttentionKind = "permission" | "auth" | "question" | "input";

export interface NotifyHookAttentionEvent {
	id: string;
	phase: NotifyHookAttentionPhase;
	source: string;
	kind?: NotifyHookAttentionKind;
}

export function createNotifyHookAttentionId(source: string): string {
	return `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function emitNotifyHookAttention(
	pi: ExtensionAPI,
	phase: NotifyHookAttentionPhase,
	id: string,
	source: string,
	kind: NotifyHookAttentionKind = "input",
): void {
	const event: NotifyHookAttentionEvent = { id, phase, source, kind };
	pi.events.emit(NOTIFY_HOOK_ATTENTION_EVENT, event);
}

export async function withNotifyHookAttention<T>(
	pi: ExtensionAPI,
	source: string,
	fn: () => Promise<T> | T,
	id: string = createNotifyHookAttentionId(source),
	kind: NotifyHookAttentionKind = "input",
): Promise<T> {
	emitNotifyHookAttention(pi, "start", id, source, kind);
	try {
		return await fn();
	} finally {
		emitNotifyHookAttention(pi, "end", id, source, kind);
	}
}
