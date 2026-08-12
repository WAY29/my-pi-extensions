import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function sidecarSessionsDir(): string {
	const dir = join(homedir(), ".pi", "agent", "sidecars", "sessions");
	mkdirSync(dir, { recursive: true });
	return dir;
}

export function newSidecarSessionFile(name: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const safe = name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || "sidecar";
	return join(sidecarSessionsDir(), `${safe}-${stamp}.jsonl`);
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return (
				!!part &&
				typeof part === "object" &&
				(part as { type?: string }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string"
			);
		})
		.map((part) => part.text)
		.join("\n");
}

/**
 * Read the last non-empty assistant text from a pi session jsonl.
 * Ignores TUI chrome; only message content.
 */
function parseSessionMessage(obj: any): any | null {
	if (!obj || typeof obj !== "object") return null;
	// entry shapes: { type:"message", message:{ role, content } } or nested variants
	if (obj.type === "message") return obj.message ?? null;
	if (obj.role) return obj;
	if (obj.message?.role) return obj.message;
	return null;
}

/** Full user/assistant/toolResult message list from a pi session jsonl. */
export function readMessagesFromSession(sessionFile: string): any[] {
	if (!sessionFile || !existsSync(sessionFile)) return [];
	const text = readFileSync(sessionFile, "utf8");
	const out: any[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let obj: any;
		try {
			obj = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const msg = parseSessionMessage(obj);
		if (!msg?.role) continue;
		if (msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult") {
			out.push(msg);
		}
	}
	return out;
}

export function readLastAssistantFromSession(sessionFile: string): string {
	const messages = readMessagesFromSession(sessionFile);
	let last = "";
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		const body = extractText(msg.content);
		if (body.trim()) last = body;
	}
	return last;
}
