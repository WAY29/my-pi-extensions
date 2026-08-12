/**
 * In-process nested AgentSession backend for sidecar mode=inner.
 */
import type { Model } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ModelRegistry,
	type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { resolveExtensionPaths, resolveSkillPaths } from "./config.js";
import { HerdrError } from "./herdr.js";
import { sidecarSessionsDir } from "./session.js";
import type { SidecarDefinition, SidecarInstance } from "./types.js";

const INNER_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function modelRuntimeOf(registry: ModelRegistry): ModelRuntime {
	const runtime = (registry as unknown as { runtime?: ModelRuntime }).runtime;
	if (!runtime) {
		throw new HerdrError("ModelRegistry.runtime missing; cannot create inner session");
	}
	return runtime;
}

function resolveModel(
	ctx: ExtensionContext | ExtensionCommandContext,
	def: SidecarDefinition,
): Model<any> {
	const raw = def.agent?.model?.trim();
	if (raw) {
		const slash = raw.indexOf("/");
		if (slash > 0) {
			const provider = raw.slice(0, slash);
			const id = raw.slice(slash + 1);
			const found = ctx.modelRegistry.find(provider, id);
			if (found) return found as Model<any>;
		}
		throw new HerdrError(`inner model not found: ${raw} (expected provider/id)`);
	}
	if (!ctx.model) throw new HerdrError("no active model for inner sidecar");
	return ctx.model as Model<any>;
}

function extractAssistantText(session: AgentSession): string {
	const messages = session.messages as Array<{ role?: string; content?: unknown }>;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role !== "assistant") continue;
		const content = msg.content;
		if (typeof content === "string" && content.trim()) return content.trim();
		if (!Array.isArray(content)) continue;
		const parts: string[] = [];
		for (const part of content) {
			if (
				part &&
				typeof part === "object" &&
				(part as { type?: string }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string"
			) {
				parts.push((part as { text: string }).text);
			}
		}
		const text = parts.join("\n").trim();
		if (text) return text;
	}
	return "";
}

export type InnerRuntime = {
	session: AgentSession;
	unsubscribe: () => void;
	sessionFile: string;
};

export async function createInnerRuntime(
	def: SidecarDefinition,
	ctx: ExtensionContext | ExtensionCommandContext,
	onMessages: (messages: any[]) => void,
	onStatus?: (line: string) => void,
): Promise<InnerRuntime> {
	const model = resolveModel(ctx, def);
	const thinkingLevel = (def.agent?.effort ?? ctx.thinkingLevel ?? "medium") as any;
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: true },
		retry: { enabled: true, maxRetries: 1 },
	});
	const sessionDir = sidecarSessionsDir();
	const sessionManager = SessionManager.create(ctx.cwd, sessionDir);
	const sessionFile = sessionManager.getSessionFile() || "";

	const extPaths = resolveExtensionPaths(def.agent?.extensions);
	const skillPaths = resolveSkillPaths(def.agent?.skills);
	const resourceLoader = new DefaultResourceLoader({
		cwd: ctx.cwd,
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: extPaths.length === 0,
		additionalExtensionPaths: extPaths,
		noSkills: skillPaths.length === 0,
		additionalSkillPaths: skillPaths,
		noPromptTemplates: true,
		noThemes: true,
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		model,
		thinkingLevel,
		modelRuntime: modelRuntimeOf(ctx.modelRegistry),
		resourceLoader,
		tools: INNER_TOOLS,
		sessionManager,
		settingsManager,
	});

	const pushMessages = () => {
		onMessages([...(session.messages as any[])]);
	};
	const unsubscribe = session.subscribe((_event: AgentSessionEvent) => {
		// Rebuild from session so status can use stock message renderers.
		pushMessages();
	});

	onStatus?.(`[inner session model=${model.provider}/${model.id}]`);
	if (sessionFile) onStatus?.(`[session ${sessionFile}]`);
	pushMessages();

	return { session, unsubscribe, sessionFile };
}

export async function runInnerRound(
	inst: SidecarInstance,
	promptText: string,
	timeoutMs: number,
): Promise<string> {
	const runtime = inst.inner;
	if (!runtime) throw new HerdrError(`sidecar '${inst.name}' has no inner session`);

	const onAbort = () => {
		void runtime.session.abort();
	};
	inst.abort.signal.addEventListener("abort", onAbort, { once: true });

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		inst.abort.abort();
	}, timeoutMs);

	try {
		await runtime.session.prompt(promptText);
	} catch (err) {
		if (inst.abort.signal.aborted) {
			throw new HerdrError(timedOut ? "sidecar timed out" : "sidecar aborted");
		}
		throw err;
	} finally {
		clearTimeout(timer);
		inst.abort.signal.removeEventListener("abort", onAbort);
	}

	if (inst.abort.signal.aborted) {
		throw new HerdrError(timedOut ? "sidecar timed out" : "sidecar aborted");
	}

	return extractAssistantText(runtime.session);
}

export function disposeInnerRuntime(inst: SidecarInstance): void {
	const runtime = inst.inner;
	if (!runtime) return;
	try {
		runtime.unsubscribe();
	} catch {
		// ignore
	}
	try {
		void runtime.session.abort();
	} catch {
		// ignore
	}
	try {
		runtime.session.dispose();
	} catch {
		// ignore
	}
	inst.inner = undefined;
}
