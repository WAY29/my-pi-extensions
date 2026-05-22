import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text } from "@earendil-works/pi-tui";
import { chooseReviewTarget } from "./actions.js";
import { loadReviewResumeState } from "./state.js";
import { REVIEW_RESULT_MESSAGE, REVIEW_START_MESSAGE } from "./constants.js";
import { buildReviewSummaryMarkdownLocalized } from "./i18n.js";
import { resolveReviewRequest } from "./git.js";
import { reviewPreflight } from "./preflight.js";
import { runNestedReview } from "./runner.js";
import type { ReviewRunnerResult, ReviewTarget } from "./types.js";
import { detectConversationLanguage, sameReviewTarget } from "./utils.js";

export default function reviewExtension(pi: ExtensionAPI): void {
	let reviewRunning = false;
	let currentHint: string | null = null;

	function updateStatus(ctx: ExtensionContext | ExtensionCommandContext): void {
		if (!ctx.hasUI) return;
		if (reviewRunning && currentHint) {
			ctx.ui.setStatus("review", ctx.ui.theme.fg("accent", `audit:${currentHint}`));
		} else {
			ctx.ui.setStatus("review", undefined);
		}
	}

	pi.registerMessageRenderer(REVIEW_START_MESSAGE, (message, _options, theme) => {
		const box = new Container();
		box.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		box.addChild(new Text(theme.fg("accent", `>> ${message.content} <<`), 1, 0));
		box.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		return box;
	});


	pi.registerMessageRenderer(REVIEW_RESULT_MESSAGE, (message, { expanded }, theme) => {
		const details = message.details as ReviewRunnerResult | undefined;
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("border", s)));
		container.addChild(new Markdown(typeof message.content === "string" ? message.content : "", 1, 0, getMarkdownTheme()));
		if (expanded && details) {
			container.addChild(new Text(theme.fg("dim", ""), 0, 0));
			container.addChild(new Text(theme.fg("dim", "Raw audit JSON:"), 1, 0));
			container.addChild(new Text(theme.fg("dim", JSON.stringify(details.reviewOutput, null, 2)), 1, 0));
			if (details.liveEntries.length > 0) {
				container.addChild(new Text(theme.fg("dim", ""), 0, 0));
				container.addChild(new Text(theme.fg("dim", "Live audit trace:"), 1, 0));
				container.addChild(new Text(theme.fg("dim", JSON.stringify(details.liveEntries, null, 2)), 1, 0));
			}
		}
		container.addChild(new DynamicBorder((s: string) => theme.fg("border", s)));
		return container;
	});

	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.registerCommand("review", {
		description: "Run an isolated security-focused code audit",
		handler: async (args, ctx) => {
			if (reviewRunning) {
				ctx.ui.notify("An audit is already running.", "warning");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("No model selected for /review.", "error");
				return;
			}

			const trimmedArgs = args.trim();
			const resumable = !trimmedArgs ? loadReviewResumeState(ctx.sessionManager) : null;
			const target = trimmedArgs
				? ({ type: "custom", instructions: trimmedArgs } satisfies ReviewTarget)
				: await chooseReviewTarget(pi, ctx);
			if (!target) return;

			reviewRunning = true;
			const previousHint = currentHint;

			try {
				const reviewLanguage = detectConversationLanguage(ctx.sessionManager, trimmedArgs || JSON.stringify(target));
				const preflight = await reviewPreflight(pi, ctx.cwd, target);
				if (!preflight.ok) {
					ctx.ui.notify(preflight.reason ?? "Unable to start the audit.", "warning");
					return;
				}
				const resolved = await resolveReviewRequest(pi, preflight.reviewCwd, target);
				currentHint = resolved.userFacingHint;
				updateStatus(ctx);
				pi.sendMessage({
					customType: REVIEW_START_MESSAGE,
					content: `Audit in progress: ${resolved.userFacingHint}`,
					display: true,
					details: { hint: resolved.userFacingHint, target: resolved.target },
				});

				const result = await runNestedReview(
					pi as any,
					{ ...ctx, cwd: preflight.reviewCwd },
					ctx.model,
					resolved,
					reviewLanguage,
					resumable && sameReviewTarget(resumable.target, target) ? resumable : null,
				);
				pi.sendMessage({
					customType: REVIEW_RESULT_MESSAGE,
					content: buildReviewSummaryMarkdownLocalized(result.hint, result.reviewOutput, Boolean(result.interrupted), reviewLanguage, result.error),
					display: true,
					details: result,
				});

			} catch (error) {
				const reviewLanguage = detectConversationLanguage(ctx.sessionManager, trimmedArgs || JSON.stringify(target));
				const message = error instanceof Error ? error.message : String(error);
				pi.sendMessage({
					customType: REVIEW_RESULT_MESSAGE,
					content: buildReviewSummaryMarkdownLocalized(currentHint ?? "audit", null, false, reviewLanguage, message),
					display: true,
					details: {
						hint: currentHint ?? "audit",
						target,
						reviewOutput: null,
						rawOutput: "",
						error: message,
						liveEntries: [],
					} satisfies ReviewRunnerResult,
				});
			} finally {
				reviewRunning = false;
				currentHint = previousHint ?? null;
				updateStatus(ctx);
			}
		},
	});
}
