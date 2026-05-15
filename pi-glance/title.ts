import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export const TITLE_CUSTOM_TYPE = "pi-glance:title";
export const TITLE_PLACEHOLDER = "Generating Title...";
export const TITLE_MAX_WIDTH = 64;

const TRAILING_PUNCTUATION = /[\s.!?。！？,，;；:：、]+$/u;
const WRAPPING_QUOTES = /^["'“”‘’「」『』《》\[\]()（）【】]+|["'“”‘’「」『』《》\[\]()（）【】]+$/gu;
const ANSI_CONTROLS = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsiControls(text: string): string {
	return text.replace(ANSI_CONTROLS, "");
}

function firstContentLine(text: string): string {
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return "";
}

function cleanTitleText(text: string): string {
	return stripAnsiControls(firstContentLine(text))
		.replace(/^```[\w-]*\s*/u, "")
		.replace(/^#+\s*/u, "")
		.replace(/^[-*•]\s+/u, "")
		.replace(/^\d+[.)、]\s*/u, "")
		.replace(/^(?:title|标题|主题)\s*[:：]\s*/iu, "")
		.replace(WRAPPING_QUOTES, "")
		.replace(/\s+/gu, " ")
		.trim()
		.replace(TRAILING_PUNCTUATION, "")
		.trim();
}

export function sanitizeGeneratedTitle(text: string, fallback: string): string {
	const cleaned = cleanTitleText(text) || cleanTitleText(fallback) || "New chat";
	if (visibleWidth(cleaned) <= TITLE_MAX_WIDTH) return cleaned;
	return stripAnsiControls(truncateToWidth(cleaned, TITLE_MAX_WIDTH, "…")).trim();
}

export function fallbackTitleFromPrompt(prompt: string): string {
	return sanitizeGeneratedTitle(prompt, "New chat");
}

export type SessionNameUpdate = { action: "noop" } | { action: "clear" } | { action: "set"; name: string };

function normalizeSessionName(value: string | null | undefined): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

export function resolveSessionNameUpdate(options: {
	enabled: boolean;
	currentSessionName?: string | null;
	previousTitle?: string | null;
	nextTitle?: string | null;
}): SessionNameUpdate {
	const currentSessionName = normalizeSessionName(options.currentSessionName);
	const previousTitle = normalizeSessionName(options.previousTitle);
	const nextTitle = normalizeSessionName(options.nextTitle);

	if (!options.enabled) {
		if (currentSessionName && previousTitle && currentSessionName === previousTitle) return { action: "clear" };
		return { action: "noop" };
	}

	if (!nextTitle || currentSessionName === nextTitle) return { action: "noop" };
	if (!currentSessionName) return { action: "set", name: nextTitle };
	if (previousTitle && currentSessionName === previousTitle) return { action: "set", name: nextTitle };
	return { action: "noop" };
}

export function shouldSetFallbackTitle(title: { text: string | null; generating: boolean }): boolean {
	return !title.generating && !title.text;
}

export function shouldGenerateTitle(
	title: { text: string | null; generating: boolean; source?: "fallback" | "llm"; model?: string },
	targetModel: string | undefined,
): boolean {
	if (!targetModel || title.generating) return false;
	if (!title.text) return true;
	return title.source === "fallback" || (!title.source && !title.model);
}