import { detectReviewLanguage, type ReviewLanguage } from "./i18n.js";
import type { ReviewTarget } from "./types.js";

interface SessionEntriesReader {
	getEntries(): unknown[];
}

function extractMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return !!part
				&& typeof part === "object"
				&& (part as { type?: string }).type === "text"
				&& typeof (part as { text?: unknown }).text === "string";
		})
		.map((part) => part.text)
		.join("\n");
}

export function summarizeText(text: string, max = 72): string {
	const singleLine = text.replace(/\s+/g, " ").trim();
	if (singleLine.length <= max) return singleLine;
	return `${singleLine.slice(0, Math.max(0, max - 1))}…`;
}

export function detectConversationLanguage(
	sessionManager: SessionEntriesReader,
	fallbackText: string,
): ReviewLanguage {
	const entries = sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; message?: { role?: string; content?: unknown } };
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const text = extractMessageText(entry.message.content);
		if (text.trim()) return detectReviewLanguage(text);
	}
	return detectReviewLanguage(fallbackText);
}

export function sameReviewTarget(a: ReviewTarget, b: ReviewTarget): boolean {
	if (a.type !== b.type) return false;
	switch (a.type) {
		case "uncommittedChanges":
			return true;
		case "baseBranch":
			return a.branch === (b as typeof a).branch;
		case "commit":
			return a.sha === (b as typeof a).sha;
		case "folder": {
			const other = (b as typeof a).paths;
			return a.paths.length === other.length && a.paths.every((path, index) => path === other[index]);
		}
		case "custom":
			return a.instructions.trim() === (b as typeof a).instructions.trim();
	}
}
