import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text } from "@earendil-works/pi-tui";
import { handlePostReviewActions, chooseReviewTarget } from "./actions.js";
import { loadReviewResumeState } from "./state.js";
import { REVIEW_RESULT_MESSAGE, REVIEW_START_MESSAGE } from "./constants.js";
import { buildReviewSummaryMarkdown } from "./format.js";
import { resolveReviewRequest } from "./git.js";
import { runNestedReview } from "./runner.js";
import type { ReviewRunnerResult, ReviewTarget } from "./types.js";
import { sameReviewTarget } from "./utils.js";

export default function reviewExtension(pi: ExtensionAPI): void {
	let reviewRunning = false;
	let currentHint: string | null = null;

	function updateStatus(ctx: ExtensionContext | ExtensionCommandContext): void {
		if (!ctx.hasUI) return;
		if (reviewRunning && currentHint) {
			ctx.ui.setStatus("review", ctx.ui.theme.fg("accent", `review:${currentHint}`));
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
		container.addChild(new Markdown(message.content, 1, 0, getMarkdownTheme()));
		if (expanded && details) {
			container.addChild(new Text(theme.fg("dim", ""), 0, 0));
			container.addChild(new Text(theme.fg("dim", "Raw review JSON:"), 1, 0));
			container.addChild(new Text(theme.fg("dim", JSON.stringify(details.reviewOutput, null, 2)), 1, 0));
			if (details.liveEntries.length > 0) {
				container.addChild(new Text(theme.fg("dim", ""), 0, 0));
				container.addChild(new Text(theme.fg("dim", "Live review trace:"), 1, 0));
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
		description: "Run an isolated code review like Codex /review",
		handler: async (args, ctx) => {
			if (reviewRunning) {
				ctx.ui.notify("A review is already running.", "warning");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("No model selected for /review.", "error");
				return;
			}

			const resumable = !args.trim() ? loadReviewResumeState(ctx.sessionManager) : null;
			const target = args.trim()
				? ({ type: "custom", instructions: args.trim() } satisfies ReviewTarget)
				: await chooseReviewTarget(pi, ctx);
			if (!target) return;

			reviewRunning = true;
			const previousHint = currentHint;

			try {
				const resolved = await resolveReviewRequest(pi, ctx.cwd, target);
				currentHint = resolved.userFacingHint;
				updateStatus(ctx);
				pi.sendMessage({
					customType: REVIEW_START_MESSAGE,
					content: `Code review started: ${resolved.userFacingHint}`,
					display: true,
					details: { hint: resolved.userFacingHint, target: resolved.target },
				});

				const result = await runNestedReview(
					pi as any,
					ctx,
					ctx.model,
					resolved,
					resumable && sameReviewTarget(resumable.target, target) ? resumable : null,
				);
				pi.sendMessage({
					customType: REVIEW_RESULT_MESSAGE,
					content: buildReviewSummaryMarkdown(result.hint, result.reviewOutput, Boolean(result.interrupted), result.error),
					display: true,
					details: result,
				});

				if (!result.interrupted && !result.error) {
					await handlePostReviewActions(pi, ctx, result);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				pi.sendMessage({
					customType: REVIEW_RESULT_MESSAGE,
					content: buildReviewSummaryMarkdown(currentHint ?? "review", null, false, message),
					display: true,
					details: {
						hint: currentHint ?? "review",
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
