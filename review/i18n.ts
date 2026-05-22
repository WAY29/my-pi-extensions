import type { ReviewFinding, ReviewOutput, ReviewSeverity } from "./types.js";

export type ReviewLanguage = "zh" | "en";

export function detectReviewLanguage(text: string): ReviewLanguage {
	return /[\u3400-\u9FFF]/.test(text) ? "zh" : "en";
}

export function localizeInterruptedMessage(language: ReviewLanguage): string {
	return language === "zh"
		? "本次审计已中断。请重新运行 /review，并等待其完成。"
		: "This audit was interrupted. Re-run /review and wait for it to finish.";
}

export function localizeFallbackMessage(language: ReviewLanguage): string {
	return language === "zh" ? "本次审计没有产出可用结果。" : "This audit did not produce a usable result.";
}

function localizeSeverity(severity: ReviewSeverity | undefined, language: ReviewLanguage): string | undefined {
	if (!severity) return undefined;
	if (language !== "zh") return severity;
	if (severity === "CRITICAL") return "严重";
	if (severity === "HIGH") return "高";
	if (severity === "MEDIUM") return "中";
	return "低";
}

export function formatLocation(item: ReviewFinding): string {
	const start = item.code_location.line_range.start;
	const end = item.code_location.line_range.end;
	return start === end
		? `${item.code_location.absolute_file_path}:${start}`
		: `${item.code_location.absolute_file_path}:${start}-${end}`;
}

function describeFinding(item: ReviewFinding, language: ReviewLanguage): string {
	const parts = [localizeSeverity(item.severity, language), item.category].filter(Boolean).join("/");
	return parts ? `${item.title} [${parts}]` : item.title;
}

export function formatReviewFindingsBlockLocalized(
	findings: ReviewFinding[],
	language: ReviewLanguage,
	selection?: boolean[],
): string {
	const header = language === "zh"
		? findings.length > 1 ? "完整审计发现：" : "审计发现："
		: findings.length > 1 ? "Full audit findings:" : "Audit finding:";
	const exploitabilityLabel = language === "zh" ? "可利用前提" : "Exploitability";
	const evidenceLabel = language === "zh" ? "证据" : "Evidence";
	const lines: string[] = ["", header];

	for (const [index, item] of findings.entries()) {
		lines.push("");
		const marker = selection ? (selection[index] ?? true ? "[x] " : "[ ] ") : "";
		lines.push(`- ${marker}${describeFinding(item, language)} — ${formatLocation(item)}`);
		if (item.exploitability?.trim()) lines.push(`  ${exploitabilityLabel}：${item.exploitability.trim()}`);
		if (item.evidence?.trim()) lines.push(`  ${evidenceLabel}：${item.evidence.trim()}`);
		for (const bodyLine of item.body.split("\n")) {
			lines.push(`  ${bodyLine}`);
		}
	}

	return lines.join("\n");
}

function renderCallouts(callouts: string[], language: ReviewLanguage): string {
	const header = language === "zh" ? "人工复核提醒（非阻塞）：" : "Human reviewer callouts (non-blocking):";
	return [header, ...callouts.map((item) => `- ${item}`)].join("\n");
}

export function renderReviewOutputTextLocalized(output: ReviewOutput, language: ReviewLanguage): string {
	const sections: string[] = [];
	if (output.audit_scope?.trim()) {
		sections.push(language === "zh" ? `**审计范围：** ${output.audit_scope.trim()}` : `**Audit scope:** ${output.audit_scope.trim()}`);
	}
	const explanation = output.overall_explanation.trim();
	if (explanation) sections.push(explanation);
	if (output.findings.length > 0) {
		const findingsText = formatReviewFindingsBlockLocalized(output.findings, language).trim();
		if (findingsText) sections.push(findingsText);
	}
	if (output.human_reviewer_callouts && output.human_reviewer_callouts.length > 0) {
		sections.push(renderCallouts(output.human_reviewer_callouts, language));
	}
	return sections.length > 0 ? sections.join("\n\n") : localizeFallbackMessage(language);
}

function localizeOverallCorrectness(value: string, language: ReviewLanguage): string {
	if (language === "zh") {
		if (value === "patch is correct") return "变更可接受";
		if (value === "patch is incorrect") return "变更存在问题";
		if (value === "scope appears correct") return "范围内未见明显问题";
		if (value === "scope needs attention") return "范围内存在需要注意的问题";
	}
	return value;
}

export function buildReviewSummaryMarkdownLocalized(
	hint: string,
	output: ReviewOutput | null,
	interrupted: boolean,
	language: ReviewLanguage,
	error?: string,
): string {
	if (interrupted) {
		return language === "zh"
			? [`## 审计已中断：${hint}`, "", localizeInterruptedMessage(language)].join("\n")
			: [`## Audit interrupted: ${hint}`, "", localizeInterruptedMessage(language)].join("\n");
	}
	if (error) {
		return language === "zh"
			? [`## 审计失败：${hint}`, "", error].join("\n")
			: [`## Audit failed: ${hint}`, "", error].join("\n");
	}
	if (!output) {
		return language === "zh"
			? [`## 审计结束：${hint}`, "", localizeFallbackMessage(language)].join("\n")
			: [`## Audit finished: ${hint}`, "", localizeFallbackMessage(language)].join("\n");
	}
	const correctnessLabel = language === "zh" ? "总体判断" : "Overall verdict";
	const correctness = localizeOverallCorrectness(output.overall_correctness, language);
	return language === "zh"
		? [`## 审计完成：${hint}`, "", `**${correctnessLabel}：** ${correctness}`, "", renderReviewOutputTextLocalized(output, language)].join("\n")
		: [`## Audit complete: ${hint}`, "", `**${correctnessLabel}:** ${correctness}`, "", renderReviewOutputTextLocalized(output, language)].join("\n");
}
