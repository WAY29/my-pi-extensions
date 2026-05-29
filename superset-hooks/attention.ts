import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SUPERSET_ATTENTION_EVENT = "superset-hooks:attention";

export type SupersetAttentionPhase = "start" | "end";

export type SupersetAttentionKind = "permission" | "auth" | "question" | "input";

export interface SupersetAttentionEvent {
	id: string;
	phase: SupersetAttentionPhase;
	source: string;
	kind?: SupersetAttentionKind;
}

export function createSupersetAttentionId(source: string): string {
	return `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function emitSupersetAttention(
	pi: ExtensionAPI,
	phase: SupersetAttentionPhase,
	id: string,
	source: string,
	kind: SupersetAttentionKind = "input",
): void {
	const event: SupersetAttentionEvent = { id, phase, source, kind };
	pi.events.emit(SUPERSET_ATTENTION_EVENT, event);
}

export async function withSupersetAttention<T>(
	pi: ExtensionAPI,
	source: string,
	fn: () => Promise<T> | T,
	id: string = createSupersetAttentionId(source),
	kind: SupersetAttentionKind = "input",
): Promise<T> {
	emitSupersetAttention(pi, "start", id, source, kind);
	try {
		return await fn();
	} finally {
		emitSupersetAttention(pi, "end", id, source, kind);
	}
}
