import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Align with sub2api gateway default (codexCLIVersion / CodexDefaultOriginator).
const CODEX_VERSION = "0.146.0";
const CODEX_ORIGINATOR = "codex-tui";
const CODEX_USER_AGENT = `${CODEX_ORIGINATOR}/${CODEX_VERSION} (Mac OS X 15.0; arm64) xterm-256color`;

function isGptModel(model: { id?: string } | undefined): boolean {
	return typeof model?.id === "string" && model.id.toLowerCase().startsWith("gpt");
}

function clearHeader(headers: Record<string, string | null>, name: string): void {
	const lower = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === lower) headers[key] = null;
	}
}

/**
 * Apply Codex official client headers so sub2api codex_cli_only passes:
 * official UA/originator + parseable version + x-codex-* engine fingerprint.
 * Mutates headers in place.
 */
export function applyCodexProfile(
	headers: Record<string, string | null>,
	model: { id?: string } | undefined,
	windowId: string = randomUUID(),
): boolean {
	if (!isGptModel(model)) return false;

	clearHeader(headers, "user-agent");
	clearHeader(headers, "originator");
	clearHeader(headers, "version");
	clearHeader(headers, "x-codex-window-id");

	headers["User-Agent"] = CODEX_USER_AGENT;
	headers["originator"] = CODEX_ORIGINATOR;
	headers["version"] = CODEX_VERSION;
	headers["x-codex-window-id"] = windowId;
	return true;
}

export default function piCodexProfile(pi: ExtensionAPI): void {
	pi.on("before_provider_headers", (event, ctx) => {
		applyCodexProfile(event.headers, ctx.model);
	});
}
