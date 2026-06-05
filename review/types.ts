import type { AgentSessionEvent, ResourceLoader } from "@earendil-works/pi-coding-agent";

export type ReviewTarget =
	| { type: "uncommittedChanges" }
	| { type: "baseBranch"; branch: string }
	| { type: "commit"; sha: string; title?: string }
	| { type: "folder"; paths: string[] }
	| { type: "custom"; instructions: string };

export type ReviewSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface ResolvedReviewRequest {
	target: ReviewTarget;
	prompt: string;
	userFacingHint: string;
}

export interface ReviewLineRange {
	start: number;
	end: number;
}

export interface ReviewCodeLocation {
	absolute_file_path: string;
	line_range: ReviewLineRange;
}

export interface ReviewFinding {
	title: string;
	body: string;
	confidence_score: number;
	priority?: number | null;
	severity?: ReviewSeverity;
	category?: string;
	exploitability?: string;
	impact?: string;
	evidence?: string;
	code_location: ReviewCodeLocation;
}

export interface ReviewOutput {
	findings: ReviewFinding[];
	overall_correctness: string;
	overall_explanation: string;
	overall_confidence_score: number;
	audit_scope?: string;
	human_reviewer_callouts?: string[];
}

export interface ReviewResultDetails {
	hint: string;
	target: ReviewTarget;
	reviewOutput: ReviewOutput | null;
	rawOutput: string;
	interrupted?: boolean;
	error?: string;
}

export interface CommitEntry {
	sha: string;
	subject: string;
}

export interface ReviewLiveEntry {
	kind: "status" | "tool" | "toolResult" | "assistant" | "error";
	text: string;
	toolCallId?: string;
	isError?: boolean;
}

export interface ReviewRunnerResult extends ReviewResultDetails {
	liveEntries: ReviewLiveEntry[];
}

export interface ReviewLiveState {
	entries: ReviewLiveEntry[];
	lastToolById: Map<string, ReviewLiveEntry>;
	toolArgsById: Map<string, { toolName: string; args: any }>;
	lastAssistantText: string;
}

export interface ReviewEventFormatter {
	format(event: AgentSessionEvent): ReviewLiveEntry | null;
}

export interface ReviewResourceLoaderFactory {
	(reviewPrompt: string): ResourceLoader;
}
