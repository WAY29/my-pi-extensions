import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildResolvePrompt } from "./format.js";
import {
	currentBranchName,
	listLocalBranches,
	recentCommits,
} from "./git.js";
import { loadReviewResumeState } from "./state.js";
import { showFindingPicker, showSelectList } from "./ui.js";
import type { ReviewRunnerResult, ReviewTarget } from "./types.js";

export async function chooseReviewTarget(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): Promise<ReviewTarget | null> {
	if (!ctx.hasUI) {
		return { type: "uncommittedChanges" };
	}

	const resumable = loadReviewResumeState(ctx.sessionManager);
	const preset = await showSelectList(ctx, "Select a review preset", [
		...(resumable
			? [
				{
					value: "resume",
					label: `Continue interrupted review`,
					description: resumable.hint,
				},
			]
			: []),
		{
			value: "base",
			label: "Review against a base branch",
			description: "(PR Style)",
		},
		{
			value: "uncommitted",
			label: "Review uncommitted changes",
		},
		{
			value: "commit",
			label: "Review a commit",
		},
		{
			value: "custom",
			label: "Custom review instructions",
		},
	]);

	if (!preset) return null;
	if (preset === "resume") return resumable?.target ?? null;
	if (preset === "uncommitted") return { type: "uncommittedChanges" };
	if (preset === "custom") {
		const custom = await ctx.ui.editor("Custom review instructions", "");
		if (!custom?.trim()) return null;
		return { type: "custom", instructions: custom.trim() };
	}

	if (preset === "base") {
		const branches = await listLocalBranches(pi, ctx.cwd);
		if (branches.length === 0) {
			ctx.ui.notify("No local git branches found.", "warning");
			return null;
		}
		const current = (await currentBranchName(pi, ctx.cwd)) ?? "(detached HEAD)";
		const branchItems = branches.map((branch) => ({
			value: branch,
			label: `${current} -> ${branch}`,
			description: branch,
		}));
		const choice = await showSelectList(ctx, "Select a base branch", branchItems, "Type to search branches");
		return choice ? { type: "baseBranch", branch: choice } : null;
	}

	if (preset === "commit") {
		const commits = await recentCommits(pi, ctx.cwd, 100);
		if (commits.length === 0) {
			ctx.ui.notify("No commits found.", "warning");
			return null;
		}
		const commitItems = commits.map((commit) => ({
			value: commit.sha,
			label: commit.subject,
			description: commit.sha.slice(0, 12),
		}));
		const choice = await showSelectList(ctx, "Select a commit to review", commitItems, "Type to search commits");
		if (!choice) return null;
		const selected = commits.find((commit) => commit.sha === choice);
		return { type: "commit", sha: choice, title: selected?.subject };
	}

	return null;
}

export async function handlePostReviewActions(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	result: ReviewRunnerResult,
): Promise<void> {
	const reviewOutput = result.reviewOutput;
	if (!ctx.hasUI) return;

	const options = reviewOutput && reviewOutput.findings.length > 0
		? ["Resolve all findings", "Resolve selected findings", "Open full review JSON in editor", "Do nothing"]
		: ["Open full review JSON in editor", "Do nothing"];
	const choice = await ctx.ui.select("Review complete - what next?", options);
	if (!choice || choice === "Do nothing") return;

	if (choice === "Open full review JSON in editor") {
		ctx.ui.setEditorText(
			JSON.stringify(
				{
					hint: result.hint,
					target: result.target,
					rawOutput: result.rawOutput,
					reviewOutput: result.reviewOutput,
					liveEntries: result.liveEntries,
				},
				null,
				2,
			),
		);
		ctx.ui.notify("Review JSON loaded into editor.", "info");
		return;
	}

	if (!reviewOutput || reviewOutput.findings.length === 0) return;

	if (choice === "Resolve all findings") {
		pi.sendUserMessage(buildResolvePrompt(reviewOutput.findings, result.hint));
		return;
	}

	if (choice === "Resolve selected findings") {
		const selected = await showFindingPicker(ctx, reviewOutput.findings);
		if (!selected || selected.length === 0) {
			ctx.ui.notify("No findings selected.", "warning");
			return;
		}
		const selectedFindings = selected.map((index) => reviewOutput.findings[index]).filter(Boolean);
		pi.sendUserMessage(buildResolvePrompt(selectedFindings, result.hint));
	}
}
