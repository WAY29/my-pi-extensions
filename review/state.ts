import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ReadonlySessionManager } from "@earendil-works/pi-coding-agent";
import type { ReviewTarget } from "./types.js";

export const REVIEW_STATE_ENTRY = "codex-review-state";
export const REVIEW_CONTINUE_PROMPT =
	"Continue the interrupted review from where you left off. Do not restart from scratch. Finish the review and return the exact JSON schema from the review instructions.";

export interface ReviewResumeState {
	status: "running" | "interrupted" | "completed";
	hint: string;
	target: ReviewTarget;
	reviewSessionFile: string;
	startedAt: number;
	updatedAt: number;
}

export function getReviewSessionDir(sessionManager: Pick<ReadonlySessionManager, "getSessionId">): string {
	return join(getAgentDir(), "review-sessions", sessionManager.getSessionId());
}

export function persistReviewState(pi: ExtensionAPI, state: ReviewResumeState): void {
	pi.appendEntry(REVIEW_STATE_ENTRY, state);
}

export function loadReviewResumeState(
	sessionManager: Pick<ReadonlySessionManager, "getEntries">,
): ReviewResumeState | null {
	const entries = sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== REVIEW_STATE_ENTRY) continue;
		const data = entry.data as ReviewResumeState | undefined;
		if (!data?.reviewSessionFile || !data.target || !data.hint || !data.status) continue;
		if (!existsSync(data.reviewSessionFile)) return null;
		if (data.status === "completed") return null;
		return {
			...data,
			status: data.status === "running" ? "interrupted" : data.status,
		};
	}
	return null;
}
