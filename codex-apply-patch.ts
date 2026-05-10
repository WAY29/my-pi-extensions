import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import * as Diff from "diff";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/*
 * Adapted from https://github.com/gturkoglu/pi-codex-apply-patch (MIT).
 * Local policy: register apply_patch for every model and leave built-in edit/write enabled.
 */

// Tool result diff limits for the TUI (avoid huge renders for big diffs).
const RESULT_DIFF_MAX_LINES = 120;
const RESULT_DIFF_EXPANDED_MAX_LINES = 500;

// Types used for tool progress and result reporting in the TUI.
type ApplyPatchOpType = "create_file" | "update_file" | "delete_file";

interface ApplyPatchResult {
	type: ApplyPatchOpType;
	path: string;
	status: "completed" | "failed";
	output?: string;
	diff?: string;
}

interface ApplyPatchOperation {
	type: ApplyPatchOpType;
	path: string;
	/**
	 * V4A diff.
	 * - create_file: full file content (each line starts with '+')
	 * - update_file: @@ sections with +/-/space lines
	 */
	diff?: string;
	/** Optional move target (non-standard, but some Codex outputs include it). */
	move_path?: string;
}

type ApplyPatchDetails =
	| { stage: "progress"; message: string }
	| {
			stage: "done";
			fuzz: number;
			results: ApplyPatchResult[];
	  };

// Emit a progress update (used by the tool renderer).
function progress(onUpdate: AgentToolUpdateCallback<ApplyPatchDetails> | undefined, message: string): void {
	onUpdate?.({ content: [{ type: "text", text: message }], details: { stage: "progress", message } });
}

// Errors thrown by the diff parser/application are surfaced to the model as tool failures.
class DiffError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiffError";
	}
}

// Normalize line endings to LF so diff parsing is consistent across platforms.
function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Normalize patch paths to POSIX-style, trim whitespace, and strip Pi's @ path shorthand.
function normalizePatchPath(p: string): string {
	let raw = p.replace(/\\/g, "/").trim();
	if (raw.startsWith("@")) raw = raw.slice(1).trimStart();
	return raw;
}

// Validate and sanitize a patch path.
// Relative paths are resolved against cwd; POSIX absolute paths are allowed and left absolute.
// Traversal is still rejected for relative paths to avoid surprising cwd escapes via ../.
function validatePatchPath(p: string): string {
	const raw = normalizePatchPath(p);
	if (!raw) throw new DiffError("Invalid path: empty");
	if (raw.includes("\u0000")) throw new DiffError("Invalid path: contains NUL");
	if (/^[A-Za-z]:\//.test(raw)) throw new DiffError(`Invalid path: absolute Windows paths are not supported: ${raw}`);

	const normalized = path.posix.normalize(raw);
	if (normalized === ".") throw new DiffError(`Invalid path: ${raw}`);
	if (!path.posix.isAbsolute(normalized) && (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../"))) {
		throw new DiffError(`Invalid path: directory traversal is not allowed: ${raw}`);
	}

	return normalized;
}

// Resolve a sanitized patch path. Absolute paths bypass cwd and are delegated to sandbox/OS policy.
function toFsPath(cwd: string, patchPath: string): string {
	return path.posix.isAbsolute(patchPath) ? path.resolve(patchPath) : path.resolve(cwd, patchPath);
}

// Cheap existence check used for create/update/delete preconditions.
async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

// Participate in Pi's built-in per-file mutation queue so apply_patch can safely coexist with edit/write.
async function withFileMutationQueues<T>(filePaths: string[], fn: () => Promise<T>): Promise<T> {
	const canonicalPaths = await Promise.all(
		filePaths.map(async (filePath) => {
			const resolved = path.resolve(filePath);
			try {
				return await fs.realpath(resolved);
			} catch {
				return resolved;
			}
		}),
	);
	const paths = [...new Set(canonicalPaths)].sort();

	const acquire = (index: number): Promise<T> => {
		const filePath = paths[index];
		if (!filePath) return fn();
		return withFileMutationQueue(filePath, () => acquire(index + 1));
	};

	return acquire(0);
}

// Parsed diff chunk: where to delete lines and insert new ones.
interface Chunk {
	origIndex: number;
	delLines: string[];
	insLines: string[];
}

// Parse a single V4A section into context + chunks, returning the next index.
function peekNextSection(
	lines: string[],
	startIndex: number,
): { context: string[]; chunks: Chunk[]; nextIndex: number; eof: boolean } {
	const old: string[] = [];
	let delLines: string[] = [];
	let insLines: string[] = [];
	const chunks: Chunk[] = [];

	let mode: "keep" | "add" | "delete" = "keep";
	const origIndex = startIndex;
	let index = startIndex;

	while (index < lines.length) {
		const s0 = lines[index]!;
		if (
			s0.startsWith("@@") ||
			s0.startsWith("*** End of File") ||
			s0.startsWith("*** End Patch") ||
			s0.startsWith("*** Update File:") ||
			s0.startsWith("*** Delete File:") ||
			s0.startsWith("*** Add File:")
		) {
			break;
		}
		if (s0 === "***") break;
		if (s0.startsWith("***")) throw new DiffError(`Invalid Line: ${s0}`);

		index++;
		const lastMode = mode;
		let s = s0;
		if (s === "") s = " ";

		const prefix = s[0];
		if (prefix === "+") mode = "add";
		else if (prefix === "-") mode = "delete";
		else if (prefix === " ") mode = "keep";
		else throw new DiffError(`Invalid Line: ${s0}`);

		s = s.slice(1);

		if (mode === "keep" && lastMode !== mode) {
			if (insLines.length > 0 || delLines.length > 0) {
				chunks.push({ origIndex: old.length - delLines.length, delLines, insLines });
				delLines = [];
				insLines = [];
			}
		}

		if (mode === "delete") {
			delLines.push(s);
			old.push(s);
		} else if (mode === "add") {
			insLines.push(s);
		} else {
			old.push(s);
		}
	}

	if (insLines.length > 0 || delLines.length > 0) {
		chunks.push({ origIndex: old.length - delLines.length, delLines, insLines });
	}

	if (index < lines.length && lines[index] === "*** End of File") {
		index++;
		return { context: old, chunks, nextIndex: index, eof: true };
	}

	if (index === origIndex) {
		throw new DiffError(`Nothing in this section - index=${index} line='${lines[index] ?? ""}'`);
	}

	return { context: old, chunks, nextIndex: index, eof: false };
}

// Find a matching context block in the target file, with fuzzy fallbacks.
function findContextCore(lines: string[], context: string[], start: number): { index: number; fuzz: number } {
	if (context.length === 0) return { index: start, fuzz: 0 };

	for (let i = start; i <= lines.length - context.length; i++) {
		let ok = true;
		for (let j = 0; j < context.length; j++) {
			if (lines[i + j] !== context[j]) {
				ok = false;
				break;
			}
		}
		if (ok) return { index: i, fuzz: 0 };
	}

	const rstrip = (s: string) => s.replace(/\s+$/g, "");
	for (let i = start; i <= lines.length - context.length; i++) {
		let ok = true;
		for (let j = 0; j < context.length; j++) {
			if (rstrip(lines[i + j]!) !== rstrip(context[j]!)) {
				ok = false;
				break;
			}
		}
		if (ok) return { index: i, fuzz: 1 };
	}

	const strip = (s: string) => s.trim();
	for (let i = start; i <= lines.length - context.length; i++) {
		let ok = true;
		for (let j = 0; j < context.length; j++) {
			if (strip(lines[i + j]!) !== strip(context[j]!)) {
				ok = false;
				break;
			}
		}
		if (ok) return { index: i, fuzz: 100 };
	}

	return { index: -1, fuzz: 0 };
}

// If the section is marked EOF, prefer matching near file end; otherwise match forward.
function findContext(lines: string[], context: string[], start: number, eof: boolean): { index: number; fuzz: number } {
	if (eof) {
		const atEof = findContextCore(lines, context, Math.max(0, lines.length - context.length));
		if (atEof.index !== -1) return atEof;
		const fallback = findContextCore(lines, context, start);
		return { index: fallback.index, fuzz: fallback.fuzz + 10000 };
	}
	return findContextCore(lines, context, start);
}

// Apply a V4A update diff to existing file content.
// Returns updated content plus a fuzz score when context matching was inexact.
function applyV4AUpdate(input: string, diff: string): { output: string; fuzz: number } {
	// IMPORTANT: do NOT trim() here. V4A diff lines may start with a leading space (context lines).
	const normalizedDiff = normalizeLineEndings(diff);
	const patchLines = normalizedDiff.split("\n");
	// Drop a single trailing newline to avoid creating an extra empty diff line.
	if (patchLines.length > 0 && patchLines[patchLines.length - 1] === "") patchLines.pop();

	const fileLines = normalizeLineEndings(input).split("\n");

	let fuzz = 0;
	const chunks: Chunk[] = [];
	let patchIndex = 0;
	let fileIndex = 0;

	while (patchIndex < patchLines.length) {
		// Section marker
		const line = patchLines[patchIndex] ?? "";
		let defStr = "";
		if (line.startsWith("@@ ")) {
			defStr = line.slice(3);
			patchIndex++;
		} else if (line === "@@") {
			patchIndex++;
		} else if (patchIndex === 0) {
			// Allow diffs without leading @@ (common in some examples)
		} else {
			throw new DiffError(`Invalid diff (expected @@ section): ${line}`);
		}

		if (defStr.trim()) {
			let found = false;
			if (!fileLines.slice(0, fileIndex).some((s) => s === defStr)) {
				for (let i = fileIndex; i < fileLines.length; i++) {
					if (fileLines[i] === defStr) {
						fileIndex = i + 1;
						found = true;
						break;
					}
				}
				if (!found && !fileLines.slice(0, fileIndex).some((s) => s.trim() === defStr.trim())) {
					for (let i = fileIndex; i < fileLines.length; i++) {
						if (fileLines[i]!.trim() === defStr.trim()) {
							fileIndex = i + 1;
							fuzz += 1;
							found = true;
							break;
						}
					}
				}
			}
		}

		const { context, chunks: sectionChunks, nextIndex, eof } = peekNextSection(patchLines, patchIndex);
		const nextChunkText = context.join("\n");
		const found = findContext(fileLines, context, fileIndex, eof);
		if (found.index === -1) {
			if (eof) throw new DiffError(`Invalid EOF Context ${fileIndex}:\n${nextChunkText}`);
			throw new DiffError(`Invalid Context ${fileIndex}:\n${nextChunkText}`);
		}

		fuzz += found.fuzz;
		for (const ch of sectionChunks) {
			chunks.push({
				origIndex: ch.origIndex + found.index,
				delLines: ch.delLines,
				insLines: ch.insLines,
			});
		}

		fileIndex = found.index + context.length;
		patchIndex = nextIndex;
	}

	// Apply chunks
	const dest: string[] = [];
	let origIndex = 0;
	for (const chunk of chunks) {
		if (origIndex > chunk.origIndex) {
			throw new DiffError(`applyDiff: origIndex ${origIndex} > chunk.origIndex ${chunk.origIndex}`);
		}

		dest.push(...fileLines.slice(origIndex, chunk.origIndex));
		origIndex = chunk.origIndex;

		const expected = chunk.delLines;
		const actual = fileLines.slice(origIndex, origIndex + expected.length);
		const same = expected.length === actual.length && expected.every((l, i) => l === actual[i]);
		if (!same) {
			throw new DiffError(
				`Patch conflict at line ${origIndex + 1}. Expected:\n${expected.join("\n")}\n\nActual:\n${actual.join("\n")}`,
			);
		}

		dest.push(...chunk.insLines);
		origIndex += expected.length;
	}
	// Tail
	dest.push(...fileLines.slice(origIndex));
	return { output: dest.join("\n"), fuzz };
}

// Apply a V4A create diff (every line starts with '+') and return file content.
function applyV4ACreate(diff: string): string {
	const lines = normalizeLineEndings(diff).split("\n");
	// Drop trailing empty line to avoid an extra empty content line.
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

	const out: string[] = [];
	for (const line of lines) {
		if (!line.startsWith("+")) {
			throw new DiffError(`Invalid create_file diff line (must start with '+'): ${line}`);
		}
		out.push(line.slice(1));
	}
	return out.join("\n");
}

// Generate the same compact numbered diff format used by Pi's built-in edit renderer.
function generateDiffString(oldContent: string, newContent: string, contextLines = 4): string {
	const parts = Diff.diffLines(normalizeLineEndings(oldContent), normalizeLineEndings(newContent)) as Array<{
		value: string;
		added?: boolean;
		removed?: boolean;
	}>;
	const output: string[] = [];
	const oldLines = normalizeLineEndings(oldContent).split("\n");
	const newLines = normalizeLineEndings(newContent).split("\n");
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;
	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]!;
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") raw.pop();

		if (part.added || part.removed) {
			for (const line of raw) {
				if (part.added) {
					const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
					output.push(`+${lineNum} ${line}`);
					newLineNum++;
				} else {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(`-${lineNum} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
			continue;
		}

		const nextPartIsChange = i < parts.length - 1 && (parts[i + 1]!.added || parts[i + 1]!.removed);
		const hasLeadingChange = lastWasChange;
		const hasTrailingChange = nextPartIsChange;
		if (hasLeadingChange && hasTrailingChange) {
			if (raw.length <= contextLines * 2) {
				for (const line of raw) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			} else {
				const leadingLines = raw.slice(0, contextLines);
				const trailingLines = raw.slice(raw.length - contextLines);
				const skippedLines = raw.length - leadingLines.length - trailingLines.length;
				for (const line of leadingLines) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skippedLines;
				newLineNum += skippedLines;
				for (const line of trailingLines) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			}
		} else if (hasLeadingChange) {
			const shownLines = raw.slice(0, contextLines);
			const skippedLines = raw.length - shownLines.length;
			for (const line of shownLines) {
				const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
				output.push(` ${lineNum} ${line}`);
				oldLineNum++;
				newLineNum++;
			}
			if (skippedLines > 0) {
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skippedLines;
				newLineNum += skippedLines;
			}
		} else if (hasTrailingChange) {
			const skippedLines = Math.max(0, raw.length - contextLines);
			if (skippedLines > 0) {
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skippedLines;
				newLineNum += skippedLines;
			}
			for (const line of raw.slice(skippedLines)) {
				const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
				output.push(` ${lineNum} ${line}`);
				oldLineNum++;
				newLineNum++;
			}
		} else {
			oldLineNum += raw.length;
			newLineNum += raw.length;
		}
		lastWasChange = false;
	}

	return output.join("\n");
}

// Atomic write using a temp file in the same directory. Best-effort mode preservation.
async function writeFileAtomic(abs: string, content: string, mode?: number): Promise<void> {
	const dir = path.dirname(abs);
	const base = path.basename(abs);
	const tmp = path.join(dir, `.${base}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`);

	await fs.writeFile(tmp, content, "utf8");
	if (typeof mode === "number") {
		try {
			await fs.chmod(tmp, mode);
		} catch {
			// ignore (best effort)
		}
	}

	try {
		await fs.rename(tmp, abs);
	} catch (err) {
		// Windows can fail rename() if the target exists.
		try {
			await fs.unlink(abs);
			await fs.rename(tmp, abs);
		} catch {
			try {
				await fs.unlink(tmp);
			} catch {
				// ignore
			}
			throw err;
		}
	}
}

// Apply operations sequentially. Each op reports its own success/failure; no rollback.
async function applyOperations(
	operations: ApplyPatchOperation[],
	cwd: string,
	signal?: AbortSignal,
	onProgress?: (message: string) => void,
): Promise<{ fuzz: number; results: ApplyPatchResult[] }> {
	const results: ApplyPatchResult[] = [];
	let fuzzTotal = 0;

	onProgress?.(`Applying ${operations.length} operation(s)...`);

	for (let i = 0; i < operations.length; i++) {
		if (signal?.aborted) throw new Error("Aborted");

		const op = operations[i]!;
		const type = op.type;

		let patchPath: string;
		let abs: string;
		let patchPathTo: string | undefined;
		let absTo: string | undefined;
		try {
			patchPath = validatePatchPath(op.path);
			abs = toFsPath(cwd, patchPath);
			if (type === "update_file" && op.move_path) {
				patchPathTo = validatePatchPath(op.move_path);
				absTo = toFsPath(cwd, patchPathTo);
			}
		} catch (err) {
			results.push({
				type,
				path: typeof op.path === "string" ? op.path : "(invalid)",
				status: "failed",
				output: err instanceof Error ? err.message : String(err),
			});
			continue;
		}

		onProgress?.(`${i + 1}/${operations.length} ${type} ${patchPath}`);

		try {
			const queuedPaths = absTo ? [abs, absTo] : [abs];
			const { fuzz, result } = await withFileMutationQueues(queuedPaths, async () => {
				if (signal?.aborted) throw new Error("Aborted");

				if (type === "create_file") {
					if (typeof op.diff !== "string") throw new DiffError(`create_file missing diff for ${patchPath}`);
					if (await fileExists(abs)) throw new DiffError(`File already exists at path '${patchPath}'`);

					const content = applyV4ACreate(op.diff);
					const renderedDiff = generateDiffString("", content);
					await fs.mkdir(path.dirname(abs), { recursive: true });
					await writeFileAtomic(abs, content);
					return { fuzz: 0, result: { type, path: patchPath, status: "completed" as const, diff: renderedDiff } };
				}

				if (type === "update_file") {
					if (typeof op.diff !== "string") throw new DiffError(`update_file missing diff for ${patchPath}`);
					if (!(await fileExists(abs))) throw new DiffError(`File not found at path '${patchPath}'`);

					const st = await fs.stat(abs);
					const current = await fs.readFile(abs, "utf8");
					const { output, fuzz } = applyV4AUpdate(current, op.diff);
					const renderedDiff = generateDiffString(current, output);

					if (patchPathTo && absTo) {
						if (await fileExists(absTo)) throw new DiffError(`Target already exists at path '${patchPathTo}'`);

						await fs.mkdir(path.dirname(absTo), { recursive: true });
						await writeFileAtomic(absTo, output, st.mode);
						await fs.unlink(abs);
						return { fuzz, result: { type, path: patchPathTo, status: "completed" as const, output: `Moved from ${patchPath}`, diff: renderedDiff } };
					}

					await fs.mkdir(path.dirname(abs), { recursive: true });
					await writeFileAtomic(abs, output, st.mode);
					return { fuzz, result: { type, path: patchPath, status: "completed" as const, diff: renderedDiff } };
				}

				if (type !== "delete_file") throw new DiffError(`Unknown operation type: ${type}`);
				if (!(await fileExists(abs))) throw new DiffError(`File not found at path '${patchPath}'`);
				let renderedDiff: string | undefined;
				try {
					const current = await fs.readFile(abs, "utf8");
					renderedDiff = generateDiffString(current, "");
				} catch {
					// Keep delete semantics unchanged when a diff cannot be produced (for example, unreadable files).
				}
				await fs.unlink(abs);
				return { fuzz: 0, result: { type, path: patchPath, status: "completed" as const, diff: renderedDiff } };
			});

			fuzzTotal += fuzz;
			results.push(result);
		} catch (err) {
			results.push({
				type,
				path: patchPath,
				status: "failed",
				output: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return { fuzz: fuzzTotal, results };
}

// UI helpers for rendering tool arguments/results without flooding the TUI.
function parseDiffLine(line: string): { prefix: string; lineNum: string; content: string } | null {
	const match = line.match(/^([+-\s])(\s*\d*)\s(.*)$/);
	if (!match) return null;
	return { prefix: match[1]!, lineNum: match[2]!, content: match[3]! };
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function renderIntraLineDiff(oldContent: string, newContent: string, theme: any): { removedLine: string; addedLine: string } {
	const wordDiff = Diff.diffWords(oldContent, newContent) as Array<{ value: string; added?: boolean; removed?: boolean }>;
	let removedLine = "";
	let addedLine = "";
	let isFirstRemoved = true;
	let isFirstAdded = true;

	for (const part of wordDiff) {
		if (part.removed) {
			let value = part.value;
			if (isFirstRemoved) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				removedLine += leadingWs;
				isFirstRemoved = false;
			}
			if (value) removedLine += theme.inverse(value);
		} else if (part.added) {
			let value = part.value;
			if (isFirstAdded) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				addedLine += leadingWs;
				isFirstAdded = false;
			}
			if (value) addedLine += theme.inverse(value);
		} else {
			removedLine += part.value;
			addedLine += part.value;
		}
	}

	return { removedLine, addedLine };
}

function renderDiff(diffText: string, theme: any): string {
	const lines = diffText.split("\n");
	const result: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i]!;
		const parsed = parseDiffLine(line);
		if (!parsed) {
			result.push(theme.fg("toolDiffContext", line));
			i++;
			continue;
		}

		if (parsed.prefix === "-") {
			const removedLines: Array<{ lineNum: string; content: string }> = [];
			while (i < lines.length) {
				const p = parseDiffLine(lines[i]!);
				if (!p || p.prefix !== "-") break;
				removedLines.push({ lineNum: p.lineNum, content: p.content });
				i++;
			}

			const addedLines: Array<{ lineNum: string; content: string }> = [];
			while (i < lines.length) {
				const p = parseDiffLine(lines[i]!);
				if (!p || p.prefix !== "+") break;
				addedLines.push({ lineNum: p.lineNum, content: p.content });
				i++;
			}

			if (removedLines.length === 1 && addedLines.length === 1) {
				const removed = removedLines[0]!;
				const added = addedLines[0]!;
				const { removedLine, addedLine } = renderIntraLineDiff(replaceTabs(removed.content), replaceTabs(added.content), theme);
				result.push(theme.fg("toolDiffRemoved", `-${removed.lineNum} ${removedLine}`));
				result.push(theme.fg("toolDiffAdded", `+${added.lineNum} ${addedLine}`));
			} else {
				for (const removed of removedLines) {
					result.push(theme.fg("toolDiffRemoved", `-${removed.lineNum} ${replaceTabs(removed.content)}`));
				}
				for (const added of addedLines) {
					result.push(theme.fg("toolDiffAdded", `+${added.lineNum} ${replaceTabs(added.content)}`));
				}
			}
		} else if (parsed.prefix === "+") {
			result.push(theme.fg("toolDiffAdded", `+${parsed.lineNum} ${replaceTabs(parsed.content)}`));
			i++;
		} else {
			result.push(theme.fg("toolDiffContext", ` ${parsed.lineNum} ${replaceTabs(parsed.content)}`));
			i++;
		}
	}

	return result.join("\n");
}

function truncateDiff(diff: string, maxLines: number): { diff: string; omitted: number } {
	const lines = diff.split("\n");
	if (lines.length <= maxLines) return { diff, omitted: 0 };
	return { diff: lines.slice(0, maxLines).join("\n"), omitted: lines.length - maxLines };
}

// Pull unique, validated paths from tool args (for compact call display).
function extractPathsFromOperations(ops: unknown): string[] {
	if (!Array.isArray(ops)) return [];
	const out: string[] = [];
	for (const o of ops) {
		if (!o || typeof o !== "object") continue;
		const p = (o as { path?: unknown }).path;
		if (typeof p !== "string") continue;
		try {
			out.push(validatePatchPath(p));
		} catch {
			// ignore
		}
	}
	return [...new Set(out)].slice(0, 20);
}

// Summarize tool args (op count, approx diff bytes, file paths) without rendering raw patch text.
function summarizeOperationsArgs(args: unknown): { opCount: number; approxBytes: number; paths: string[] } {
	const ops = (args as { operations?: unknown })?.operations;
	if (!Array.isArray(ops)) return { opCount: 0, approxBytes: 0, paths: [] };

	let bytes = 0;
	for (const o of ops) {
		if (!o || typeof o !== "object") continue;
		const diff = (o as { diff?: unknown }).diff;
		if (typeof diff === "string") bytes += Buffer.byteLength(diff, "utf8");
	}

	const paths = extractPathsFromOperations(ops);
	return { opCount: ops.length, approxBytes: bytes, paths };
}

function operationVerb(type: ApplyPatchOpType): string {
	if (type === "create_file") return "created";
	if (type === "update_file") return "updated";
	return "deleted";
}

function formatPlainResultLine(r: ApplyPatchResult): string {
	return `${r.status === "completed" ? "✓" : "✗"} ${operationVerb(r.type)} ${r.path}${r.output ? ` — ${r.output}` : ""}`;
}

function renderResultDetails(results: ApplyPatchResult[], expanded: boolean, theme: any): string {
	const maxDiffLines = expanded ? RESULT_DIFF_EXPANDED_MAX_LINES : RESULT_DIFF_MAX_LINES;
	return results
		.map((r) => {
			const status = r.status === "completed" ? theme.fg("success", "✓") : theme.fg("error", "✗");
			const title = `${status} ${operationVerb(r.type)} ${theme.fg("accent", r.path)}${r.output ? theme.fg("muted", ` — ${r.output}`) : ""}`;
			if (!r.diff) return title;

			const { diff, omitted } = truncateDiff(r.diff, maxDiffLines);
			let body = renderDiff(diff, theme);
			if (omitted > 0) {
				body += "\n" + theme.fg("muted", `... (${omitted} more diff lines hidden${expanded ? "" : "; expand for more"})`);
			}
			return `${title}\n${body}`;
		})
		.join("\n\n");
}

const ApplyPatchParams = Type.Object({
	operations: Type.Array(
		Type.Object({
			type: StringEnum(["create_file", "update_file", "delete_file"] as const),
			path: Type.String({ description: "Path to create/update/delete. Relative paths resolve inside the current workspace; POSIX absolute paths are allowed. A leading @ is accepted and stripped." }),
			diff: Type.Optional(
				Type.String({
					description:
						"For create_file, full file content with every line prefixed by '+'. For update_file, a V4A diff with @@ sections and +/-/space-prefixed lines.",
				}),
			),
			move_path: Type.Optional(Type.String({ description: "Optional destination path for update_file moves. Relative paths resolve inside the current workspace; POSIX absolute paths are allowed." })),
		}),
	),
});

// Extension wiring: register only the apply_patch tool. Built-in edit/write stay enabled.
export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "apply_patch",
		label: "apply_patch",
		description:
			"Apply structured patch operations (create_file, update_file, delete_file) using V4A diffs. Available alongside Pi's built-in edit/write tools.",
		promptSnippet: "Apply structured file patch operations (create_file, update_file, delete_file) using V4A diffs.",
		promptGuidelines: [
			"Use apply_patch when a structured create/update/delete file patch is clearer than direct edit/write; Pi's built-in edit and write tools remain available.",
			"For apply_patch create_file, every diff line must start with '+'. For update_file, use V4A @@ sections with '+', '-', and space-prefixed context lines. For delete_file, omit diff.",
			"Paths may be relative to the current workspace or POSIX absolute; sandbox/OS policy controls whether absolute writes are allowed.",
		],
		parameters: ApplyPatchParams,

		renderCall(args, theme, context) {
			// Hide the call block after execution starts so the final row is just Done + rendered file diffs.
			if (context?.executionStarted) return new Text("", 0, 0);

			const { opCount, approxBytes, paths } = summarizeOperationsArgs(args);
			let out = theme.fg("toolTitle", theme.bold("apply_patch"));
			out += theme.fg("muted", ` (${opCount} op(s), ~${approxBytes} diff bytes)`);

			if (paths.length > 0) {
				const shown = paths.slice(0, 8);
				const more = paths.length > shown.length ? ` (+${paths.length - shown.length} more)` : "";
				out += "\n" + theme.fg("muted", `Paths: ${shown.join(", ")}${more}`);
			} else {
				out += "\n" + theme.fg("muted", "(waiting for operations)");
			}

			return new Text(out, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as ApplyPatchDetails | undefined;
			if (isPartial) {
				const msg = details?.stage === "progress" ? details.message : "Working...";
				return new Text(theme.fg("warning", msg), 0, 0);
			}

			if (details?.stage === "done") {
				const failed = details.results.filter((r) => r.status === "failed").length;
				const notes: string[] = [];
				if (details.fuzz !== 0) notes.push(`fuzz=${details.fuzz}`);
				if (failed > 0) notes.push(`${failed} failed`);

				let text = theme.fg("success", "✓ Done");
				if (notes.length > 0) text += theme.fg("muted", ` — ${notes.join(", ")}`);

				const detailText = renderResultDetails(details.results, expanded, theme);
				if (detailText) text += "\n\n" + detailText;
				return new Text(text, 0, 0);
			}

			// Fallback
			let output = "";
			for (const c of result.content ?? []) {
				if (c && typeof c === "object" && (c as { type?: unknown }).type === "text") {
					const t = (c as { text?: unknown }).text;
					if (typeof t === "string" && t) output += (output ? "\n" : "") + t;
				}
			}
			return new Text(output ? theme.fg("toolOutput", output) : theme.fg("muted", "(no output)"), 0, 0);
		},

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const update = onUpdate as AgentToolUpdateCallback<ApplyPatchDetails> | undefined;

			progress(update, "Applying patch operations...");

			try {
				const ops = params.operations as ApplyPatchOperation[];
				const { fuzz, results } = await applyOperations(ops, ctx.cwd, signal, (msg) => progress(update, msg));

				const summaryLines = results.map(formatPlainResultLine).join("\n");
				return {
					content: [{ type: "text", text: `Done. Fuzz=${fuzz}.\nFiles:\n${summaryLines}` }],
					details: { stage: "done", fuzz, results } as ApplyPatchDetails,
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: msg }],
					details: {
						stage: "done",
						fuzz: 0,
						results: [{ type: "update_file", path: "(unknown)", status: "failed", output: msg }],
					} as ApplyPatchDetails,
				};
			}
		},
	});
}
