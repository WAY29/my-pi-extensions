import { isAbsolute, relative } from "node:path";
import { renderDiff } from "@earendil-works/pi-coding-agent";
import {
	normalizePatchPath,
	openFileAtPath,
	parsePatchActions,
	type ParsedPatchAction,
} from "./patch.ts";

interface RenderApplyPatchPreviewOptions {
	allowPartial?: boolean | undefined;
	maxPreviewLinesPerFile?: number | undefined;
}

export interface ApplyPatchPreviewSection {
	summary: string;
	diffText?: string | undefined;
}

interface PreviewLine {
	lineNumber: number;
	marker: " " | "+" | "-";
	text: string;
}

interface FilePreview {
	verb: "Added" | "Deleted" | "Edited";
	path: string;
	movePath?: string | undefined;
	added: number;
	removed: number;
	lines: PreviewLine[];
}

function splitFileLines(text: string): string[] {
	if (text.length === 0) return [];
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

function displayPath(path: string, cwd: string): string {
	if (!isAbsolute(path)) return path;
	const relativePath = relative(cwd, path);
	if (relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
		return relativePath;
	}
	return path;
}

export function formatPatchTarget(path: string, movePath: string | undefined, cwd: string): string {
	const from = displayPath(path, cwd);
	if (!movePath) return from;
	return `${from} → ${displayPath(movePath, cwd)}`;
}

function readFileLines(path: string, cwd: string): string[] {
	try {
		return splitFileLines(openFileAtPath({ cwd, path }));
	} catch {
		return [];
	}
}

function bulletHeader(verb: string, label: string): string {
	return `• ${verb} ${label}`;
}

function renderCounts(added: number, removed: number): string {
	if (added > 0 && removed > 0) return `(+${added} -${removed})`;
	if (added > 0) return `(+${added})`;
	if (removed > 0) return `(-${removed})`;
	return "";
}

function normalizePatchLine(rawLine: string): PreviewLine {
	const normalized = rawLine === "" ? " " : rawLine;
	const marker = normalized[0]!;
	if (marker !== " " && marker !== "+" && marker !== "-") {
		return { lineNumber: 0, marker: " ", text: rawLine };
	}
	return { lineNumber: 0, marker, text: normalized.slice(1) };
}

function findSequence(lines: string[], context: string[], start: number, normalize: (value: string) => string): number {
	for (let lineIndex = start; lineIndex <= lines.length - context.length; lineIndex += 1) {
		let matches = true;
		for (let contextIndex = 0; contextIndex < context.length; contextIndex += 1) {
			if (normalize(lines[lineIndex + contextIndex]!) !== normalize(context[contextIndex]!)) {
				matches = false;
				break;
			}
		}
		if (matches) return lineIndex;
	}
	return -1;
}

function findMatchingSequence(lines: string[], context: string[], start: number): number {
	if (context.length === 0) return start;
	const exact = findSequence(lines, context, start, (value) => value);
	if (exact !== -1) return exact;
	const trimEnd = findSequence(lines, context, start, (value) => value.trimEnd());
	if (trimEnd !== -1) return trimEnd;
	const trim = findSequence(lines, context, start, (value) => value.trim());
	if (trim !== -1) return trim;
	return start;
}

function formatPreviewLine(line: PreviewLine, lines: PreviewLine[]): string {
	const numberedLines = lines.filter((entry) => entry.lineNumber > 0);
	const numberWidth = Math.max(1, ...numberedLines.map((entry) => String(entry.lineNumber).length));
	const lineNumber = line.lineNumber > 0 ? String(line.lineNumber).padStart(numberWidth, " ") : " ".repeat(numberWidth);
	return `    ${line.marker}${lineNumber} ${line.text}`;
}

function renderPreviewDiffText(lines: PreviewLine[]): string {
	if (lines.length === 0) return "";
	const numberedLines = lines.filter((entry) => entry.lineNumber > 0);
	const numberWidth = Math.max(1, ...numberedLines.map((entry) => String(entry.lineNumber).length));
	return lines
		.map((line) => {
			const lineNumber = line.lineNumber > 0 ? String(line.lineNumber).padStart(numberWidth, " ") : " ".repeat(numberWidth);
			return `${line.marker}${lineNumber} ${line.text}`;
		})
		.join("\n");
}

function renderPreviewLines(lines: PreviewLine[]): string[] {
	if (lines.length === 0) return [];
	const numberedLines = lines.filter((entry) => entry.lineNumber > 0);
	const numberWidth = Math.max(1, ...numberedLines.map((entry) => String(entry.lineNumber).length));
	const diffText = lines
		.map((line) => {
			const lineNumber = line.lineNumber > 0 ? String(line.lineNumber).padStart(numberWidth, " ") : " ".repeat(numberWidth);
			return `${line.marker}${lineNumber} ${line.text}`;
		})
		.join("\n");
	try {
		return renderDiff(diffText).split("\n").map((line) => `    ${line}`);
	} catch {
		return lines.map((line) => formatPreviewLine(line, lines));
	}
}

function sliceLinesAroundChanges(lines: PreviewLine[], maxPreviewLinesPerFile: number): { slicedLines: PreviewLine[]; omittedBefore: boolean; omittedAfter: boolean } {
	if (lines.length <= maxPreviewLinesPerFile) {
		return { slicedLines: lines, omittedBefore: false, omittedAfter: false };
	}

	const firstChangeIndex = lines.findIndex((line) => line.marker === "+" || line.marker === "-");
	if (firstChangeIndex === -1) {
		return {
			slicedLines: lines.slice(0, maxPreviewLinesPerFile),
			omittedBefore: false,
			omittedAfter: lines.length > maxPreviewLinesPerFile,
		};
	}

	const contextBefore = Math.floor((maxPreviewLinesPerFile - 1) / 2);
	const contextAfter = maxPreviewLinesPerFile - contextBefore - 1;
	let start = Math.max(0, firstChangeIndex - contextBefore);
	let end = Math.min(lines.length, firstChangeIndex + contextAfter + 1);

	if (end - start < maxPreviewLinesPerFile) {
		if (start === 0) {
			end = Math.min(lines.length, maxPreviewLinesPerFile);
		} else if (end === lines.length) {
			start = Math.max(0, lines.length - maxPreviewLinesPerFile);
		}
	}

	return {
		slicedLines: lines.slice(start, end),
		omittedBefore: start > 0,
		omittedAfter: end < lines.length,
	};
}

function renderLimitedPreviewLines(lines: PreviewLine[], maxPreviewLinesPerFile: number): string[] {
	if (lines.length === 0) return [];
	const { slicedLines, omittedBefore, omittedAfter } = sliceLinesAroundChanges(lines, maxPreviewLinesPerFile);
	const rendered = renderPreviewLines(slicedLines);
	const output: string[] = [];
	if (omittedBefore) output.push("    ...");
	output.push(...rendered);
	if (omittedAfter) output.push("    ...");
	return output;
}

function renderLimitedPreviewDiffText(lines: PreviewLine[], maxPreviewLinesPerFile: number): string {
	if (lines.length === 0) return "";
	const numberedLines = lines.filter((entry) => entry.lineNumber > 0);
	const numberWidth = Math.max(1, ...numberedLines.map((entry) => String(entry.lineNumber).length));
	const { slicedLines, omittedBefore, omittedAfter } = sliceLinesAroundChanges(lines, maxPreviewLinesPerFile);
	const rendered = slicedLines
		.map((line) => {
			const lineNumber = line.lineNumber > 0 ? String(line.lineNumber).padStart(numberWidth, " ") : " ".repeat(numberWidth);
			return `${line.marker}${lineNumber} ${line.text}`;
		})
		.join("\n");
	const ellipsisLine = ` ${" ".repeat(numberWidth)} ...`;
	let output = rendered;
	if (omittedBefore) output = output ? `${ellipsisLine}\n${output}` : ellipsisLine;
	if (omittedAfter) output = output ? `${output}\n${ellipsisLine}` : ellipsisLine;
	return output;
}

function buildUpdatePreview(action: ParsedPatchAction, cwd: string): { added: number; removed: number; lines: PreviewLine[] } {
	if (!action.lines) {
		return { added: 0, removed: 0, lines: [] };
	}

	const originalLines = readFileLines(action.path, cwd);
	const renderedLines: PreviewLine[] = [];
	let added = 0;
	let removed = 0;
	let searchStart = 0;
	let delta = 0;
	let index = 0;

	while (index < action.lines.length) {
		const line = action.lines[index]!;
		if (line === "*** End of File") break;
		if (!line.startsWith("@@")) {
			index += 1;
			continue;
		}

		index += 1;
		const sectionLines: string[] = [];
		while (index < action.lines.length && !action.lines[index]!.startsWith("@@") && action.lines[index] !== "*** End of File") {
			sectionLines.push(action.lines[index]!);
			index += 1;
		}

		if (sectionLines.length === 0) continue;

		const oldSequence = sectionLines
			.map(normalizePatchLine)
			.filter((entry) => entry.marker === " " || entry.marker === "-")
			.map((entry) => entry.text);
		const sectionStart = findMatchingSequence(originalLines, oldSequence, searchStart);
		let oldLineNumber = sectionStart + 1;
		let newLineNumber = sectionStart + 1 + delta;

		for (const rawLine of sectionLines) {
			const entry = normalizePatchLine(rawLine);
			if (entry.marker === "+") {
				added += 1;
				renderedLines.push({ lineNumber: newLineNumber, marker: "+", text: entry.text });
				newLineNumber += 1;
				continue;
			}

			if (entry.marker === "-") {
				removed += 1;
				renderedLines.push({ lineNumber: oldLineNumber, marker: "-", text: entry.text });
				oldLineNumber += 1;
				continue;
			}

			renderedLines.push({ lineNumber: newLineNumber, marker: " ", text: entry.text });
			oldLineNumber += 1;
			newLineNumber += 1;
		}

		searchStart = sectionStart + oldSequence.length;
		delta += sectionLines.reduce((sum, rawLine) => {
			const marker = normalizePatchLine(rawLine).marker;
			if (marker === "+") return sum + 1;
			if (marker === "-") return sum - 1;
			return sum;
		}, 0);
	}

	return { added, removed, lines: renderedLines };
}

function buildFilePreview(action: ParsedPatchAction, cwd: string): FilePreview {
	if (action.type === "add") {
		const lines = splitFileLines(action.newFile ?? "");
		return {
			verb: "Added",
			path: action.path,
			added: lines.length,
			removed: 0,
			lines: lines.map((text, index) => ({ lineNumber: index + 1, marker: "+", text })),
		};
	}

	if (action.type === "delete") {
		const deletedLines = readFileLines(action.path, cwd);
		return {
			verb: "Deleted",
			path: action.path,
			added: 0,
			removed: deletedLines.length,
			lines: deletedLines.map((text, index) => ({ lineNumber: index + 1, marker: "-", text })),
		};
	}

	const preview = buildUpdatePreview(action, cwd);
	return {
		verb: "Edited",
		path: action.path,
		movePath: action.movePath,
		added: preview.added,
		removed: preview.removed,
		lines: preview.lines,
	};
}

function parseFiles(patchText: string, cwd: string): FilePreview[] {
	const actions = parsePatchActions({ text: patchText });
	return actions.map((action) => buildFilePreview(action, cwd));
}

function parsePartialFiles(patchText: string): FilePreview[] {
	const files: FilePreview[] = [];
	let currentFile: FilePreview | undefined;
	let nextAddedLineNumber = 1;
	let nextDeletedLineNumber = 1;

	function flushCurrentFile(): void {
		if (!currentFile) return;
		files.push(currentFile);
		currentFile = undefined;
	}

	for (const rawLine of patchText.split("\n")) {
		if (rawLine.startsWith("*** Add File: ")) {
			flushCurrentFile();
			currentFile = {
				verb: "Added",
				path: normalizePatchPath({ path: rawLine.slice("*** Add File: ".length) }),
				added: 0,
				removed: 0,
				lines: [],
			};
			nextAddedLineNumber = 1;
			nextDeletedLineNumber = 1;
			continue;
		}

		if (rawLine.startsWith("*** Update File: ")) {
			flushCurrentFile();
			currentFile = {
				verb: "Edited",
				path: normalizePatchPath({ path: rawLine.slice("*** Update File: ".length) }),
				added: 0,
				removed: 0,
				lines: [],
			};
			nextAddedLineNumber = 1;
			nextDeletedLineNumber = 1;
			continue;
		}

		if (rawLine.startsWith("*** Delete File: ")) {
			flushCurrentFile();
			currentFile = {
				verb: "Deleted",
				path: normalizePatchPath({ path: rawLine.slice("*** Delete File: ".length) }),
				added: 0,
				removed: 0,
				lines: [],
			};
			nextAddedLineNumber = 1;
			nextDeletedLineNumber = 1;
			continue;
		}

		if (rawLine.startsWith("*** Move to: ")) {
			if (currentFile) {
				currentFile.movePath = normalizePatchPath({ path: rawLine.slice("*** Move to: ".length) });
			}
			continue;
		}

		if (!currentFile) continue;
		if (rawLine.startsWith("*** ") || rawLine.startsWith("@@") || rawLine === "*** End of File") continue;

		if (rawLine.startsWith("+")) {
			currentFile.added += 1;
			currentFile.lines.push({
				lineNumber: currentFile.verb === "Added" ? nextAddedLineNumber++ : 0,
				marker: "+",
				text: rawLine.slice(1),
			});
			continue;
		}

		if (rawLine.startsWith("-")) {
			currentFile.removed += 1;
			currentFile.lines.push({
				lineNumber: currentFile.verb === "Deleted" ? nextDeletedLineNumber++ : 0,
				marker: "-",
				text: rawLine.slice(1),
			});
		}
	}

	flushCurrentFile();
	return files;
}

function renderPreviewFromFiles(files: FilePreview[], cwd: string, maxPreviewLinesPerFile: number): string {
	if (files.length === 0) return "";

	const lines: string[] = [];
	if (files.length === 1) {
		const file = files[0]!;
		const counts = renderCounts(file.added, file.removed);
		lines.push(counts
			? `${bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd))} ${counts}`
			: bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd)));
		lines.push(...renderLimitedPreviewLines(file.lines, maxPreviewLinesPerFile));
		return lines.join("\n");
	}

	lines.push(bulletHeader("Edited", `${files.length} files`));
	for (const [index, file] of files.entries()) {
		if (index > 0) lines.push("");
		const counts = renderCounts(file.added, file.removed);
		lines.push(counts ? `  └ ${formatPatchTarget(file.path, file.movePath, cwd)} ${counts}` : `  └ ${formatPatchTarget(file.path, file.movePath, cwd)}`);
		lines.push(...renderLimitedPreviewLines(file.lines, maxPreviewLinesPerFile));
	}

	return lines.join("\n");
}

function buildPreviewSections(files: FilePreview[], cwd: string, maxPreviewLinesPerFile: number): ApplyPatchPreviewSection[] {
	return files.map((file) => {
		const counts = renderCounts(file.added, file.removed);
		const summary = counts
			? `${bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd))} ${counts}`
			: bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd));
		const diffText = renderLimitedPreviewDiffText(file.lines, maxPreviewLinesPerFile);
		return {
			summary,
			diffText: diffText || undefined,
		};
	});
}

export function formatApplyPatchSummary(patchText: string, cwd: string): string {
	let files: FilePreview[];
	try {
		files = parseFiles(patchText, cwd);
	} catch {
		return "";
	}
	if (files.length === 0) return "";

	const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
	const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
	if (files.length === 1) {
		const file = files[0]!;
		const counts = renderCounts(file.added, file.removed);
		return counts
			? `${bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd))} ${counts}`
			: bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd));
	}

	const lines: string[] = [];
	lines.push(bulletHeader("Edited", `${files.length} files`));
	for (const file of files) {
		const counts = renderCounts(file.added, file.removed);
		lines.push(counts ? `  └ ${formatPatchTarget(file.path, file.movePath, cwd)} ${counts}` : `  └ ${formatPatchTarget(file.path, file.movePath, cwd)}`);
	}
	return lines.join("\n");
}

export function renderApplyPatchCall(patchText: string, cwd: string): string {
	let files: FilePreview[];
	try {
		files = parseFiles(patchText, cwd);
	} catch {
		return "";
	}
	if (files.length === 0) return "";

	const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
	const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
	const lines: string[] = [];

	if (files.length === 1) {
		const file = files[0]!;
		const counts = renderCounts(file.added, file.removed);
		lines.push(counts
			? `${bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd))} ${counts}`
			: bulletHeader(file.verb, formatPatchTarget(file.path, file.movePath, cwd)));
		lines.push(...renderPreviewLines(file.lines));
		return lines.join("\n");
	}

	lines.push(bulletHeader("Edited", `${files.length} files`));
	for (const [index, file] of files.entries()) {
		if (index > 0) lines.push("");
		const counts = renderCounts(file.added, file.removed);
		lines.push(counts ? `  └ ${formatPatchTarget(file.path, file.movePath, cwd)} ${counts}` : `  └ ${formatPatchTarget(file.path, file.movePath, cwd)}`);
		lines.push(...renderPreviewLines(file.lines));
	}
	return lines.join("\n");
}

export function renderApplyPatchPreview(
	patchText: string,
	cwd: string,
	options: RenderApplyPatchPreviewOptions = {},
): string {
	const maxPreviewLinesPerFile = options.maxPreviewLinesPerFile ?? 12;
	try {
		return renderPreviewFromFiles(parseFiles(patchText, cwd), cwd, maxPreviewLinesPerFile);
	} catch {
		if (options.allowPartial !== true) return "";
		return renderPreviewFromFiles(parsePartialFiles(patchText), cwd, maxPreviewLinesPerFile);
	}
}

export function getApplyPatchPreviewSections(
	patchText: string,
	cwd: string,
	options: RenderApplyPatchPreviewOptions = {},
): ApplyPatchPreviewSection[] {
	const maxPreviewLinesPerFile = options.maxPreviewLinesPerFile ?? 12;
	try {
		return buildPreviewSections(parseFiles(patchText, cwd), cwd, maxPreviewLinesPerFile);
	} catch {
		if (options.allowPartial !== true) return [];
		return buildPreviewSections(parsePartialFiles(patchText), cwd, maxPreviewLinesPerFile);
	}
}
