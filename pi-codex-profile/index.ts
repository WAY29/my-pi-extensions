import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CODEX_DESKTOP_USER_AGENT =
	"Codex Desktop/0.140.0-alpha.19 (Mac OS 26.5.1; arm64) unknown (Codex Desktop; 26.611.61753)";

function isGptModel(model: { id?: string } | undefined): boolean {
	return typeof model?.id === "string" && model.id.toLowerCase().startsWith("gpt");
}

/** Apply Codex Desktop UA for GPT models. Mutates headers in place. */
export function applyCodexUserAgent(
	headers: Record<string, string | null>,
	model: { id?: string } | undefined,
): boolean {
	if (!isGptModel(model)) return false;

	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === "user-agent") headers[key] = null;
	}
	headers["User-Agent"] = CODEX_DESKTOP_USER_AGENT;
	return true;
}

export default function piCodexProfile(pi: ExtensionAPI): void {
	pi.on("before_provider_headers", (event, ctx) => {
		applyCodexUserAgent(event.headers, ctx.model);
	});
}
