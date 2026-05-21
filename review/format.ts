import {
	INTERRUPTED_REVIEW_MESSAGE,
	REVIEW_FALLBACK_MESSAGE,
} from "./constants.js";
import type { ReviewFinding, ReviewOutput } from "./types.js";

export function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return !!part && typeof part === "object" && (part as { type?: string }).type === "text" && typeof (part as { text?: unknown }).text === "string";
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
			const parsed = JSON.parse(input) as Partial<ReviewOutput>;
			return {
				findings: Array.isArray(parsed.findings) ? (parsed.findings as ReviewFinding[]) : [],
				overall_correctness: typeof parsed.overall_correctness === "string" ? parsed.overall_correctness : "patch is incorrect",
				overall_explanation: typeof parsed.overall_explanation === "string" ? parsed.overall_explanation : "",
				overall_confidence_score:
					typeof parsed.overall_confidence_score === "number" ? parsed.overall_confidence_score : 0,
			};
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
		overall_correctness: "patch is incorrect",
		overall_explanation: text.trim(),
		overall_confidence_score: 0,
	};
}

export function formatLocation(item: ReviewFinding): string {
	const start = item.code_location.line_range.start;
	const end = item.code_location.line_range.end;
	return `${item.code_location.absolute_file_path}:${start}-${end}`;
}

export function formatReviewFindingsBlock(findings: ReviewFinding[], selection?: boolean[]): string {
	const lines: string[] = ["", findings.length > 1 ? "Full review comments:" : "Review comment:"];

	for (const [index, item] of findings.entries()) {
		lines.push("");
		const marker = selection ? (selection[index] ?? true ? "[x] " : "[ ] ") : "";
		lines.push(`- ${marker}${item.title} — ${formatLocation(item)}`);
		for (const bodyLine of item.body.split("\n")) {
			lines.push(`  ${bodyLine}`);
		}
	}

	return lines.join("\n");
}

export function renderReviewOutputText(output: ReviewOutput): string {
	const sections: string[] = [];
	const explanation = output.overall_explanation.trim();
	if (explanation) sections.push(explanation);
	if (output.findings.length > 0) {
		const findingsText = formatReviewFindingsBlock(output.findings).trim();
		if (findingsText) sections.push(findingsText);
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
		return [`## Code review complete: ${hint}`, "", INTERRUPTED_REVIEW_MESSAGE].join("\n");
	}
	if (error) {
		return [`## Code review failed: ${hint}`, "", error].join("\n");
	}
	if (!output) {
		return [`## Code review complete: ${hint}`, "", REVIEW_FALLBACK_MESSAGE].join("\n");
	}
	const correctness = output.overall_correctness || "patch is incorrect";
	return [`## Code review complete: ${hint}`, "", `**Overall correctness:** ${correctness}`, "", renderReviewOutputText(output)].join("\n");
}

export function buildResolvePrompt(selectedFindings: ReviewFinding[], hint: string): string {
	return [
		`Resolve the following selected review findings from /review for ${hint}.`,
		"Only address the selected findings below. Keep the fix scope tight and avoid unrelated refactors.",
		"",
		formatReviewFindingsBlock(selectedFindings).trim(),
		"",
		"After making changes, briefly summarize what you fixed and note any remaining risk.",
	].join("\n");
}
