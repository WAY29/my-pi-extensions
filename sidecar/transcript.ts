/**
 * Render sidecar transcript with the same stock components as the main agent
 * (no extension message transformers).
 */
import {
	AssistantMessageComponent,
	ToolExecutionComponent,
	UserMessageComponent,
	getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

export type TranscriptMessage = {
	role: string;
	content?: unknown;
	toolCallId?: string;
	isError?: boolean;
	details?: unknown;
	stopReason?: string;
	errorMessage?: string;
	[key: string]: unknown;
};

function userText(message: TranscriptMessage): string {
	const content = message.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as { type?: string; text?: string };
		if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
	}
	return parts.join("\n").trim();
}

/**
 * Match interactive-mode's stock transcript rendering for user / assistant / toolResult.
 */
export function renderSidecarTranscript(
	messages: TranscriptMessage[],
	statusLines: string[],
	width: number,
	tui: TUI,
	cwd: string,
): string[] {
	const w = Math.max(20, width);
	const out: string[] = [];
	const mdTheme = getMarkdownTheme();

	for (const line of statusLines) {
		if (!line) {
			out.push("");
			continue;
		}
		// dim chrome only — not part of the agent transcript
		out.push(`\x1b[2m${line}\x1b[22m`);
	}

	const parts: Array<{ render: (width: number) => string[] }> = [];
	const pending = new Map<string, ToolExecutionComponent>();

	for (const message of messages) {
		if (message.role === "user") {
			const text = userText(message);
			if (text) parts.push(new UserMessageComponent(text, mdTheme, 1));
			continue;
		}

		if (message.role === "assistant") {
			parts.push(
				new AssistantMessageComponent(
					message as any,
					/* hideThinkingBlock */ false,
					mdTheme,
					"Thinking...",
					1,
				),
			);
			const content = message.content;
			if (!Array.isArray(content)) continue;
			for (const part of content) {
				if (!part || typeof part !== "object") continue;
				const c = part as {
					type?: string;
					name?: string;
					id?: string;
					arguments?: unknown;
				};
				if (c.type !== "toolCall" || !c.name || !c.id) continue;
				const comp = new ToolExecutionComponent(
					c.name,
					c.id,
					c.arguments,
					{ showImages: false },
					undefined,
					tui,
					cwd,
				);
				comp.markExecutionStarted();
				comp.setArgsComplete();
				if (message.stopReason === "aborted" || message.stopReason === "error") {
					const errText =
						message.stopReason === "aborted"
							? "Operation aborted"
							: message.errorMessage || "Error";
					comp.updateResult({ content: [{ type: "text", text: errText }], isError: true });
				} else {
					pending.set(c.id, comp);
				}
				parts.push(comp);
			}
			continue;
		}

		if (message.role === "toolResult" && message.toolCallId) {
			const comp = pending.get(message.toolCallId);
			if (!comp) continue;
			const content = Array.isArray(message.content)
				? (message.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>)
				: [{ type: "text", text: String(message.content ?? "") }];
			comp.updateResult({
				content,
				details: message.details,
				isError: Boolean(message.isError),
			});
			pending.delete(message.toolCallId);
		}
	}

	for (const part of parts) {
		try {
			out.push(...part.render(w));
		} catch {
			// never let one component take down the overlay
		}
	}

	if (!out.length) out.push("\x1b[2m(no transcript yet)\x1b[22m");
	return out;
}
