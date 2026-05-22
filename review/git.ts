import { promises as fs } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	BASE_BRANCH_PROMPT,
	BASE_BRANCH_PROMPT_BACKUP,
	COMMIT_PROMPT,
	COMMIT_PROMPT_WITH_TITLE,
	FOLDER_PROMPT,
	UNCOMMITTED_PROMPT,
} from "./constants.js";
import { summarizeText } from "./utils.js";
import type { CommitEntry, ResolvedReviewRequest, ReviewTarget } from "./types.js";

function replaceTemplate(template: string, replacements: Record<string, string>): string {
	let text = template;
	for (const [key, value] of Object.entries(replacements)) {
		text = text.replaceAll(`{{${key}}}`, value);
	}
	return text;
}

export async function gitExec(
	pi: ExtensionAPI,
	cwd: string,
	args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
	const result = await pi.exec("git", ["-C", cwd, ...args]);
	return {
		ok: result.code === 0,
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
}

export async function listLocalBranches(pi: ExtensionAPI, cwd: string): Promise<string[]> {
	const result = await gitExec(pi, cwd, ["branch", "--format=%(refname:short)"]);
	if (!result.ok || !result.stdout) return [];
	return result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export async function currentBranchName(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const result = await gitExec(pi, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
	return result.ok && result.stdout ? result.stdout : null;
}

export async function recentCommits(pi: ExtensionAPI, cwd: string, limit = 100): Promise<CommitEntry[]> {
	const result = await gitExec(pi, cwd, ["log", "-n", String(limit), "--format=%H%x00%s"]);
	if (!result.ok || !result.stdout) return [];
	return result.stdout
		.split("\n")
		.map((line) => {
			const [sha, subject = ""] = line.split("\u0000");
			return { sha: sha?.trim() ?? "", subject: subject.trim() };
		})
		.filter((entry) => entry.sha);
}

export async function resolveCommitTitle(pi: ExtensionAPI, cwd: string, sha: string): Promise<string | undefined> {
	const result = await gitExec(pi, cwd, ["log", "-1", "--format=%s", sha]);
	return result.ok && result.stdout ? result.stdout : undefined;
}

export async function mergeBaseWithHead(pi: ExtensionAPI, cwd: string, branch: string): Promise<string | null> {
	const upstream = await gitExec(pi, cwd, ["rev-parse", "--verify", `${branch}@{upstream}`]);
	const candidate = upstream.ok && upstream.stdout ? upstream.stdout : branch;
	const mergeBase = await gitExec(pi, cwd, ["merge-base", "HEAD", candidate]);
	return mergeBase.ok && mergeBase.stdout ? mergeBase.stdout : null;
}

export async function loadProjectReviewGuidelines(cwd: string): Promise<string | null> {
	let currentDir = path.resolve(cwd);
	while (true) {
		const piDir = path.join(currentDir, ".pi");
		const guidelinesPath = path.join(currentDir, "REVIEW_GUIDELINES.md");
		const piStats = await fs.stat(piDir).catch(() => null);
		if (piStats?.isDirectory()) {
			const guidelineStats = await fs.stat(guidelinesPath).catch(() => null);
			if (!guidelineStats?.isFile()) return null;
			const content = await fs.readFile(guidelinesPath, "utf8").catch(() => "");
			const trimmed = content.trim();
			return trimmed || null;
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function mergePromptWithProjectGuidelines(prompt: string, projectGuidelines: string | null): string {
	if (!projectGuidelines) return prompt;
	return `${prompt}\n\nProject review guidelines:\n\n${projectGuidelines}`;
}

export async function resolveReviewRequest(
	pi: ExtensionAPI,
	cwd: string,
	target: ReviewTarget,
): Promise<ResolvedReviewRequest> {
	const projectGuidelines = await loadProjectReviewGuidelines(cwd);
	if (target.type === "uncommittedChanges") {
		return {
			target,
			prompt: mergePromptWithProjectGuidelines(UNCOMMITTED_PROMPT, projectGuidelines),
			userFacingHint: "current changes",
		};
	}

	if (target.type === "baseBranch") {
		const mergeBase = await mergeBaseWithHead(pi, cwd, target.branch);
		return {
			target,
			prompt: mergePromptWithProjectGuidelines(
				mergeBase
					? replaceTemplate(BASE_BRANCH_PROMPT, {
						base_branch: target.branch,
						merge_base_sha: mergeBase,
					})
					: replaceTemplate(BASE_BRANCH_PROMPT_BACKUP, { branch: target.branch }),
				projectGuidelines,
			),
			userFacingHint: `changes against '${target.branch}'`,
		};
	}

	if (target.type === "commit") {
		const title = target.title?.trim() || (await resolveCommitTitle(pi, cwd, target.sha)) || undefined;
		const shortSha = target.sha.slice(0, 7);
		return {
			target: { ...target, title },
			prompt: mergePromptWithProjectGuidelines(
				title
					? replaceTemplate(COMMIT_PROMPT_WITH_TITLE, { sha: target.sha, title })
					: replaceTemplate(COMMIT_PROMPT, { sha: target.sha }),
				projectGuidelines,
			),
			userFacingHint: title ? `commit ${shortSha}: ${title}` : `commit ${shortSha}`,
		};
	}

	if (target.type === "folder") {
		const normalizedPaths = target.paths.map((item) => item.trim()).filter(Boolean);
		if (normalizedPaths.length === 0) throw new Error("Audit paths cannot be empty");
		return {
			target: { ...target, paths: normalizedPaths },
			prompt: mergePromptWithProjectGuidelines(
				replaceTemplate(FOLDER_PROMPT, { paths: normalizedPaths.join(", ") }),
				projectGuidelines,
			),
			userFacingHint: `paths ${summarizeText(normalizedPaths.join(", "), 72)}`,
		};
	}

	const prompt = target.instructions.trim();
	if (!prompt) {
		throw new Error("Audit instructions cannot be empty");
	}
	return {
		target,
		prompt: mergePromptWithProjectGuidelines(prompt, projectGuidelines),
		userFacingHint: summarizeText(prompt, 72),
	};
}
