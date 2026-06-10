import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export type ActionType = "add" | "delete" | "update";
export type ParseMode = "keep" | "add" | "delete";

export interface Chunk {
	origIndex: number;
	delLines: string[];
	insLines: string[];
}

export interface PatchAction {
	type: ActionType;
	newFile?: string | undefined;
	chunks: Chunk[];
	movePath?: string | undefined;
}

export interface ParsedPatchAction {
	type: ActionType;
	path: string;
	newFile?: string | undefined;
	lines?: string[] | undefined;
	movePath?: string | undefined;
}

export interface ParserState {
	lines: string[];
	index: number;
	fuzz: number;
}

export interface ExecutePatchResult {
	changedFiles: string[];
	createdFiles: string[];
	deletedFiles: string[];
	movedFiles: string[];
	fuzz: number;
}

export interface ExecutePatchFailure {
	action: ParsedPatchAction;
	message: string;
}

export class DiffError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiffError";
	}
}

export class ExecutePatchError extends DiffError {
	result: ExecutePatchResult;
	failedAction?: ParsedPatchAction | undefined;
	failures: ExecutePatchFailure[];

	constructor(message: string, result: ExecutePatchResult, failures: ExecutePatchFailure[] = []) {
		super(message);
		this.name = "ExecutePatchError";
		this.result = result;
		this.failures = failures;
		this.failedAction = failures[0]?.action;
	}

	hasPartialSuccess(): boolean {
		return (
			this.result.changedFiles.length > 0 ||
			this.result.createdFiles.length > 0 ||
			this.result.deletedFiles.length > 0 ||
			this.result.movedFiles.length > 0 ||
			this.result.fuzz > 0
		);
	}
}

export function normalizePatchPath({ path }: { path: string }): string {
	const trimmed = path.trim();
	const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
	return withoutAt.replace(/^['\"]|['\"]$/g, "");
}

export function resolvePatchPath({ cwd, patchPath }: { cwd: string; patchPath: string }): string {
	const normalized = normalizePatchPath({ path: patchPath });
	if (!normalized) {
		throw new DiffError("Patch path cannot be empty");
	}

	return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

export function openFileAtPath({ cwd, path }: { cwd: string; path: string }): string {
	const absolutePath = resolvePatchPath({ cwd, patchPath: path });
	if (!existsSync(absolutePath)) {
		throw new DiffError(`File not found: ${path}`);
	}
	return readFileSync(absolutePath, "utf8");
}

export function writeFileAtPath({ cwd, path, content }: { cwd: string; path: string; content: string }): { created: boolean } {
	const absolutePath = resolvePatchPath({ cwd, patchPath: path });
	const created = !existsSync(absolutePath);
	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, content, "utf8");
	return { created };
}

export function removeFileAtPath({ cwd, path }: { cwd: string; path: string }): void {
	const absolutePath = resolvePatchPath({ cwd, patchPath: path });
	if (!existsSync(absolutePath)) {
		throw new DiffError(`File not found: ${path}`);
	}
	unlinkSync(absolutePath);
}

export function pathExists({ cwd, path }: { cwd: string; path: string }): boolean {
	return existsSync(resolvePatchPath({ cwd, patchPath: path }));
}

export function lineMatchFuzz(left: string, right: string): number | undefined {
	if (left === right) return 0;
	if (left.trimEnd() === right.trimEnd()) return 1;
	if (left.trim() === right.trim()) return 100;
	return undefined;
}

export function linesMatch(left: string, right: string): boolean {
	return left === right || left.trimEnd() === right.trimEnd();
}

export function linesEqualFuzz({ left, right }: { left: string[]; right: string[] }): { fuzz: number; worstLineFuzz: number } | undefined {
	if (left.length !== right.length) return undefined;

	let fuzz = 0;
	let worstLineFuzz = 0;
	for (let index = 0; index < left.length; index++) {
		const lineFuzz = lineMatchFuzz(left[index]!, right[index]!);
		if (lineFuzz === undefined) return undefined;
		fuzz += lineFuzz;
		worstLineFuzz = Math.max(worstLineFuzz, lineFuzz);
	}

	return { fuzz, worstLineFuzz };
}

function parserIsDone({ state, prefixes }: { state: ParserState; prefixes?: string[] | undefined }): boolean {
	if (state.index >= state.lines.length) {
		return true;
	}
	if (prefixes && prefixes.some((prefix) => state.lines[state.index]!.startsWith(prefix))) {
		return true;
	}
	return false;
}

function parserReadStr({
	state,
	prefix,
	returnEverything,
}: {
	state: ParserState;
	prefix?: string | undefined;
	returnEverything?: boolean | undefined;
}): string {
	if (state.index >= state.lines.length) {
		throw new DiffError(`Index: ${state.index} >= ${state.lines.length}`);
	}

	const expectedPrefix = prefix ?? "";
	if (state.lines[state.index]!.startsWith(expectedPrefix)) {
		const text = returnEverything ? state.lines[state.index]! : state.lines[state.index]!.slice(expectedPrefix.length);
		state.index += 1;
		return text;
	}
	return "";
}

function splitFileLines(text: string): string[] {
	const lines = text.split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}
	return lines;
}

function joinFileLines(lines: string[], hadTrailingNewline: boolean): string {
	if (lines.length === 0) return "";
	const joined = lines.join("\n");
	return hadTrailingNewline ? `${joined}\n` : joined;
}

function findContextCore({ lines, context, start }: { lines: string[]; context: string[]; start: number }): {
	newIndex: number;
	fuzz: number;
} {
	if (context.length === 0) {
		return { newIndex: start, fuzz: 0 };
	}

	for (const tier of [0, 1, 100]) {
		for (let index = start; index <= lines.length - context.length; index++) {
			const quality = linesEqualFuzz({ left: lines.slice(index, index + context.length), right: context });
			if (quality?.worstLineFuzz === tier) {
				return { newIndex: index, fuzz: quality.fuzz };
			}
		}
	}

	return { newIndex: -1, fuzz: 0 };
}

function findSectionAnchor({ lines, target, start }: { lines: string[]; target: string; start: number }): { newIndex: number; fuzz: number } {
	for (const tier of [0, 1, 100]) {
		const alreadySeen = lines.slice(0, start).some((line) => lineMatchFuzz(line, target) === tier);
		if (alreadySeen) {
			continue;
		}

		for (let index = start; index < lines.length; index++) {
			const fuzz = lineMatchFuzz(lines[index]!, target);
			if (fuzz === tier) {
				return { newIndex: index, fuzz };
			}
		}
	}

	return { newIndex: -1, fuzz: 0 };
}

function findContext({
	lines,
	context,
	start,
	eof,
}: {
	lines: string[];
	context: string[];
	start: number;
	eof: boolean;
}): { newIndex: number; fuzz: number } {
	if (eof) {
		const nearEnd = Math.max(lines.length - context.length, 0);
		const preferred = findContextCore({ lines, context, start: nearEnd });
		if (preferred.newIndex !== -1) {
			return preferred;
		}
		const fallback = findContextCore({ lines, context, start });
		return { newIndex: fallback.newIndex, fuzz: fallback.fuzz + 10000 };
	}
	return findContextCore({ lines, context, start });
}

function peekNextSection({ lines, index }: { lines: string[]; index: number }): {
	nextChunkContext: string[];
	chunks: Chunk[];
	endPatchIndex: number;
	eof: boolean;
} {
	const old: string[] = [];
	let delLines: string[] = [];
	let insLines: string[] = [];
	const chunks: Chunk[] = [];
	let mode: ParseMode = "keep";
	const origIndex = index;

	while (index < lines.length) {
		const rawLine = lines[index]!;
		if (rawLine.startsWith("@@") || rawLine.startsWith("*** End of File")) {
			break;
		}

		if (rawLine === "***") {
			break;
		}
		if (rawLine.startsWith("***")) {
			throw new DiffError(`Invalid Line: ${rawLine}`);
		}

		index += 1;
		const lastMode: ParseMode = mode;
		let line = rawLine;
		if (line === "") {
			line = " ";
		}

		if (line[0] === "+") {
			mode = "add";
		} else if (line[0] === "-") {
			mode = "delete";
		} else if (line[0] === " ") {
			mode = "keep";
		} else {
			throw new DiffError(`Invalid Line: ${line}`);
		}

		const value = line.slice(1);
		if (mode === "keep" && lastMode !== mode) {
			if (insLines.length > 0 || delLines.length > 0) {
				chunks.push({
					origIndex: old.length - delLines.length,
					delLines,
					insLines,
				});
			}
			delLines = [];
			insLines = [];
		}

		if (mode === "delete") {
			delLines.push(value);
			old.push(value);
		} else if (mode === "add") {
			insLines.push(value);
		} else {
			old.push(value);
		}
	}

	if (insLines.length > 0 || delLines.length > 0) {
		chunks.push({
			origIndex: old.length - delLines.length,
			delLines,
			insLines,
		});
	}

	if (index < lines.length && lines[index] === "*** End of File") {
		return {
			nextChunkContext: old,
			chunks,
			endPatchIndex: index + 1,
			eof: true,
		};
	}

	if (index === origIndex) {
		throw new DiffError(`Nothing in this section - index=${index} ${lines[index] ?? ""}`);
	}

	return {
		nextChunkContext: old,
		chunks,
		endPatchIndex: index,
		eof: false,
	};
}

function parseAddFile({ state }: { state: ParserState }): PatchAction {
	const lines: string[] = [];
	while (!parserIsDone({ state, prefixes: ["*** End Patch", "*** Update File:", "*** Delete File:", "*** Add File:"] })) {
		const value = parserReadStr({ state, prefix: "" });
		if (!value.startsWith("+")) {
			throw new DiffError(`Invalid Add File Line: ${value}`);
		}
		lines.push(value.slice(1));
	}

	return {
		type: "add",
		newFile: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
		chunks: [],
	};
}

function parseUpdateFile({ state, text, path }: { state: ParserState; text: string; path: string }): PatchAction {
	const action: PatchAction = {
		type: "update",
		chunks: [],
	};

	const lines = splitFileLines(text);
	let index = 0;

	while (!parserIsDone({ state, prefixes: ["*** End of File"] })) {
		const defStr = parserReadStr({ state, prefix: "@@ " });
		let sectionStr = "";
		if (!defStr && state.index < state.lines.length && state.lines[state.index] === "@@") {
			sectionStr = state.lines[state.index]!;
			state.index += 1;
		}

		if (!(defStr || sectionStr || index === 0)) {
			throw new DiffError(`Invalid Line:\n${state.lines[state.index]!}`);
		}

		if (defStr.trim().length > 0) {
			const sectionAnchor = findSectionAnchor({ lines, target: defStr, start: index });
			if (sectionAnchor.newIndex !== -1) {
				index = sectionAnchor.newIndex + 1;
				state.fuzz += sectionAnchor.fuzz;
			} else {
				throw new DiffError(`Failed to find section anchor in ${path}: ${defStr}`);
			}
		}

		const { nextChunkContext, chunks, endPatchIndex, eof } = peekNextSection({ lines: state.lines, index: state.index });
		const nextChunkText = nextChunkContext.join("\n");
		const { newIndex, fuzz } = findContext({
			lines,
			context: nextChunkContext,
			start: index,
			eof,
		});

		if (newIndex === -1) {
			throw new DiffError(`Failed to find expected lines in ${path}:\n${nextChunkText}`);
		}

		state.fuzz += fuzz;

		for (const chunk of chunks) {
			action.chunks.push({
				origIndex: chunk.origIndex + newIndex,
				delLines: chunk.delLines,
				insLines: chunk.insLines,
			});
		}

		index = newIndex + nextChunkContext.length;
		state.index = endPatchIndex;
	}

	return action;
}

const VALID_HUNK_HEADERS = [
	"'*** Add File: {path}'",
	"'*** Delete File: {path}'",
	"'*** Update File: {path}'",
].join(", ");

export function parsePatchActions({ text }: { text: string }): ParsedPatchAction[] {
	const lines = text.trim().split("\n");
	if (lines.length < 2 || !lines[0]!.startsWith("*** Begin Patch") || lines[lines.length - 1] !== "*** End Patch") {
		throw new DiffError("Invalid patch text");
	}

	const actions: ParsedPatchAction[] = [];
	const seenPaths = new Set<string>();
	let index = 1;

	while (index < lines.length - 1) {
		const line = lines[index]!;
		const lineNumber = index + 1;

		if (line.startsWith("*** Update File: ")) {
			const updatePath = normalizePatchPath({ path: line.slice("*** Update File: ".length) });
			if (seenPaths.has(updatePath)) {
				throw new DiffError(`Update File Error: Duplicate Path: ${updatePath}`);
			}
			seenPaths.add(updatePath);
			index += 1;
			let movePath: string | undefined;
			if (index < lines.length - 1 && lines[index]!.startsWith("*** Move to: ")) {
				movePath = normalizePatchPath({ path: lines[index]!.slice("*** Move to: ".length) });
				index += 1;
			}
			const bodyStart = index;
			while (
				index < lines.length - 1 &&
				!lines[index]!.startsWith("*** Update File: ") &&
				!lines[index]!.startsWith("*** Delete File: ") &&
				!lines[index]!.startsWith("*** Add File: ")
			) {
				index += 1;
			}
			const bodyLines = lines.slice(bodyStart, index);
			if (bodyLines.length === 0) {
				throw new DiffError(`Invalid patch hunk on line ${lineNumber}: Update file hunk for path '${updatePath}' is empty`);
			}
			actions.push({
				type: "update",
				path: updatePath,
				movePath,
				lines: bodyLines,
			});
			continue;
		}

		if (line.startsWith("*** Delete File: ")) {
			const deletePath = normalizePatchPath({ path: line.slice("*** Delete File: ".length) });
			if (seenPaths.has(deletePath)) {
				throw new DiffError(`Delete File Error: Duplicate Path: ${deletePath}`);
			}
			seenPaths.add(deletePath);
			actions.push({
				type: "delete",
				path: deletePath,
			});
			index += 1;
			continue;
		}

		if (line.startsWith("*** Add File: ")) {
			const addPath = normalizePatchPath({ path: line.slice("*** Add File: ".length) });
			if (seenPaths.has(addPath)) {
				throw new DiffError(`Add File Error: Duplicate Path: ${addPath}`);
			}
			seenPaths.add(addPath);
			const state: ParserState = {
				lines,
				index: index + 1,
				fuzz: 0,
			};
			const action = parseAddFile({ state });
			actions.push({
				type: "add",
				path: addPath,
				newFile: action.newFile,
			});
			index = state.index;
			continue;
		}

		throw new DiffError(
			`Invalid patch hunk on line ${lineNumber}: '${line}' is not a valid hunk header. Valid hunk headers: ${VALID_HUNK_HEADERS}`,
		);
	}

	if (actions.length === 0) {
		throw new DiffError("No files were modified.");
	}

	return actions;
}

function addUnique(values: string[], value: string | undefined): void {
	if (!value) return;
	if (!values.includes(value)) values.push(value);
}

function applyChunksToLines(lines: string[], chunks: Chunk[], path: string): string[] {
	const next: string[] = [];
	let cursor = 0;

	for (const chunk of chunks) {
		if (chunk.origIndex < cursor) {
			throw new DiffError(`Overlapping patch chunks in ${path}`);
		}
		next.push(...lines.slice(cursor, chunk.origIndex));
		const actual = lines.slice(chunk.origIndex, chunk.origIndex + chunk.delLines.length);
		if (actual.length !== chunk.delLines.length) {
			throw new DiffError(`Failed to apply patch in ${path}: deletion length mismatch`);
		}
		for (let index = 0; index < chunk.delLines.length; index++) {
			if (!linesMatch(actual[index]!, chunk.delLines[index]!)) {
				throw new DiffError(`Failed to apply patch in ${path}: expected '${chunk.delLines[index]}'`);
			}
		}
		next.push(...chunk.insLines);
		cursor = chunk.origIndex + chunk.delLines.length;
	}

	next.push(...lines.slice(cursor));
	return next;
}

function applyUpdateAction({ cwd, action, result }: { cwd: string; action: ParsedPatchAction; result: ExecutePatchResult }): void {
	const sourcePath = action.path;
	const originalText = openFileAtPath({ cwd, path: sourcePath });
	const state: ParserState = {
		lines: action.lines ?? [],
		index: 0,
		fuzz: 0,
	};
	const parsed = parseUpdateFile({ state, text: originalText, path: sourcePath });
	parsed.movePath = action.movePath;
	const originalLines = splitFileLines(originalText);
	const nextLines = applyChunksToLines(originalLines, parsed.chunks, sourcePath);
	const nextText = joinFileLines(nextLines, originalText.endsWith("\n"));
	const targetPath = parsed.movePath ?? sourcePath;

	if (parsed.movePath && parsed.movePath !== sourcePath && pathExists({ cwd, path: parsed.movePath })) {
		throw new DiffError(`Move target already exists: ${parsed.movePath}`);
	}

	writeFileAtPath({ cwd, path: targetPath, content: nextText });
	if (parsed.movePath && parsed.movePath !== sourcePath) {
		removeFileAtPath({ cwd, path: sourcePath });
		addUnique(result.movedFiles, parsed.movePath);
		addUnique(result.changedFiles, sourcePath);
	}
	addUnique(result.changedFiles, targetPath);
	result.fuzz += state.fuzz;
}

function applyAddAction({ cwd, action, result }: { cwd: string; action: ParsedPatchAction; result: ExecutePatchResult }): void {
	if (pathExists({ cwd, path: action.path })) {
		throw new DiffError(`Add File Error: File already exists: ${action.path}`);
	}
	writeFileAtPath({ cwd, path: action.path, content: action.newFile ?? "" });
	addUnique(result.changedFiles, action.path);
	addUnique(result.createdFiles, action.path);
}

function applyDeleteAction({ cwd, action, result }: { cwd: string; action: ParsedPatchAction; result: ExecutePatchResult }): void {
	removeFileAtPath({ cwd, path: action.path });
	addUnique(result.changedFiles, action.path);
	addUnique(result.deletedFiles, action.path);
}

export function executePatch({ cwd, patchText }: { cwd: string; patchText: string }): ExecutePatchResult {
	const actions = parsePatchActions({ text: patchText });
	const result: ExecutePatchResult = {
		changedFiles: [],
		createdFiles: [],
		deletedFiles: [],
		movedFiles: [],
		fuzz: 0,
	};

	for (const action of actions) {
		try {
			if (action.type === "add") {
				applyAddAction({ cwd, action, result });
				continue;
			}
			if (action.type === "delete") {
				applyDeleteAction({ cwd, action, result });
				continue;
			}
			applyUpdateAction({ cwd, action, result });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new ExecutePatchError(message, result, [{ action, message }]);
		}
	}

	return result;
}
