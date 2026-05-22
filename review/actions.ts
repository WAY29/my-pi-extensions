import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	currentBranchName,
	listLocalBranches,
	recentCommits,
} from "./git.js";
import { loadReviewResumeState } from "./state.js";
import { showSelectList } from "./ui.js";
import type { ReviewTarget } from "./types.js";

function parseReviewPaths(value: string): string[] {
	return value
		.split(/\s+/)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

export async function chooseReviewTarget(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): Promise<ReviewTarget | null> {
	if (!ctx.hasUI) {
		return { type: "uncommittedChanges" };
	}

	const resumable = loadReviewResumeState(ctx.sessionManager);
	const preset = await showSelectList(ctx, "Select an audit mode", [
		...(resumable
			? [
				{
					value: "resume",
					label: "Continue interrupted audit",
					description: resumable.hint,
				},
			]
			: []),
		{
			value: "base",
			label: "Audit branch diff",
			description: "compare HEAD against a selected base branch",
		},
		{
			value: "uncommitted",
			label: "Audit current changes",
			description: "staged + unstaged + untracked",
		},
		{
			value: "commit",
			label: "Audit one commit",
		},
		{
			value: "folder",
			label: "Audit folders/files",
			description: "read code directly, not a diff",
		},
		{
			value: "custom",
			label: "Custom audit instructions",
			description: "describe exactly what to audit",
		},
	]);

	if (!preset) return null;
	if (preset === "resume") return resumable?.target ?? null;
	if (preset === "uncommitted") return { type: "uncommittedChanges" };
	if (preset === "custom") {
		const custom = await ctx.ui.editor("Custom audit instructions", "");
		if (!custom?.trim()) return null;
		return { type: "custom", instructions: custom.trim() };
	}
	if (preset === "folder") {
		const input = await ctx.ui.editor(
			"Files/folders to audit (space-separated or one per line)",
			".",
		);
		if (!input?.trim()) return null;
		const paths = parseReviewPaths(input);
		if (paths.length === 0) return null;
		return { type: "folder", paths };
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
		const choice = await showSelectList(ctx, "Select a base branch to compare against", branchItems, "Type to search branches");
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
		const choice = await showSelectList(ctx, "Select a commit", commitItems, "Type to search commits");
		if (!choice) return null;
		const selected = commits.find((commit) => commit.sha === choice);
		return { type: "commit", sha: choice, title: selected?.subject };
	}

	return null;
}

