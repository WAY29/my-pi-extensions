import type { ReviewTarget } from "./types.js";

export function sameReviewTarget(a: ReviewTarget, b: ReviewTarget): boolean {
	if (a.type !== b.type) return false;
	switch (a.type) {
		case "uncommittedChanges":
			return true;
		case "baseBranch":
			return a.branch === (b as typeof a).branch;
		case "commit":
			return a.sha === (b as typeof a).sha;
		case "custom":
			return a.instructions.trim() === (b as typeof a).instructions.trim();
	}
}
