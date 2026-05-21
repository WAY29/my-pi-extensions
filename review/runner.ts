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
import { REVIEW_PROMPT, REVIEW_TOOLS } from "./constants.js";
import { applyReviewLiveEvent, createReviewEventFormatter, createReviewLiveState } from "./live.js";
import { findLastAssistantText, parseReviewOutput } from "./format.js";
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

export async function runNestedReview(
	pi: Pick<ExtensionAPI, "appendEntry">,
	ctx: ExtensionContext | ExtensionCommandContext,
	model: Model<any>,
	resolved: ResolvedReviewRequest,
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
		resourceLoader: customResourceLoader(REVIEW_PROMPT),
		tools: REVIEW_TOOLS,
		sessionManager: reviewSessionManager,
		settingsManager,
	});

	const state = createReviewLiveState();
	const formatter = createReviewEventFormatter();
	let interrupted = false;
	let rawOutput = "";
	const reviewSessionFile = reviewSessionManager.getSessionFile();
	if (!reviewSessionFile) throw new Error("Failed to create review session file.");

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
				? `Review session ended with stopReason=${lastAssistant.stopReason}`
				: undefined)
			?? (rawOutput.trim() ? undefined : "Review session ended without producing reviewer JSON output.");
		const reviewOutput = !inferredError && rawOutput.trim() ? parseReviewOutput(rawOutput) : null;
		if (!inferredError && reviewOutput && reviewOutput.findings.length === 0 && !rawOutput.trimStart().startsWith("{")) {
			inferredError = rawOutput.trim() || "Review session failed before producing structured JSON output.";
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
			return await showReviewLivePanel(ctx, `${resumeState ? "Resuming" : "Reviewing"} ${resolved.userFacingHint}...`, async (api) => {
				onLiveEntry = (_entry) => {};
				onLiveEvent = (event) => {
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
			});
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
