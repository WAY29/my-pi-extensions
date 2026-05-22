import { mkdirSync } from "node:fs";
import type { Model } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createExtensionRuntime,
	SettingsManager,
	SessionManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import {
	CHANGE_AUDIT_SYSTEM_PROMPT,
	CUSTOM_AUDIT_SYSTEM_PROMPT,
	localizeAuditSystemPrompt,
	REVIEW_TOOLS,
	SNAPSHOT_AUDIT_SYSTEM_PROMPT,
} from "./constants.js";
import { findLastAssistantText, parseReviewOutput } from "./format.js";
import type { ReviewLanguage } from "./i18n.js";
import { applyReviewLiveEvent, createReviewEventFormatter, createReviewLiveState } from "./live.js";
import { REVIEW_CONTINUE_PROMPT, getReviewSessionDir, persistReviewState, type ReviewResumeState } from "./state.js";
import { showReviewLivePanel } from "./ui.js";
import type { ResolvedReviewRequest, ReviewRunnerResult } from "./types.js";

function customResourceLoader(reviewPrompt: string): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => reviewPrompt,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

function selectSystemPrompt(resolved: ResolvedReviewRequest, language: ReviewLanguage): string {
	const basePrompt = (() => {
		switch (resolved.target.type) {
			case "custom":
				return CUSTOM_AUDIT_SYSTEM_PROMPT;
			case "folder":
				return SNAPSHOT_AUDIT_SYSTEM_PROMPT;
			default:
				return CHANGE_AUDIT_SYSTEM_PROMPT;
		}
	})();
	return localizeAuditSystemPrompt(basePrompt, language);
}

export async function runNestedReview(
	pi: Pick<ExtensionAPI, "appendEntry">,
	ctx: ExtensionContext | ExtensionCommandContext,
	model: Model<any>,
	resolved: ResolvedReviewRequest,
	language: ReviewLanguage,
	resumeState?: ReviewResumeState | null,
): Promise<ReviewRunnerResult> {
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: true, maxRetries: 1 },
	});
	const sessionDir = getReviewSessionDir(ctx.sessionManager);
	mkdirSync(sessionDir, { recursive: true });
	const reviewSessionManager = resumeState?.reviewSessionFile
		? SessionManager.open(resumeState.reviewSessionFile, sessionDir, ctx.cwd)
		: SessionManager.create(ctx.cwd, sessionDir);
	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		model,
		modelRegistry: ctx.modelRegistry,
		resourceLoader: customResourceLoader(selectSystemPrompt(resolved, language)),
		tools: REVIEW_TOOLS,
		sessionManager: reviewSessionManager,
		settingsManager,
	});

	const state = createReviewLiveState();
	const formatter = createReviewEventFormatter();
	let interrupted = false;
	let rawOutput = "";
	const reviewSessionFile = reviewSessionManager.getSessionFile();
	if (!reviewSessionFile) throw new Error("Failed to create audit session file.");

	const persist = (status: ReviewResumeState["status"]) => {
		persistReviewState(pi as any, {
			status,
			hint: resolved.userFacingHint,
			target: resolved.target,
			reviewSessionFile,
			startedAt: resumeState?.startedAt ?? Date.now(),
			updatedAt: Date.now(),
		});
	};

	persist(resumeState ? "interrupted" : "running");

	let onLiveEntry: ((entry: import("./types.js").ReviewLiveEntry) => void) | null = null;
	let onLiveEvent: ((event: import("@earendil-works/pi-coding-agent").AgentSessionEvent) => void) | null = null;
	const unsubscribe = session.subscribe((event) => {
		const entry = applyReviewLiveEvent(state, formatter, event);
		if (entry) onLiveEntry?.(entry);
		onLiveEvent?.(event);
	});

	const finalize = (error?: string): ReviewRunnerResult => {
		rawOutput = findLastAssistantText(session.messages as unknown[]);
		const messages = session.messages as Array<{ role?: string; stopReason?: string; errorMessage?: string; content?: unknown }>;
		const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
		let inferredError = error
			?? lastAssistant?.errorMessage
			?? (lastAssistant?.stopReason && lastAssistant.stopReason !== "stop" && lastAssistant.stopReason !== "end"
				? `Audit session ended with stopReason=${lastAssistant.stopReason}`
				: undefined)
			?? (rawOutput.trim() ? undefined : "Audit session ended without producing structured JSON output.");
		const reviewOutput = !inferredError && rawOutput.trim() ? parseReviewOutput(rawOutput) : null;
		if (!inferredError && reviewOutput && reviewOutput.findings.length === 0 && !rawOutput.trimStart().startsWith("{")) {
			inferredError = rawOutput.trim() || "Audit session failed before producing structured JSON output.";
		}
		return {
			hint: resolved.userFacingHint,
			target: resolved.target,
			rawOutput,
			reviewOutput,
			interrupted,
			error: interrupted ? undefined : inferredError,
			liveEntries: [...state.entries],
		};
	};

	const prompt = resumeState ? REVIEW_CONTINUE_PROMPT : resolved.prompt;

	try {
		if (ctx.hasUI) {
			const baseStatus = `Audit: ${resolved.userFacingHint}`;
			return await showReviewLivePanel(
				ctx,
				baseStatus,
				async (api) => {
					api.setStatus(`${baseStatus}: preparing isolated session`);
					onLiveEntry = (_entry) => {};
					onLiveEvent = (event) => {
						if (event.type === "tool_execution_start") {
							const summary = formatter.format(event)?.text ?? event.toolName;
							api.setStatus(`${baseStatus}: ${summary}`);
						} else if (event.type === "tool_execution_end" && event.isError) {
							const summary = (event as any).toolName ? `${event.toolName} failed` : "step failed";
							api.setStatus(`${baseStatus}: ${summary}`);
						} else if (event.type === "auto_retry_start") {
							api.setStatus(`${baseStatus}: retry ${event.attempt}/${event.maxAttempts} - ${event.errorMessage}`);
						} else if (event.type === "agent_end" && event.willRetry) {
							api.setStatus(`${baseStatus}: retry queued`);
						}
						api.pushEvent(event);
					};
					try {
						if (api.abortSignal.aborted) {
							interrupted = true;
							persist("interrupted");
							api.finish(finalize());
							return;
						}
						api.abortSignal.addEventListener(
							"abort",
							() => {
								interrupted = true;
								persist("interrupted");
								void session.abort();
							},
							{ once: true },
						);
						await session.prompt(prompt);
						persist("completed");
						api.finish(finalize());
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						persist(interrupted ? "interrupted" : "completed");
						api.finish(finalize(interrupted ? undefined : message));
					} finally {
						onLiveEntry = null;
						onLiveEvent = null;
					}
				},
			);
		}

		await session.prompt(prompt);
		persist("completed");
		return finalize();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		persist(interrupted ? "interrupted" : "completed");
		return finalize(interrupted ? undefined : message);
	} finally {
		unsubscribe();
		session.dispose();
	}
}
