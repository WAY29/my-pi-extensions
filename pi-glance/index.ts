import { completeSimple, type Api, type Model, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { captureGlobalSettingsSnapshot, getWorkspaceAutoModelSpec, loadGlobalDefaultModelReference, restoreGlobalSettingsSnapshot } from "./auto-model.js";
import { cloneConfig, loadConfig, saveConfig } from "./config.js";
import { GlanceEditor } from "./editor.js";
import { GlanceFooterBridge } from "./footer-bridge.js";
import { GitRefresher } from "./git.js";
import { showGlancePane } from "./pane.js";
import {
	clearContextUsage,
	computeUsageTotals,
	createInitialState,
	refreshContextUsage,
	refreshModel,
	refreshWorkspace,
	setGitSnapshot,
	setPlanModeSnapshot,
	setTitleState,
	setUsageTotals,
	type PlanModeSnapshot,
} from "./state.js";
import { resolveTitleModelSpec, titleModelKey } from "./title-model.js";
import { fallbackTitleFromPrompt, sanitizeGeneratedTitle, shouldGenerateTitle, shouldSetFallbackTitle, TITLE_CUSTOM_TYPE } from "./title.js";
import { loadStoredTitle, saveStoredTitle, type StoredTitle } from "./title-store.js";
import type { GlanceConfig, GlanceState } from "./types.js";

type PermissionGateStateResponse = {
	available?: boolean;
	enabled?: boolean;
	reason?: string;
};

type PermissionGateSetResponse = {
	accepted?: boolean;
	enabled?: boolean;
	reason?: string;
};

type SandboxStateResponse = {
	available?: boolean;
	enabled?: boolean;
	initialized?: boolean;
	configured?: boolean;
	noSandbox?: boolean;
	supported?: boolean;
	reason?: string;
};

type SandboxSetResponse = {
	accepted?: boolean;
	enabled?: boolean;
	initialized?: boolean;
	reason?: string;
};

export default function piGlance(pi: ExtensionAPI): void {
	let config: GlanceConfig | undefined;
	let state: GlanceState | undefined;
	let footerBridge: GlanceFooterBridge | undefined;
	let gitRefresher: GitRefresher | undefined;
	let requestRender: (() => void) | undefined;
	let pendingPlanModeState: PlanModeSnapshot | undefined;
	let titleAbort: AbortController | undefined;
	let titleGenerationId = 0;

	async function ensureConfig(): Promise<GlanceConfig> {
		config ??= await loadConfig();
		return config;
	}

	function getConfig(): GlanceConfig {
		if (!config) throw new Error("pi-glance config not loaded");
		return config;
	}

	function ensureState(ctx: ExtensionContext): GlanceState {
		if (!state) {
			state = createInitialState(ctx, getConfig(), pi.getThinkingLevel());
			if (pendingPlanModeState) setPlanModeSnapshot(state, pendingPlanModeState);
		}
		return state;
	}

	function renderNow(): void {
		footerBridge?.invalidate();
		requestRender?.();
	}

	function ensureGitRefresher(): GitRefresher {
		gitRefresher ??= new GitRefresher(
			() => getConfig().git,
			() => state?.workspace.path,
			(cwd, snapshot) => {
				if (state && setGitSnapshot(state, cwd, snapshot)) renderNow();
			},
		);
		return gitRefresher;
	}

	function scheduleGitRefresh(immediate = false): void {
		gitRefresher?.schedule(immediate);
	}

	function parsePlanModeState(data: unknown): PlanModeSnapshot | undefined {
		if (!data || typeof data !== "object") return undefined;
		const record = data as Record<string, unknown>;
		if (typeof record.enabled !== "boolean" || typeof record.executing !== "boolean") return undefined;
		return {
			enabled: record.enabled,
			executing: record.executing,
			completed: typeof record.completed === "number" ? record.completed : 0,
			total: typeof record.total === "number" ? record.total : 0,
		};
	}

	function applyPlanModeState(data: unknown): void {
		const snapshot = parsePlanModeState(data);
		if (!snapshot) return;
		pendingPlanModeState = snapshot;
		if (state && setPlanModeSnapshot(state, snapshot)) renderNow();
	}

	async function emitWithResponses<T>(channel: string, payload: Record<string, unknown> = {}): Promise<T[]> {
		const responses: Promise<T>[] = [];
		pi.events.emit(channel, {
			...payload,
			respond(response: T | Promise<T>) {
				responses.push(Promise.resolve(response));
			},
		});
		const settled = await Promise.allSettled(responses);
		return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
	}

	function lastResponse<T>(responses: T[]): T | undefined {
		return responses.length > 0 ? responses[responses.length - 1] : undefined;
	}

	async function configWithLiveSecurityState(ctx: ExtensionContext, base: GlanceConfig): Promise<GlanceConfig> {
		const draft = cloneConfig(base);
		const [permissionGateResponses, sandboxResponses] = await Promise.all([
			emitWithResponses<PermissionGateStateResponse>("permission-gate:request-state"),
			emitWithResponses<SandboxStateResponse>("pi-sandbox:request-state", { cwd: ctx.cwd }),
		]);
		const permissionGateState = lastResponse(permissionGateResponses);
		const sandboxState = lastResponse(sandboxResponses);
		if (typeof permissionGateState?.enabled === "boolean") {
			draft.permissionGate.enabled = permissionGateState.enabled;
		}
		if (typeof sandboxState?.enabled === "boolean") {
			draft.sandbox.enabled = sandboxState.enabled;
		}
		return draft;
	}

	async function setPermissionGateEnabled(enabled: boolean): Promise<PermissionGateSetResponse | undefined> {
		return lastResponse(await emitWithResponses<PermissionGateSetResponse>("permission-gate:set-enabled", { enabled }));
	}

	async function setSandboxEnabled(enabled: boolean, ctx: ExtensionContext): Promise<SandboxSetResponse | undefined> {
		return lastResponse(await emitWithResponses<SandboxSetResponse>("pi-sandbox:set-enabled", { enabled, cwd: ctx.cwd, ctx }));
	}

	type TitleEntryData = StoredTitle;

	function textFromContent(content: unknown): string {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content
			.filter((part): part is { type: "text"; text: string } => {
				return Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string");
			})
			.map((part) => part.text)
			.join("\n");
	}

	function titleStoreKey(ctx: ExtensionContext): string {
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (sessionFile) return `session:${sessionFile}`;
		return `cwd:${ctx.sessionManager.getCwd() || ctx.cwd}`;
	}

	function findLegacyPersistedTitle(ctx: ExtensionContext): StoredTitle | undefined {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry?.type !== "custom" || entry.customType !== TITLE_CUSTOM_TYPE) continue;
			const data = entry.data as TitleEntryData | undefined;
			if (typeof data?.text === "string" && data.text.trim()) {
				return {
					text: data.text.trim(),
					source: data.source === "fallback" || data.source === "llm" ? data.source : undefined,
					prompt: typeof data.prompt === "string" ? data.prompt : undefined,
					model: typeof data.model === "string" ? data.model : undefined,
				};
			}
		}
		return undefined;
	}

	function findFirstUserPrompt(ctx: ExtensionContext): string | undefined {
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "user") continue;
			const text = textFromContent(entry.message.content).trim();
			if (text) return text;
		}
		return undefined;
	}

	function normalizePersistedTitle(title: StoredTitle): StoredTitle {
		const shouldRebuildFallback = title.source === "fallback" || (!title.source && !title.model);
		const text = shouldRebuildFallback && title.prompt ? fallbackTitleFromPrompt(title.prompt) : sanitizeGeneratedTitle(title.text, title.prompt ?? "New chat");
		return { ...title, text };
	}

	function persistTitle(ctx: ExtensionContext, text: string, source: "fallback" | "llm", prompt: string, model?: Model<Api>, attemptedModel?: string): void {
		if (!state) return;
		const modelKey = model ? titleModelKey(model) : attemptedModel;
		if (setTitleState(state, { text, generating: false, source, prompt, model: modelKey })) renderNow();
		void saveStoredTitle(titleStoreKey(ctx), {
			text,
			source,
			prompt,
			model: modelKey,
		}).catch(() => {});
	}

	async function restoreTitle(ctx: ExtensionContext, config: GlanceConfig): Promise<void> {
		if (!state) return;
		const stored = await loadStoredTitle(titleStoreKey(ctx));
		if (stored) {
			const title = normalizePersistedTitle(stored);
			setTitleState(state, { text: title.text, generating: false, source: title.source, prompt: title.prompt, model: title.model });
			if (title.text !== stored.text) void saveStoredTitle(titleStoreKey(ctx), title).catch(() => {});
			const prompt = title.prompt ?? findFirstUserPrompt(ctx);
			if (prompt) maybeStartTitleGeneration(prompt, ctx);
			return;
		}

		const legacy = findLegacyPersistedTitle(ctx);
		if (legacy) {
			const title = normalizePersistedTitle(legacy);
			setTitleState(state, { text: title.text, generating: false, source: title.source, prompt: title.prompt, model: title.model });
			void saveStoredTitle(titleStoreKey(ctx), title).catch(() => {});
			const prompt = title.prompt ?? findFirstUserPrompt(ctx);
			if (prompt) maybeStartTitleGeneration(prompt, ctx);
			return;
		}

		if (!config.title.enabled) return;
		const firstPrompt = findFirstUserPrompt(ctx);
		if (!firstPrompt) return;
		maybeStartTitleGeneration(firstPrompt, ctx);
	}

	function cancelTitleGeneration(): void {
		titleGenerationId++;
		titleAbort?.abort();
		titleAbort = undefined;
		if (state?.title.generating && setTitleState(state, { generating: false })) renderNow();
	}

	const AUTO_MODEL_CUSTOM_TYPE = "pi-glance:auto-model";

	type AutoModelEntryData = {
		provider?: string;
		modelId?: string;
	};

	function resolveTitleModel(ctx: ExtensionContext, spec: string): Model<Api> | undefined {
		return resolveTitleModelSpec(ctx.modelRegistry, ctx.model, spec);
	}

	function findLastAutoModelEntry(ctx: ExtensionContext): AutoModelEntryData | undefined {
		for (let i = ctx.sessionManager.getBranch().length - 1; i >= 0; i--) {
			const entry = ctx.sessionManager.getBranch()[i];
			if (entry?.type !== "custom" || entry.customType !== AUTO_MODEL_CUSTOM_TYPE) continue;
			const data = entry.data as AutoModelEntryData | undefined;
			if (typeof data?.provider === "string" && typeof data?.modelId === "string" && data.provider && data.modelId) return data;
		}
		return undefined;
	}

	async function applyWorkspaceAutoModel(ctx: ExtensionContext): Promise<void> {
		const workspace = ctx.sessionManager.getCwd() || ctx.cwd;
		const modelSpec = getWorkspaceAutoModelSpec(getConfig().autoModel.workspaceModels, workspace);
		if (!modelSpec) {
			const lastAuto = findLastAutoModelEntry(ctx);
			const defaultModel = await loadGlobalDefaultModelReference();
			if (!lastAuto || !defaultModel || !ctx.model) return;
			if (ctx.model.provider !== lastAuto.provider || ctx.model.id !== lastAuto.modelId) return;
			if (ctx.model.provider === defaultModel.provider && ctx.model.id === defaultModel.modelId) return;
			const restored = resolveTitleModel(ctx, `${defaultModel.provider}/${defaultModel.modelId}`);
			if (!restored) return;
			const snapshot = await captureGlobalSettingsSnapshot();
			const switched = await pi.setModel(restored);
			if (!switched) return;
			await restoreGlobalSettingsSnapshot(snapshot);
			if (ctx.hasUI) ctx.ui.notify(`Auto model cleared: ${titleModelKey(restored)}`, "info");
			return;
		}

		const model = resolveTitleModel(ctx, modelSpec);
		if (!model) {
			if (ctx.hasUI) ctx.ui.notify(`Auto model could not resolve \"${modelSpec}\".`, "warning");
			return;
		}

		const nextModelKey = titleModelKey(model);
		if (ctx.model && titleModelKey(ctx.model) === nextModelKey) {
			if (ctx.hasUI) ctx.ui.notify(`Auto model: ${nextModelKey}`, "info");
			return;
		}

		const snapshot = await captureGlobalSettingsSnapshot();
		const switched = await pi.setModel(model);
		if (!switched) {
			if (ctx.hasUI) ctx.ui.notify(`Auto model is unavailable: ${modelSpec}`, "warning");
			return;
		}
		pi.appendEntry<AutoModelEntryData>(AUTO_MODEL_CUSTOM_TYPE, { provider: model.provider, modelId: model.id });
		await restoreGlobalSettingsSnapshot(snapshot);
		if (ctx.hasUI) ctx.ui.notify(`Auto model: ${nextModelKey}`, "info");
	}

	async function generateTitle(generationId: number, ctx: ExtensionContext, prompt: string, model: Model<Api>, fallback: string, signal: AbortSignal): Promise<void> {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || (!auth.apiKey && !auth.headers)) throw new Error(auth.ok ? `No API key for ${model.provider}/${model.id}` : auth.error);

			const controller = new AbortController();
			const abort = () => controller.abort();
			if (signal.aborted) abort();
			signal.addEventListener("abort", abort, { once: true });
			timeout = setTimeout(abort, 8000);

			const userMessage: UserMessage = {
				role: "user",
				content: [{ type: "text", text: prompt.slice(0, 4000) }],
				timestamp: Date.now(),
			};

			const response = await completeSimple(
				model,
				{
					systemPrompt: [
						"Generate a concise title for the user's first request.",
						"Rules: output only the title; use the same language as the user; one line; no Markdown, quotes, or trailing punctuation; at most 64 visible characters.",
					].join("\n"),
					messages: [userMessage],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					signal: controller.signal,
					maxTokens: 64,
					timeoutMs: 8000,
				},
			);

			const text = response.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n");
			if (generationId !== titleGenerationId || signal.aborted) return;
			persistTitle(ctx, sanitizeGeneratedTitle(text, fallback), "llm", prompt, model);
		} catch {
			if (generationId !== titleGenerationId || signal.aborted) return;
			persistTitle(ctx, fallback, "fallback", prompt, model);
		} finally {
			if (timeout) clearTimeout(timeout);
			if (generationId === titleGenerationId) titleAbort = undefined;
		}
	}

	function maybeStartTitleGeneration(prompt: string, ctx: ExtensionContext): void {
		if (!state) return;
		const activeConfig = getConfig();
		if (!activeConfig.title.enabled || state.title.generating) return;

		const titlePrompt = prompt.trim();
		const fallback = fallbackTitleFromPrompt(titlePrompt);
		if (!titlePrompt) {
			if (shouldSetFallbackTitle(state.title)) {
				persistTitle(ctx, fallback, "fallback", titlePrompt);
			}
			return;
		}

		const modelSpec = activeConfig.title.model.trim();
		if (!modelSpec) {
			if (shouldSetFallbackTitle(state.title)) {
				persistTitle(ctx, fallback, "fallback", titlePrompt);
			}
			return;
		}

		const model = resolveTitleModel(ctx, modelSpec);
		const targetModel = model ? titleModelKey(model) : modelSpec;
		if (!shouldGenerateTitle(state.title, targetModel)) return;
		if (!model) {
			persistTitle(ctx, fallback, "fallback", titlePrompt, undefined, modelSpec);
			return;
		}

		titleAbort?.abort();
		titleAbort = new AbortController();
		const generationId = ++titleGenerationId;
		if (setTitleState(state, { text: null, generating: true, source: null, prompt: titlePrompt, model: titleModelKey(model) })) renderNow();
		void generateTitle(generationId, ctx, titlePrompt, model, fallback, titleAbort.signal);
	}

	function refreshReliableSnapshot(ctx: ExtensionContext, options: { model?: boolean; git?: boolean } = {}): void {
		if (!state) return;
		const workspaceChanged = refreshWorkspace(state, ctx);
		if (options.model) refreshModel(state, ctx, getConfig(), pi.getThinkingLevel());
		setUsageTotals(state, computeUsageTotals(ctx));
		refreshContextUsage(state, ctx);
		if (options.git || workspaceChanged) scheduleGitRefresh(options.git || workspaceChanged);
	}

	function refreshThinkingLevel(ctx: ExtensionContext): void {
		if (!state) return;
		refreshModel(state, ctx, getConfig(), pi.getThinkingLevel());
	}

	function clearBridge(): void {
		footerBridge?.dispose();
		footerBridge = undefined;
	}

	function clearGitRefresher(): void {
		gitRefresher?.dispose();
		gitRefresher = undefined;
	}

	function clearUI(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		clearBridge();
		clearGitRefresher();
		ctx.ui.setEditorComponent(undefined);
		ctx.ui.setFooter(undefined);
		requestRender = undefined;
	}

	async function applyConfiguredSecurityState(ctx: ExtensionContext): Promise<void> {
		const activeConfig = getConfig();
		await Promise.all([
			setPermissionGateEnabled(activeConfig.permissionGate.enabled),
			setSandboxEnabled(activeConfig.sandbox.enabled, ctx),
		]);
	}

	async function applySecurityChanges(ctx: ExtensionContext, previous: GlanceConfig, next: GlanceConfig): Promise<GlanceConfig> {
		const applied = cloneConfig(next);

		if (previous.permissionGate.enabled !== next.permissionGate.enabled) {
			const response = await setPermissionGateEnabled(next.permissionGate.enabled);
			if (response?.accepted === false) {
				applied.permissionGate.enabled = previous.permissionGate.enabled;
				ctx.ui.notify(response.reason ?? "Permission Gate could not be updated", "warning");
			} else if (!response) {
				ctx.ui.notify("Permission Gate extension did not respond; saved setting will apply when it is available.", "warning");
			}
		}

		if (previous.sandbox.enabled !== next.sandbox.enabled) {
			const response = await setSandboxEnabled(next.sandbox.enabled, ctx);
			if (response?.accepted === false) {
				applied.sandbox.enabled = previous.sandbox.enabled;
				const type: "warning" | "error" = response.reason?.startsWith("Sandbox initialization failed") ? "error" : "warning";
				ctx.ui.notify(response.reason ?? "Sandbox could not be updated", type);
			} else if (!response) {
				ctx.ui.notify("pi-sandbox did not respond; saved setting will apply when it is available.", "warning");
			} else if (typeof response.enabled === "boolean") {
				applied.sandbox.enabled = response.enabled;
			}
		}

		return applied;
	}

	function installInputSurface(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ensureState(ctx);
		const activeConfig = getConfig();
		if (!activeConfig.enabled) {
			clearUI(ctx);
			return;
		}

		ensureGitRefresher().schedule(true);
		clearBridge();
		ctx.ui.setFooter((tui, _theme, footerData) => {
			requestRender = () => tui.requestRender();
			footerBridge = new GlanceFooterBridge(() => state ?? ensureState(ctx), footerData);
			return footerBridge;
		});

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			requestRender = () => tui.requestRender();
			return new GlanceEditor(
				tui,
				theme,
				keybindings,
				() => state ?? ensureState(ctx),
				() => getConfig(),
				() => {
					refreshThinkingLevel(ctx);
					renderNow();
				},
			);
		});
	}

	pi.events.on("plan-mode:state", applyPlanModeState);

	pi.registerCommand("glance", {
		description: "Open pi-glance configuration pane",
		handler: async (_args, ctx) => {
			const current = await ensureConfig();
			ensureState(ctx);
			const paneConfig = await configWithLiveSecurityState(ctx, current);
			const result = await showGlancePane(paneConfig, ctx, state);
			if (result.action === "cancel") {
				ctx.ui.notify("pi-glance configuration cancelled", "info");
				return;
			}

			config = await applySecurityChanges(ctx, current, result.config);
			await saveConfig(config);
			if (!config.title.enabled) {
				cancelTitleGeneration();
			} else if (state) {
				const prompt = state.title.prompt ?? findFirstUserPrompt(ctx);
				if (prompt) maybeStartTitleGeneration(prompt, ctx);
				else if (!state.title.text && !state.title.generating) await restoreTitle(ctx, config);
			}
			if (state) {
				refreshReliableSnapshot(ctx, { model: true, git: true });
			}
			installInputSurface(ctx);
			renderNow();
			ctx.ui.notify("pi-glance configuration saved", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		cancelTitleGeneration();
		config = await loadConfig();
		state = createInitialState(ctx, config, pi.getThinkingLevel());
		if (pendingPlanModeState) setPlanModeSnapshot(state, pendingPlanModeState);
		await applyWorkspaceAutoModel(ctx);
		refreshModel(state, ctx, getConfig(), pi.getThinkingLevel());
		await restoreTitle(ctx, config);
		installInputSurface(ctx);
		await applyConfiguredSecurityState(ctx);
		pi.events.emit("plan-mode:request-state", { from: "pi-glance" });
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		cancelTitleGeneration();
		clearUI(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		maybeStartTitleGeneration(event.prompt, ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx, { model: true, git: true });
		renderNow();
	});

	pi.on("thinking_level_select", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshThinkingLevel(ctx);
		renderNow();
	});

	pi.on("turn_start", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx, { model: true });
		renderNow();
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx, { git: true });
		renderNow();
	});

	pi.on("session_tree", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx, { model: true, git: true });
		renderNow();
	});

	pi.on("session_compact", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshWorkspace(state!, ctx);
		refreshModel(state!, ctx, getConfig(), pi.getThinkingLevel());
		setUsageTotals(state!, computeUsageTotals(ctx));
		clearContextUsage(state!, ctx);
		scheduleGitRefresh(true);
		renderNow();
	});

	pi.on("message_end", async (event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		if (event.message.role === "assistant") {
			refreshReliableSnapshot(ctx);
			renderNow();
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx);
		renderNow();
	});

	pi.on("agent_end", async (_event, ctx) => {
		await ensureConfig();
		ensureState(ctx);
		refreshReliableSnapshot(ctx);
		renderNow();
	});
}
