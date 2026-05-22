import { stat } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { gitExec } from "./git.js";
import type { ReviewTarget } from "./types.js";

export interface ReviewPreflightResult {
	ok: boolean;
	reviewCwd: string;
	reason?: string;
}

export async function resolveReviewCwd(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const top = await gitExec(pi, cwd, ["rev-parse", "--show-toplevel"]);
	return top.ok && top.stdout ? top.stdout : null;
}

export async function hasWorkingTreeChanges(pi: ExtensionAPI, cwd: string): Promise<boolean> {
	const status = await gitExec(pi, cwd, ["status", "--short", "--untracked-files=all"]);
	return status.ok && status.stdout.length > 0;
}

async function verifyPathsExist(cwd: string, paths: string[]): Promise<string | null> {
	for (const raw of paths) {
		const value = raw.trim();
		if (!value) continue;
		const absolute = path.resolve(cwd, value);
		const info = await stat(absolute).catch(() => null);
		if (!info) return value;
	}
	return null;
}

export async function reviewPreflight(
	pi: ExtensionAPI,
	cwd: string,
	target: ReviewTarget,
): Promise<ReviewPreflightResult> {
	if (target.type === "custom") {
		return { ok: true, reviewCwd: cwd };
	}

	if (target.type === "folder") {
		if (target.paths.length === 0) {
			return { ok: false, reviewCwd: cwd, reason: "No files or folders were provided for snapshot audit." };
		}
		const missing = await verifyPathsExist(cwd, target.paths);
		if (missing) {
			return { ok: false, reviewCwd: cwd, reason: `Audit path does not exist: ${missing}` };
		}
		return { ok: true, reviewCwd: cwd };
	}

	const reviewCwd = await resolveReviewCwd(pi, cwd);
	if (!reviewCwd) {
		return {
			ok: false,
			reviewCwd: cwd,
			reason: "`/review` requires a Git repository for this preset. The current working directory is not inside one.",
		};
	}

	if (target.type === "uncommittedChanges") {
		const dirty = await hasWorkingTreeChanges(pi, reviewCwd);
		if (!dirty) {
			return {
				ok: false,
				reviewCwd,
				reason: "There are no staged, unstaged, or untracked changes to audit.",
			};
		}
	}

	return { ok: true, reviewCwd };
}
