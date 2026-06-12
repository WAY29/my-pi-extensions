import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface PreparedEditRecord {
	oldText?: unknown;
	newText?: unknown;
}

export interface ValidatedEdit {
	oldText: string;
	newText: string;
}

export interface ValidatedEditInput {
	path: string;
	edits: ValidatedEdit[];
}

export interface PreparedArgumentsWithWarnings {
	prepared: unknown;
	warnings: string[];
}

interface EditAnalysis {
	exactLines: number[];
	fuzzyLines: number[];
	aggressiveLines: number[];
	lineSpan: number;
}

const TOP_LEVEL_CANONICAL_KEYS = new Set(["path", "edits"]);
const TOP_LEVEL_COMPATIBILITY_KEYS = new Set([
	"file_path",
	"oldText",
	"newText",
	"old_text",
	"new_text",
	"search",
	"findText",
	"match",
	"replace",
	"replaceText",
	"replacement",
]);
const EDIT_CANONICAL_KEYS = new Set(["oldText", "newText"]);
const EDIT_COMPATIBILITY_KEYS = new Set(["old_text", "new_text", "search", "findText", "match", "replace", "replaceText", "replacement"]);

function firstDefinedString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string") return value;
	}
	return undefined;
}

function normalizeEditRecord(input: unknown): PreparedEditRecord {
	if (!input || typeof input !== "object") return {};
	const record = input as Record<string, unknown>;
	return {
		oldText: firstDefinedString(record.oldText, record.old_text, record.search, record.findText, record.match),
		newText: firstDefinedString(record.newText, record.new_text, record.replace, record.replaceText, record.replacement),
	};
}

function sanitizeEditRecords(edits: unknown[] | undefined): PreparedEditRecord[] | undefined {
	if (!edits) return undefined;
	return edits.map((edit) => normalizeEditRecord(edit));
}

function listUnexpectedKeys(record: Record<string, unknown>, canonicalKeys: Set<string>, compatibilityKeys: Set<string>): string[] {
	return Object.keys(record).filter((key) => !canonicalKeys.has(key) && !compatibilityKeys.has(key));
}

function collectPreparationWarnings(record: Record<string, unknown>, parsedEdits: unknown[] | undefined): string[] {
	const warnings: string[] = [];
	const compatibilityKeys = Object.keys(record).filter((key) => TOP_LEVEL_COMPATIBILITY_KEYS.has(key));
	if (compatibilityKeys.length > 0) {
		warnings.push(`Use only the canonical top-level shape next time: { path, edits }. Avoid compatibility keys like ${compatibilityKeys.join(", ")}.`);
	}

	const topLevelUnexpected = listUnexpectedKeys(record, TOP_LEVEL_CANONICAL_KEYS, TOP_LEVEL_COMPATIBILITY_KEYS);
	if (topLevelUnexpected.length > 0) {
		warnings.push(`Ignored extra top-level keys: ${topLevelUnexpected.join(", ")}.`);
	}

	for (const [index, edit] of (parsedEdits ?? []).entries()) {
		if (!edit || typeof edit !== "object") continue;
		const editRecord = edit as Record<string, unknown>;
		const editCompatibilityKeys = Object.keys(editRecord).filter((key) => EDIT_COMPATIBILITY_KEYS.has(key));
		if (editCompatibilityKeys.length > 0) {
			warnings.push(`Use only edits[${index}].oldText and edits[${index}].newText next time. Avoid compatibility keys like ${editCompatibilityKeys.join(", ")}.`);
		}
		const unexpectedKeys = listUnexpectedKeys(editRecord, EDIT_CANONICAL_KEYS, EDIT_COMPATIBILITY_KEYS);
		if (unexpectedKeys.length > 0) {
			warnings.push(`Ignored extra keys in edits[${index}]: ${unexpectedKeys.join(", ")}.`);
		}
	}

	return warnings;
}

function parseEditsInput(edits: unknown): unknown[] | undefined {
	if (Array.isArray(edits)) return edits;
	if (typeof edits === "string") {
		try {
			const parsed = JSON.parse(edits) as unknown;
			if (Array.isArray(parsed)) return parsed;
			if (parsed && typeof parsed === "object") return [parsed];
		} catch {
			return [];
		}
		return [];
	}
	if (edits && typeof edits === "object") return [edits];
	return undefined;
}

export function prepareAdvisedEditArgumentsWithWarnings(input: unknown): PreparedArgumentsWithWarnings {
	if (!input || typeof input !== "object") return { prepared: input, warnings: [] };

	const record = input as Record<string, unknown>;
	const path = firstDefinedString(record.path, record.file_path);
	const parsedEdits = parseEditsInput(record.edits);
	const edits = sanitizeEditRecords(parsedEdits) ?? [];
	const warnings = collectPreparationWarnings(record, parsedEdits);

	const legacyEdit = normalizeEditRecord(record);
	if (legacyEdit.oldText !== undefined || legacyEdit.newText !== undefined) {
		edits.push(legacyEdit);
	}

	return {
		prepared: {
			...(path !== undefined ? { path } : {}),
			...(parsedEdits !== undefined || edits.length > 0 ? { edits } : {}),
		},
		warnings,
	};
}

export function prepareAdvisedEditArguments(input: unknown): unknown {
	return prepareAdvisedEditArgumentsWithWarnings(input).prepared;
}

function formatCanonicalShape(): string {
	return '{ path: "src/file.ts", edits: [{ oldText: "exact old text", newText: "replacement text" }] }';
}

export function buildValidationAdvice(path: string | undefined, issues: string[]): string {
	const target = path ? ` for ${path}` : "";
	return [
		`Edit input is invalid${target}.`,
		"Problems:",
		...issues.map((issue) => `- ${issue}`),
		"Advice:",
		"- Send the canonical shape exactly once: " + formatCanonicalShape(),
		"- Every edits[i] item must include both oldText and newText as strings.",
		"- Top-level oldText/newText is still accepted for compatibility, but edits[] is preferred.",
		"- Retry edit after fixing the arguments; do not fall back to write or rewrite the whole file.",
	].join("\n");
}

export function validateAdvisedEditInput(input: unknown): ValidatedEditInput {
	const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	const path = typeof record.path === "string" ? record.path : undefined;
	const edits = Array.isArray(record.edits) ? record.edits : undefined;
	const issues: string[] = [];

	if (!path) {
		issues.push("path is missing or is not a string.");
	}
	if (!edits) {
		issues.push("edits is missing or is not an array.");
	} else if (edits.length === 0) {
		issues.push("edits must contain at least one item.");
	}

	const validatedEdits: ValidatedEdit[] = [];
	if (edits) {
		for (let index = 0; index < edits.length; index += 1) {
			const edit = edits[index];
			if (!edit || typeof edit !== "object") {
				issues.push(`edits[${index}] is not an object.`);
				continue;
			}

			const item = edit as Record<string, unknown>;
			if (typeof item.oldText !== "string") {
				issues.push(`edits[${index}].oldText is missing or is not a string.`);
			}
			if (typeof item.newText !== "string") {
				issues.push(`edits[${index}].newText is missing or is not a string.`);
			}
			if (typeof item.oldText === "string" && typeof item.newText === "string") {
				validatedEdits.push({ oldText: item.oldText, newText: item.newText });
			}
		}
	}

	if (issues.length > 0 || !path) {
		throw new Error(buildValidationAdvice(path, issues));
	}

	return { path, edits: validatedEdits };
}

function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function normalizeForFuzzyMatch(text: string): string {
	return text
		.normalize("NFKC")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function normalizeAggressiveWhitespace(text: string): string {
	return normalizeForFuzzyMatch(text)
		.split("\n")
		.map((line) => line.trim())
		.join("\n");
}

function findAllOccurrences(haystack: string, needle: string): number[] {
	if (!needle) return [];
	const indexes: number[] = [];
	let start = 0;
	while (start <= haystack.length - needle.length) {
		const index = haystack.indexOf(needle, start);
		if (index === -1) break;
		indexes.push(index);
		start = index + Math.max(1, needle.length);
	}
	return indexes;
}

function countLines(text: string): number {
	if (!text) return 1;
	const normalized = normalizeToLF(text);
	const lines = normalized.split("\n");
	return lines.at(-1) === "" ? Math.max(1, lines.length - 1) : lines.length;
}

function indexToLineNumber(content: string, index: number): number {
	let line = 1;
	for (let cursor = 0; cursor < index; cursor += 1) {
		if (content[cursor] === "\n") line += 1;
	}
	return line;
}

function indexesToLines(content: string, indexes: number[], lineSpan: number): number[] {
	const lineNumbers = indexes.map((index) => indexToLineNumber(content, index));
	const unique = [...new Set(lineNumbers)];
	return unique.slice(0, 8).map((line) => Math.max(1, line + Math.max(0, Math.floor((lineSpan - 1) / 2)) - Math.max(0, Math.floor((lineSpan - 1) / 2))));
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
	const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: Array<{ start: number; end: number }> = [];
	for (const range of sorted) {
		const last = merged.at(-1);
		if (!last || range.start > last.end + 1) {
			merged.push({ ...range });
			continue;
		}
		last.end = Math.max(last.end, range.end);
	}
	return merged;
}

function formatLineRanges(lines: number[], lineSpan: number): string {
	if (lines.length === 0) return "unknown";
	const ranges = mergeRanges(lines.map((line) => ({ start: line, end: line + lineSpan - 1 })));
	return ranges.map((range) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`)).join(", ");
}

function buildReadAdvice(path: string, lines: number[], lineSpan: number): string | undefined {
	if (lines.length === 0) return undefined;
	const ranges = mergeRanges(lines.map((line) => ({ start: Math.max(1, line - 2), end: line + lineSpan + 1 })));
	const rangeText = ranges.map((range) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`)).join(", ");
	return `Read ${path} around lines ${rangeText}, then copy the exact text including indentation, blank lines, and trailing newlines.`;
}

function analyzeEditAgainstContent(content: string, edit: ValidatedEdit): EditAnalysis {
	const normalizedContent = normalizeToLF(content);
	const oldText = normalizeToLF(edit.oldText);
	const lineSpan = countLines(oldText);
	const exactIndexes = findAllOccurrences(normalizedContent, oldText);

	const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const fuzzyIndexes = fuzzyOldText ? findAllOccurrences(fuzzyContent, fuzzyOldText) : [];

	const aggressiveContent = normalizeAggressiveWhitespace(normalizedContent);
	const aggressiveOldText = normalizeAggressiveWhitespace(oldText);
	const aggressiveIndexes = aggressiveOldText ? findAllOccurrences(aggressiveContent, aggressiveOldText) : [];

	return {
		exactLines: indexesToLines(normalizedContent, exactIndexes, lineSpan),
		fuzzyLines: indexesToLines(fuzzyContent, fuzzyIndexes, lineSpan),
		aggressiveLines: indexesToLines(aggressiveContent, aggressiveIndexes, lineSpan),
		lineSpan,
	};
}

function extractEditIndexes(message: string): number[] {
	const matches = [...message.matchAll(/edits\[(\d+)\]/g)].map((match) => Number.parseInt(match[1] || "", 10)).filter(Number.isFinite);
	return [...new Set(matches)];
}

function buildSharedRetryAdvice(): string {
	return "Retry edit after following the advice below; do not fall back to write or rewrite the whole file.";
}

function buildDuplicateAdvice(path: string, editIndex: number, analysis: EditAnalysis): string[] {
	const lines = analysis.exactLines.length > 0 ? analysis.exactLines : analysis.fuzzyLines.length > 0 ? analysis.fuzzyLines : analysis.aggressiveLines;
	const bullets = [
		`${path} contains multiple matches for edits[${editIndex}].oldText around lines ${formatLineRanges(lines, analysis.lineSpan)}.`,
		`Expand edits[${editIndex}].oldText with one or two unique surrounding lines so it matches exactly one region.`,
	];
	const readAdvice = buildReadAdvice(path, lines, analysis.lineSpan);
	if (readAdvice) bullets.unshift(readAdvice);
	return bullets;
}

function buildNotFoundAdvice(path: string, editIndex: number, analysis: EditAnalysis): string[] {
	if (analysis.fuzzyLines.length === 1) {
		return [
			buildReadAdvice(path, analysis.fuzzyLines, analysis.lineSpan) ?? `Read ${path} and inspect the candidate region manually.`,
			`edits[${editIndex}].oldText appears to match only after fuzzy normalization near lines ${formatLineRanges(analysis.fuzzyLines, analysis.lineSpan)}.`,
			"Likely causes: trailing whitespace, smart quotes, Unicode dashes, or special space characters were copied loosely.",
		];
	}

	if (analysis.aggressiveLines.length === 1) {
		return [
			buildReadAdvice(path, analysis.aggressiveLines, analysis.lineSpan) ?? `Read ${path} and inspect the candidate region manually.`,
			`edits[${editIndex}].oldText likely missed leading indentation or other line-leading whitespace near lines ${formatLineRanges(analysis.aggressiveLines, analysis.lineSpan)}.`,
			"Copy the exact block from the file, including indentation on every line.",
		];
	}

	if (analysis.fuzzyLines.length > 1 || analysis.aggressiveLines.length > 1) {
		const lines = analysis.fuzzyLines.length > 0 ? analysis.fuzzyLines : analysis.aggressiveLines;
		return [
			buildReadAdvice(path, lines, analysis.lineSpan) ?? `Read ${path} and inspect the candidate regions manually.`,
			`There are multiple near-matches for edits[${editIndex}].oldText around lines ${formatLineRanges(lines, analysis.lineSpan)}.`,
			"Read those regions and widen oldText until only one exact region remains.",
		];
	}

	return [
		`Read ${path} again and copy the exact target block for edits[${editIndex}].oldText, including blank lines and indentation.`,
		"If the block is too large, shrink oldText to the smallest region that is still unique.",
	];
}

export async function buildAdvisedEditErrorMessage({
	cwd,
	input,
	error,
}: {
	cwd: string;
	input: ValidatedEditInput;
	error: unknown;
}): Promise<string> {
	const message = error instanceof Error ? error.message : String(error);
	const lines: string[] = [message, "Advice:"];

	if (message.includes("oldText must not be empty")) {
		lines.push("- Provide a non-empty oldText string. Empty oldText makes the replacement ambiguous.");
		lines.push(`- Read ${input.path} and copy at least one exact line from the target region before retrying.`);
		lines.push(`- ${buildSharedRetryAdvice()}`);
		return lines.join("\n");
	}

	if (message.includes("No changes made to")) {
		lines.push("- Ensure newText actually differs from the matched text after preserving whitespace and line endings.");
		lines.push(`- Read ${input.path} again and compare oldText/newText carefully before retrying.`);
		lines.push(`- ${buildSharedRetryAdvice()}`);
		return lines.join("\n");
	}

	if (message.includes("overlap in")) {
		const indexes = extractEditIndexes(message);
		lines.push(`- Merge ${indexes.map((index) => `edits[${index}]`).join(" and ")} into one edit that covers the whole overlapping block.`);
		lines.push(`- Read ${input.path} once, capture the full overlapping region, and retry with a single replacement.`);
		lines.push(`- ${buildSharedRetryAdvice()}`);
		return lines.join("\n");
	}

	if (message.includes("Could not edit file:")) {
		lines.push(`- Use ls/read to confirm that ${input.path} exists and that pi can read and write it.`);
		lines.push("- If the path is correct, retry edit after fixing the permission or path issue.");
		lines.push(`- ${buildSharedRetryAdvice()}`);
		return lines.join("\n");
	}

	let rawContent: string | undefined;
	try {
		rawContent = await readFile(resolve(cwd, input.path), "utf8");
	} catch {
		rawContent = undefined;
	}

	if (!rawContent) {
		lines.push(`- Read ${input.path} directly before retrying so oldText can be copied exactly.`);
		lines.push(`- ${buildSharedRetryAdvice()}`);
		return lines.join("\n");
	}

	const indexes = extractEditIndexes(message);
	const targetEditIndexes = indexes.length > 0 ? indexes : input.edits.length === 1 ? [0] : [];
	for (const editIndex of targetEditIndexes) {
		const edit = input.edits[editIndex];
		if (!edit) continue;
		const analysis = analyzeEditAgainstContent(rawContent, edit);
		const bullets = message.includes("Found ") && message.includes("occurrences")
			? buildDuplicateAdvice(input.path, editIndex, analysis)
			: buildNotFoundAdvice(input.path, editIndex, analysis);
		for (const bullet of bullets) lines.push(`- ${bullet}`);
	}

	if (targetEditIndexes.length === 0) {
		lines.push(`- Read ${input.path} again, then retry with a smaller unique oldText block.`);
	}

	lines.push(`- ${buildSharedRetryAdvice()}`);
	return lines.join("\n");
}
