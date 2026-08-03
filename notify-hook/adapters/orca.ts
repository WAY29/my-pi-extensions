import { request as httpRequest } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { NotifyHookAdapter, NotifyHookContext, NotifyHookLifecycleSignal } from "./types";

const HOOK_POST_TIMEOUT_MS = 1000;
const MANAGED_STATUS_MARKER = "@orca-managed-pi-extension";
const MANAGED_STATUS_FILE = "orca-agent-status.ts";

let warnedBadEndpoint = false;
let warnedDeliveryFailure = false;
let cachedEndpointKey = "";
let cachedEndpointValues: Record<string, string> | null = null;
let postQueue: Promise<void> = Promise.resolve();

function managedStatusPaths(): string[] {
	const paths = [join(homedir(), ".pi", "agent", "extensions", MANAGED_STATUS_FILE)];
	const sourceDir = process.env.ORCA_PI_SOURCE_AGENT_DIR;
	if (sourceDir) paths.push(join(sourceDir, "extensions", MANAGED_STATUS_FILE));
	return paths;
}

/** Orca now injects orca-agent-status.ts; it owns lifecycle status when present. */
function hasManagedOrcaStatusExtension(): boolean {
	for (const path of managedStatusPaths()) {
		try {
			if (existsSync(path) && readFileSync(path, "utf8").includes(MANAGED_STATUS_MARKER)) {
				return true;
			}
		} catch {
			// ignore
		}
	}
	return false;
}

function hasLiveHookCredentials(): boolean {
	if (process.env.ORCA_AGENT_HOOK_PORT && process.env.ORCA_AGENT_HOOK_TOKEN) return true;
	// Official path: only the explicit endpoint path, never a guessed userData fallback.
	return Boolean(process.env.ORCA_AGENT_HOOK_ENDPOINT);
}

function hasOrcaRuntimeHints(): boolean {
	if (!process.env.ORCA_PANE_KEY) return false;
	return hasLiveHookCredentials();
}

function parseEndpointFile(contents: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of contents.split(/\r?\n/)) {
		const match = line.match(/^(?:set\s+)?([A-Z0-9_]+)=(.*)$/);
		if (!match) continue;
		out[match[1]] = match[2].replace(/\r$/, "");
	}
	return out;
}

function readEndpointFile(): Record<string, string> | null {
	// Why: do NOT fall back to userData/agent-hooks/endpoint.env. That file goes
	// stale when Orca restarts or hooks are disabled, and causes silent timeouts.
	// Match Orca's managed plugin: only ORCA_AGENT_HOOK_ENDPOINT.
	const path = process.env.ORCA_AGENT_HOOK_ENDPOINT;
	if (!path) return null;

	try {
		const stat = statSync(path);
		const cacheKey = `${stat.mtimeMs}:${stat.size}`;
		if (cacheKey === cachedEndpointKey && cachedEndpointValues) return cachedEndpointValues;

		const out = parseEndpointFile(readFileSync(path, "utf8"));
		cachedEndpointKey = cacheKey;
		cachedEndpointValues = out;
		return out;
	} catch (error) {
		cachedEndpointKey = "";
		cachedEndpointValues = null;
		const code = (error as { code?: string } | null)?.code;
		if (code !== "ENOENT" && !warnedBadEndpoint) {
			warnedBadEndpoint = true;
			console.warn("[notify-hook:orca] failed to parse endpoint file:", (error as Error).message);
		}
		return null;
	}
}

type OrcaHookCoords = {
	port: string;
	token: string;
	paneKey: string;
	tabId?: string;
	worktreeId?: string;
	env?: string;
	version?: string;
};

function resolveHookCoords(): OrcaHookCoords | null {
	const fileEnv = readEndpointFile() ?? {};
	// Prefer live PTY env over endpoint file (file can lag one restart behind).
	const port = process.env.ORCA_AGENT_HOOK_PORT || fileEnv.ORCA_AGENT_HOOK_PORT;
	const token = process.env.ORCA_AGENT_HOOK_TOKEN || fileEnv.ORCA_AGENT_HOOK_TOKEN;
	const paneKey = process.env.ORCA_PANE_KEY;
	if (!port || !token || !paneKey) return null;

	const tabId = process.env.ORCA_TAB_ID || undefined;
	const worktreeId = process.env.ORCA_WORKTREE_ID || undefined;
	const env = process.env.ORCA_AGENT_HOOK_ENV || fileEnv.ORCA_AGENT_HOOK_ENV || undefined;
	const version = process.env.ORCA_AGENT_HOOK_VERSION || fileEnv.ORCA_AGENT_HOOK_VERSION || undefined;
	return { port, token, paneKey, tabId, worktreeId, env, version };
}

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"),
		)
		.map((part) => part.text)
		.join("")
		.trim();
}

function getBranch(ctx?: NotifyHookContext): unknown[] {
	try {
		return ctx?.sessionManager.getBranch() ?? [];
	} catch {
		return [];
	}
}

function getSessionMetadata(ctx?: NotifyHookContext): Record<string, unknown> {
	try {
		const sessionId = ctx?.sessionManager.getSessionId?.();
		const sessionFile = ctx?.sessionManager.getSessionFile?.();
		if (typeof sessionId !== "string" || !sessionId) return {};
		if (typeof sessionFile === "string" && sessionFile && !existsSync(sessionFile)) return {};
		return {
			session_id: sessionId,
			...(typeof sessionFile === "string" && sessionFile ? { session_file: sessionFile } : {}),
		};
	} catch {
		return {};
	}
}

function getLastUserPrompt(ctx?: NotifyHookContext): string | undefined {
	for (const entry of [...getBranch(ctx)].reverse()) {
		if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "message") continue;
		const message = (entry as { message?: unknown }).message;
		if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "user") continue;
		const text = extractTextContent((message as { content?: unknown }).content);
		if (text) return text;
	}
	return undefined;
}

function getLastAssistantText(ctx?: NotifyHookContext): string | undefined {
	for (const entry of [...getBranch(ctx)].reverse()) {
		if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "message") continue;
		const message = (entry as { message?: unknown }).message;
		if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") continue;
		const text = extractTextContent((message as { content?: unknown }).content);
		if (text) return text;
	}
	return undefined;
}

function getLatestAskUserQuestionPrompt(ctx?: NotifyHookContext): string | undefined {
	for (const entry of [...getBranch(ctx)].reverse()) {
		if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "message") continue;
		const message = (entry as { message?: unknown }).message;
		if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") continue;
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;

		for (const part of [...content].reverse()) {
			if (!part || typeof part !== "object") continue;
			const candidate = part as { type?: unknown; name?: unknown; arguments?: unknown };
			if (candidate.type !== "toolCall" || candidate.name !== "AskUserQuestion") continue;
			const prompt = extractAskUserQuestionPrompt(candidate.arguments);
			if (prompt) return prompt;
		}
	}

	return undefined;
}

function extractAskUserQuestionPrompt(argumentsValue: unknown): string | undefined {
	if (!argumentsValue || typeof argumentsValue !== "object") return undefined;
	const record = argumentsValue as {
		prompt?: unknown;
		question?: unknown;
		questions?: Array<{ prompt?: unknown; question?: unknown }>;
	};

	if (typeof record.prompt === "string" && record.prompt.trim()) return record.prompt.trim();
	if (typeof record.question === "string" && record.question.trim()) return record.question.trim();
	if (!Array.isArray(record.questions)) return undefined;

	const prompts = record.questions
		.map((item) => {
			if (typeof item?.prompt === "string" && item.prompt.trim()) return item.prompt.trim();
			if (typeof item?.question === "string" && item.question.trim()) return item.question.trim();
			return undefined;
		})
		.filter((value): value is string => Boolean(value));
	if (prompts.length === 0) return undefined;
	return prompts.slice(0, 3).join(" · ");
}

function postToOrca(hookEventName: string, extra: Record<string, unknown> = {}, ctx?: NotifyHookContext): Promise<void> {
	const payloadExtra = { ...getSessionMetadata(ctx), ...extra };
	postQueue = postQueue.catch(() => undefined).then(() => postOnce(hookEventName, payloadExtra));
	return postQueue;
}

/**
 * Why: use node:http, not fetch. User HTTP_PROXY can intercept 127.0.0.1 and
 * hang; http.request never uses env proxies.
 */
function postOnce(hookEventName: string, extra: Record<string, unknown>): Promise<void> {
	const coords = resolveHookCoords();
	if (!coords) return Promise.resolve();

	const body = JSON.stringify({
		paneKey: coords.paneKey,
		launchToken: process.env.ORCA_AGENT_LAUNCH_TOKEN || "",
		tabId: coords.tabId || "",
		worktreeId: coords.worktreeId || "",
		env: coords.env || "",
		version: coords.version || "",
		payload: { hook_event_name: hookEventName, ...extra },
	});

	return new Promise((resolve) => {
		const req = httpRequest(
			{
				host: "127.0.0.1",
				port: Number(coords.port),
				path: "/hook/pi",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
					"X-Orca-Agent-Hook-Token": coords.token,
				},
				timeout: HOOK_POST_TIMEOUT_MS,
			},
			(res) => {
				res.resume();
				warnedDeliveryFailure = false;
				resolve();
			},
		);

		req.on("timeout", () => {
			req.destroy(new Error("Orca hook delivery timed out"));
		});

		req.on("error", (error) => {
			if (!warnedDeliveryFailure) {
				warnedDeliveryFailure = true;
				console.warn(
					`[notify-hook:orca] hook delivery failed (${error.message}). Fully quit & relaunch Orca after enabling agent status hooks so the hook server binds a live port.`,
				);
			}
			resolve();
		});

		req.end(body);
	});
}

function previewForUserInput(ctx?: NotifyHookContext): string {
	return getLatestAskUserQuestionPrompt(ctx) || getLastAssistantText(ctx) || "Needs your input";
}

export function createOrcaNotifyHookAdapter(): NotifyHookAdapter | null {
	if (!hasOrcaRuntimeHints()) return null;

	// Why: this extension exists mainly for custom attention (AskUserQuestion,
	// permission-gate, sudo-auth, …). Orca's managed orca-agent-status owns
	// normal lifecycle; we only keep request_user_input when it is present.
	// Tests can set NOTIFY_HOOK_FORCE_ORCA_ADAPTER=1 to exercise full lifecycle.
	const managedOwnsLifecycle =
		process.env.NOTIFY_HOOK_FORCE_ORCA_ADAPTER !== "1" && hasManagedOrcaStatusExtension();

	return {
		name: "orca",
		async fire(signal: NotifyHookLifecycleSignal, ctx?: NotifyHookContext): Promise<void> {
			if (signal.eventName === "request_user_input") {
				// Soft waiting: Orca pi normalizer has no `waiting` state, so surface
				// question preview as lastAssistantMessage. BEL is emitted by notify-hook core.
				await postToOrca(
					"message_end",
					{
						role: "assistant",
						text: previewForUserInput(ctx),
					},
					ctx,
				);
				return;
			}

			// Managed extension already posts working/done/tool/message lifecycle.
		if (managedOwnsLifecycle) return;

			if (signal.eventName === "UserPromptSubmit") {
				const prompt =
					(typeof signal.details?.prompt === "string" ? signal.details.prompt : undefined) ||
					getLastUserPrompt(ctx) ||
					"";
				await postToOrca("before_agent_start", { prompt }, ctx);
				return;
			}

			if (signal.eventName === "Start") {
				await postToOrca("agent_start", {}, ctx);
				return;
			}

			if (signal.eventName === "tool_execution_start") {
				await postToOrca(
					"tool_execution_start",
					{
						tool_name: signal.details?.tool_name,
						tool_input: signal.details?.tool_input,
					},
					ctx,
				);
				return;
			}

			if (signal.eventName === "tool_call") {
				await postToOrca(
					"tool_call",
					{
						tool_name: signal.details?.tool_name,
						tool_input: signal.details?.tool_input,
					},
					ctx,
				);
				return;
			}

			if (signal.eventName === "tool_execution_end") {
				await postToOrca(
					"tool_execution_end",
					{
						tool_name: signal.details?.tool_name,
					},
					ctx,
				);
				return;
			}

			if (signal.eventName === "message_end") {
				const text = typeof signal.details?.text === "string" ? signal.details.text : "";
				if (!text) return;
				await postToOrca("message_end", { role: "assistant", text }, ctx);
				return;
			}

			if (signal.source === "session_shutdown") return;

			const assistantText =
				(typeof signal.details?.text === "string" ? signal.details.text : undefined) ||
				getLastAssistantText(ctx);
			if (assistantText) {
				await postToOrca("message_end", { role: "assistant", text: assistantText }, ctx);
			}

			await postToOrca("agent_end", {}, ctx);
		},
	};
}

export const __test__ = {
	parseEndpointFile,
	extractAskUserQuestionPrompt,
	getLatestAskUserQuestionPrompt,
	getLastAssistantText,
	getLastUserPrompt,
	previewForUserInput,
	hasManagedOrcaStatusExtension,
	hasLiveHookCredentials,
};
