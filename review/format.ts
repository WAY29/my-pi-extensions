import {
	INTERRUPTED_REVIEW_MESSAGE,
	REVIEW_FALLBACK_MESSAGE,
} from "./constants.js";
import type { ReviewCodeLocation, ReviewFinding, ReviewOutput, ReviewSeverity } from "./types.js";

function extractObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asSeverity(value: unknown): ReviewSeverity | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.toUpperCase();
	return normalized === "CRITICAL" || normalized === "HIGH" || normalized === "MEDIUM" || normalized === "LOW"
		? normalized
		: undefined;
}

function normalizeCodeLocation(value: unknown): ReviewCodeLocation {
	const object = extractObject(value);
	const rangeObject = extractObject(object?.line_range);
	const start = Math.max(1, Math.trunc(asNumber(rangeObject?.start, 1)));
	const end = Math.max(start, Math.trunc(asNumber(rangeObject?.end, start)));
	return {
		absolute_file_path: asString(object?.absolute_file_path, "(unknown file)"),
		line_range: { start, end },
	};
}

function normalizeFinding(value: unknown): ReviewFinding {
	const object = extractObject(value);
	const priorityValue = object?.priority;
	const priority = typeof priorityValue === "number" && Number.isFinite(priorityValue)
		? Math.max(0, Math.min(3, Math.trunc(priorityValue)))
		: priorityValue === null
			? null
			: undefined;
	return {
		title: asString(object?.title, "Untitled finding"),
		body: asString(object?.body, ""),
		confidence_score: asNumber(object?.confidence_score, 0),
		priority,
		severity: asSeverity(object?.severity),
		category: typeof object?.category === "string" ? object.category : undefined,
		exploitability: typeof object?.exploitability === "string" ? object.exploitability : undefined,
		impact: typeof object?.impact === "string" ? object.impact : undefined,
		evidence: typeof object?.evidence === "string" ? object.evidence : undefined,
		code_location: normalizeCodeLocation(object?.code_location),
	};
}

function normalizeReviewOutput(parsed: Partial<ReviewOutput> & Record<string, unknown>): ReviewOutput {
	return {
		findings: Array.isArray(parsed.findings) ? parsed.findings.map(normalizeFinding) : [],
		overall_correctness: typeof parsed.overall_correctness === "string" ? parsed.overall_correctness : "scope needs attention",
		overall_explanation: typeof parsed.overall_explanation === "string" ? parsed.overall_explanation : "",
		overall_confidence_score: typeof parsed.overall_confidence_score === "number" ? parsed.overall_confidence_score : 0,
		audit_scope: typeof parsed.audit_scope === "string" ? parsed.audit_scope : undefined,
		human_reviewer_callouts: Array.isArray(parsed.human_reviewer_callouts)
			? parsed.human_reviewer_callouts.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
			: undefined,
	};
}

export function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return !!part
				&& typeof part === "object"
				&& (part as { type?: string }).type === "text"
				&& typeof (part as { text?: unknown }).text === "string";
		})
		.map((part) => part.text)
		.join("\n");
}

export function findLastAssistantText(messages: unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const candidate = messages[i] as { role?: string; content?: unknown } | undefined;
		if (candidate?.role === "assistant") {
			const text = extractText(candidate.content);
			if (text.trim()) return text;
		}
	}
	return "";
}

export function parseReviewOutput(text: string): ReviewOutput {
	const parseJson = (input: string): ReviewOutput | null => {
		try {
			const parsed = JSON.parse(input) as Partial<ReviewOutput> & Record<string, unknown>;
			return normalizeReviewOutput(parsed);
		} catch {
			return null;
		}
	};

	const direct = parseJson(text);
	if (direct) return direct;

	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) {
		const sliced = parseJson(text.slice(start, end + 1));
		if (sliced) return sliced;
	}

	return {
		findings: [],
		overall_correctness: "scope needs attention",
		overall_explanation: text.trim(),
		overall_confidence_score: 0,
	};
}

export function formatLocation(item: ReviewFinding): string {
	const path = item.code_location.absolute_file_path || "(unknown file)";
	const start = item.code_location.line_range.start;
	const end = item.code_location.line_range.end;
	return start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
}

function escapeTableCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function conciseLocation(item: ReviewFinding): string {
	return formatLocation(item);
}

export function formatReviewFindingsBlock(findings: ReviewFinding[], selection?: boolean[]): string {
	const lines: string[] = ["", findings.length > 1 ? "Full audit findings:" : "Audit finding:"];
	lines.push("");
	lines.push("| # | Title | Summary | Preconditions | Impact | Evidence | Location |", "| --- | --- | --- | --- | --- | --- | --- |");

	for (const [index, item] of findings.entries()) {
		const marker = selection ? (selection[index] ?? true ? "[x] " : "[ ] ") : "";
		const title = escapeTableCell(`${marker}${item.title}${item.severity || item.category ? ` [${[item.severity, item.category].filter(Boolean).join("/")}]` : ""}`);
		const summary = escapeTableCell(item.body || "");
		const exploitability = escapeTableCell(item.exploitability || "");
		const impact = escapeTableCell(item.impact || "");
		const evidence = escapeTableCell(item.evidence || "");
		const location = escapeTableCell(conciseLocation(item));
		lines.push(`| ${index + 1} | ${title} | ${summary} | ${exploitability} | ${impact} | ${evidence} | ${location} |`);
	}

	return lines.join("\n");
}

export function renderReviewOutputText(output: ReviewOutput): string {
	const sections: string[] = [];
	if (output.audit_scope?.trim()) sections.push(`Audit scope: ${output.audit_scope.trim()}`);
	const explanation = output.overall_explanation.trim();
	if (explanation) sections.push(explanation);
	if (output.findings.length > 0) {
		const findingsText = formatReviewFindingsBlock(output.findings).trim();
		if (findingsText) sections.push(findingsText);
	}
	if (output.human_reviewer_callouts && output.human_reviewer_callouts.length > 0) {
		sections.push(["Human reviewer callouts (non-blocking):", ...output.human_reviewer_callouts.map((item) => `- ${item}`)].join("\n"));
	}
	return sections.length > 0 ? sections.join("\n\n") : REVIEW_FALLBACK_MESSAGE;
}

export function buildReviewSummaryMarkdown(
	hint: string,
	output: ReviewOutput | null,
	interrupted: boolean,
	error?: string,
): string {
	if (interrupted) {
		return [`## Code audit complete: ${hint}`, "", INTERRUPTED_REVIEW_MESSAGE].join("\n");
	}
	if (error) {
		return [`## Code audit failed: ${hint}`, "", error].join("\n");
	}
	if (!output) {
		return [`## Code audit complete: ${hint}`, "", REVIEW_FALLBACK_MESSAGE].join("\n");
	}
	const correctness = output.overall_correctness || "scope needs attention";
	return [`## Code audit complete: ${hint}`, "", `**Overall verdict:** ${correctness}`, "", renderReviewOutputText(output)].join("\n");
}

export function buildResolvePrompt(selectedFindings: ReviewFinding[], hint: string): string {
	return [
		`Resolve the following selected audit findings from /review for ${hint}.`,
		"Only address the selected findings below. Keep the fix scope tight and avoid unrelated refactors.",
		"Fix higher severity and higher priority items first if there is any tradeoff.",
		"",
		formatReviewFindingsBlock(selectedFindings).trim(),
		"",
		"After making changes, briefly summarize what you fixed, what you intentionally left unchanged, and how you verified the result.",
	].join("\n");
}
