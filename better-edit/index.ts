import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	createEditToolDefinition,
	getAgentDir,
	withFileMutationQueue,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildAdvisedEditErrorMessage,
	prepareAdvisedEditArgumentsWithWarnings,
	validateAdvisedEditInput,
	type ValidatedEditInput,
} from "./diagnostics.ts";

const COMMAND = "better-edit";
const CONFIG_PATH = join(getAgentDir(), "better-edit.json");
const ERROR_LOG_PATH = join(getAgentDir(), "logs", "better-edit-errors.ndjson");

interface BetterEditConfig {
	enabled: boolean;
}

function defaultConfig(): BetterEditConfig {
	return { enabled: true };
}

function normalizeConfig(raw: unknown): BetterEditConfig {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultConfig();
	return {
		enabled: typeof (raw as { enabled?: unknown }).enabled === "boolean" ? Boolean((raw as { enabled: boolean }).enabled) : true,
	};
}

async function loadConfig(): Promise<BetterEditConfig> {
	try {
		return normalizeConfig(JSON.parse(await readFile(CONFIG_PATH, "utf8")));
	} catch {
		return defaultConfig();
	}
}

async function saveConfig(config: BetterEditConfig): Promise<void> {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(normalizeConfig(config), null, "\t")}\n`, "utf8");
}

export function parseCommandMode(args: string): "on" | "off" | "toggle" | "status" | undefined {
	const normalized = args.trim().toLowerCase();
	if (!normalized) return "status";
	if (["on", "enable", "enabled", "yes", "1"].includes(normalized)) return "on";
	if (["off", "disable", "disabled", "no", "0"].includes(normalized)) return "off";
	if (["toggle", "switch"].includes(normalized)) return "toggle";
	if (["status", "state", "show"].includes(normalized)) return "status";
	return undefined;
}

function buildStatus(config: BetterEditConfig): string {
	return `${COMMAND} ${config.enabled ? "on" : "off"}`;
}

function serializeLogError(error: unknown): { name?: string; message: string; stack?: string } {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return { message: String(error) };
}

async function logExecutionError({
	toolCallId,
	ctx,
	validated,
	rawInput,
	hiddenWarnings,
	error,
}: {
	toolCallId: string;
	ctx: ExtensionContext;
	validated: ValidatedEditInput;
	rawInput: unknown;
	hiddenWarnings: string[];
	error: unknown;
}): Promise<void> {
	const entry = {
		timestamp: new Date().toISOString(),
		toolCallId,
		cwd: ctx.cwd,
		modelId: typeof ctx.model?.id === "string" ? ctx.model.id : undefined,
		path: validated.path,
		edits: validated.edits,
		rawInput,
		hiddenWarnings,
		error: serializeLogError(error),
	};

	try {
		await mkdir(dirname(ERROR_LOG_PATH), { recursive: true });
		await withFileMutationQueue(ERROR_LOG_PATH, async () => {
			await appendFile(ERROR_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
		});
	} catch {
		// Ignore logging failures; they should not mask the edit error.
	}
}

function buildWarningKey(input: unknown): string | undefined {
	try {
		return JSON.stringify(input);
	} catch {
		return undefined;
	}
}

function appendHiddenWarningsToContent(
	result: { content?: Array<{ type: string; text?: string | undefined }>; details?: unknown },
	warnings: string[],
) {
	if (warnings.length === 0 || !Array.isArray(result.content)) return result;
	const firstTextIndex = result.content.findIndex((item) => item?.type === "text");
	if (firstTextIndex === -1) return result;
	const nextContent = [...result.content];
	const current = nextContent[firstTextIndex]!;
	const baseText = typeof current.text === "string" ? current.text : "";
	nextContent[firstTextIndex] = {
		...current,
		text: [
			baseText,
			"",
			"Input advisory for future edit calls:",
			...warnings.map((warning) => `- ${warning}`),
		].join("\n"),
	};
	return {
		...result,
		content: nextContent,
	};
}

function stripHiddenWarningsFromResult(
	result: { content?: Array<{ type: string; text?: string | undefined }>; details?: unknown },
) {
	if (!Array.isArray(result.content)) return result;
	const firstTextIndex = result.content.findIndex((item) => item?.type === "text" && typeof item.text === "string");
	if (firstTextIndex === -1) return result;
	const current = result.content[firstTextIndex]!;
	const text = current.text ?? "";
	const marker = "\n\nInput advisory for future edit calls:\n";
	const markerIndex = text.indexOf(marker);
	if (markerIndex === -1) return result;
	const nextContent = [...result.content];
	nextContent[firstTextIndex] = {
		...current,
		text: text.slice(0, markerIndex),
	};
	return {
		...result,
		content: nextContent,
	};
}

function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function detectLineEnding(content: string): "\r\n" | "\n" {
	const crlfIndex = content.indexOf("\r\n");
	const lfIndex = content.indexOf("\n");
	if (lfIndex === -1 || crlfIndex === -1) return "\n";
	return crlfIndex < lfIndex ? "\r\n" : "\n";
}

function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

function resolveToCwd(filePath: string, cwd: string): string {
	const withoutAtPrefix = filePath.startsWith("@") ? filePath.slice(1) : filePath;
	const expandedPath = withoutAtPrefix === "~" ? homedir() : withoutAtPrefix.startsWith("~/") ? join(homedir(), withoutAtPrefix.slice(2)) : withoutAtPrefix;
	return isAbsolute(expandedPath) ? expandedPath : resolve(cwd, expandedPath);
}

function findAllOccurrenceIndexes(haystack: string, needle: string): number[] {
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

function getNotFoundError(input: ValidatedEditInput, editIndex: number): Error {
	if (input.edits.length === 1) {
		return new Error(`Could not find the exact text in ${input.path}. The old text must match exactly including all whitespace and newlines.`);
	}
	return new Error(`Could not find edits[${editIndex}] in ${input.path}. The oldText must match exactly including all whitespace and newlines.`);
}

interface ReplaceAllMutationResult {
	rawContent: string;
	content: string;
	newContent: string;
	occurrences: number;
	originalEnding: "\r\n" | "\n";
}

function applyReplaceAllToNormalizedContent(normalizedContent: string, input: ValidatedEditInput): { newContent: string; occurrences: number } {
	const normalizedEdits = input.edits.map((edit) => ({
		oldText: normalizeToLF(edit.oldText),
		newText: normalizeToLF(edit.newText),
	}));
	const matchedEdits: Array<{ editIndex: number; matchIndex: number; matchLength: number; newText: string }> = [];

	for (let editIndex = 0; editIndex < normalizedEdits.length; editIndex += 1) {
		const edit = normalizedEdits[editIndex]!;
		if (edit.oldText.length === 0) {
			throw new Error(
				input.edits.length === 1
					? `oldText must not be empty in ${input.path}.`
					: `edits[${editIndex}].oldText must not be empty in ${input.path}.`,
			);
		}

		const indexes = findAllOccurrenceIndexes(normalizedContent, edit.oldText);
		if (indexes.length === 0) throw getNotFoundError(input, editIndex);
		for (const matchIndex of indexes) {
			matchedEdits.push({ editIndex, matchIndex, matchLength: edit.oldText.length, newText: edit.newText });
		}
	}

	matchedEdits.sort((left, right) => left.matchIndex - right.matchIndex || left.editIndex - right.editIndex);
	for (let index = 1; index < matchedEdits.length; index += 1) {
		const previous = matchedEdits[index - 1]!;
		const current = matchedEdits[index]!;
		if (previous.matchIndex + previous.matchLength > current.matchIndex) {
			throw new Error(`edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${input.path}. Merge them into one edit or target disjoint regions.`);
		}
	}

	let newContent = normalizedContent;
	for (let index = matchedEdits.length - 1; index >= 0; index -= 1) {
		const edit = matchedEdits[index]!;
		newContent = newContent.slice(0, edit.matchIndex) + edit.newText + newContent.slice(edit.matchIndex + edit.matchLength);
	}
	if (newContent === normalizedContent) {
		throw new Error(
			input.edits.length === 1
				? `No changes made to ${input.path}. The replacement produced identical content.`
				: `No changes made to ${input.path}. The replacements produced identical content.`,
		);
	}

	return { newContent, occurrences: matchedEdits.length };
}

function formatFileError(path: string, error: unknown): Error {
	const errorMessage = error instanceof Error && "code" in error ? `Error code: ${(error as Error & { code: unknown }).code}` : String(error);
	return new Error(`Could not edit file: ${path}. ${errorMessage}.`);
}

async function mutateReplaceAll(input: ValidatedEditInput, signal: AbortSignal | undefined, ctx: ExtensionContext): Promise<ReplaceAllMutationResult> {
	const absolutePath = resolveToCwd(input.path, ctx.cwd);
	return withFileMutationQueue(absolutePath, async () => {
		const throwIfAborted = () => {
			if (signal?.aborted) throw new Error("Operation aborted");
		};

		throwIfAborted();
		let rawContent: string;
		try {
			rawContent = await readFile(absolutePath, "utf8");
		} catch (error) {
			throw formatFileError(input.path, error);
		}
		throwIfAborted();

		const { bom, text: content } = stripBom(rawContent);
		const originalEnding = detectLineEnding(content);
		const baseContent = normalizeToLF(content);
		const { newContent, occurrences } = applyReplaceAllToNormalizedContent(baseContent, input);
		await writeFile(absolutePath, bom + restoreLineEndings(newContent, originalEnding), "utf8");
		throwIfAborted();
		return { rawContent, content, newContent, occurrences, originalEnding };
	});
}

async function buildBuiltinReplaceAllResult(
	toolCallId: string,
	input: ValidatedEditInput,
	mutation: ReplaceAllMutationResult,
	signal: AbortSignal | undefined,
	onUpdate: unknown,
	ctx: ExtensionContext,
) {
	const inMemoryBase = createEditToolDefinition(ctx.cwd, {
		operations: {
			access: async () => undefined,
			readFile: async () => Buffer.from(mutation.rawContent, "utf8"),
			writeFile: async () => undefined,
		},
	});
	const result = await inMemoryBase.execute(
		toolCallId,
		{
			path: input.path,
			edits: [{ oldText: mutation.content, newText: restoreLineEndings(mutation.newContent, mutation.originalEnding) }],
		},
		signal,
		onUpdate as never,
		ctx,
	);
	const firstTextIndex = result.content.findIndex((item) => item.type === "text");
	if (firstTextIndex === -1) return result;
	const nextContent = [...result.content];
	nextContent[firstTextIndex] = {
		...nextContent[firstTextIndex]!,
		text: `Successfully replaced ${mutation.occurrences} occurrence(s) across ${input.edits.length} edit(s) in ${input.path}.`,
	};
	return { ...result, content: nextContent };
}

async function executeReplaceAll(
	toolCallId: string,
	input: ValidatedEditInput,
	signal: AbortSignal | undefined,
	onUpdate: unknown,
	ctx: ExtensionContext,
) {
	const mutation = await mutateReplaceAll(input, signal, ctx);
	return buildBuiltinReplaceAllResult(toolCallId, input, mutation, signal, onUpdate, ctx);
}

function buildRenderCallArgs(args: unknown): unknown {
	try {
		const input = validateAdvisedEditInput(args);
		return input.replaceAll ? { path: input.path } : args;
	} catch {
		return args;
	}
}

const replaceEditSchema = Type.Object({
	oldText: Type.Optional(
		Type.String({
			description: "Exact text for one targeted replacement. Include the exact surrounding whitespace and newlines from the file.",
		}),
	),
	newText: Type.Optional(Type.String({ description: "Replacement text for this targeted edit." })),
});

const advisedEditSchema = Type.Object(
	{
		path: Type.Optional(Type.String({ description: "Path to the file to edit (required; relative or absolute)." })),
		replaceAll: Type.Optional(
			Type.Boolean({
				description: "When true, each oldText is replaced at every exact occurrence in the file. Default false keeps oldText uniqueness checks.",
			}),
		),
		edits: Type.Optional(
			Type.Array(replaceEditSchema, {
				description:
					"One or more targeted replacements. Each item must include both oldText and newText strings. Each oldText is matched against the original file, not incrementally.",
			}),
		),
	},
	{ additionalProperties: false },
);

const definitionCache = new Map<string, ReturnType<typeof createEditToolDefinition>>();

function getBaseEditDefinition(cwd: string) {
	let definition = definitionCache.get(cwd);
	if (!definition) {
		definition = createEditToolDefinition(cwd);
		definitionCache.set(cwd, definition);
	}
	return definition;
}

export function createBetterEditToolDefinition(cwd: string) {
	const base = getBaseEditDefinition(cwd);
	const preparationWarnings = new Map<string, string[]>();
	return {
		name: "edit",
		label: base.label,
		description:
			"Edit a single file using exact text replacement. Errors include advice that points to the next read/retry step so the agent can fix the edit call instead of rewriting the whole file.",
		promptSnippet: base.promptSnippet,
		promptGuidelines: [
			...(base.promptGuidelines ?? []),
			"When edit fails, follow the advised read/retry steps and refine oldText instead of falling back to write.",
			"Use edit replaceAll: true only when every exact occurrence of oldText in that file should be replaced.",
		],
		parameters: advisedEditSchema,
		renderShell: base.renderShell,
		prepareArguments(rawInput: unknown) {
			const prepared = prepareAdvisedEditArgumentsWithWarnings(rawInput);
			const key = buildWarningKey(prepared.prepared);
			if (key) {
				if (prepared.warnings.length > 0) preparationWarnings.set(key, prepared.warnings);
				else preparationWarnings.delete(key);
			}
			return prepared.prepared;
		},
		async execute(toolCallId: string, input: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext) {
			const validated = validateAdvisedEditInput(input) as ValidatedEditInput;
			const warningKey = buildWarningKey(validated);
			const hiddenWarnings = warningKey ? (preparationWarnings.get(warningKey) ?? []) : [];
			if (warningKey) preparationWarnings.delete(warningKey);
			const currentBase = getBaseEditDefinition(ctx.cwd);
			try {
				const result = validated.replaceAll
					? await executeReplaceAll(toolCallId, validated, signal, onUpdate, ctx)
					: await currentBase.execute(toolCallId, validated, signal, onUpdate as never, ctx);
				return appendHiddenWarningsToContent(result, hiddenWarnings);
			} catch (error) {
				await logExecutionError({
					toolCallId,
					ctx,
					validated,
					rawInput: input,
					hiddenWarnings,
					error,
				});
				throw new Error(await buildAdvisedEditErrorMessage({ cwd: ctx.cwd, input: validated, error }));
			}
		},
		renderCall(args: unknown, theme: unknown, context: unknown) {
			const currentCwd = typeof (context as { cwd?: unknown } | undefined)?.cwd === "string" ? ((context as { cwd: string }).cwd) : cwd;
			return getBaseEditDefinition(currentCwd).renderCall?.(buildRenderCallArgs(args) as never, theme as never, context as never);
		},
		renderResult(result: unknown, options: unknown, theme: unknown, context: unknown) {
			const currentCwd = typeof (context as { cwd?: unknown } | undefined)?.cwd === "string" ? ((context as { cwd: string }).cwd) : cwd;
			return getBaseEditDefinition(currentCwd).renderResult?.(stripHiddenWarningsFromResult(result as never) as never, options as never, theme as never, context as never);
		},
	};
}

function createRegisteredEditToolDefinition(cwd: string, config: BetterEditConfig) {
	return config.enabled ? createBetterEditToolDefinition(cwd) : getBaseEditDefinition(cwd);
}

export default async function betterEdit(pi: ExtensionAPI): Promise<void> {
	let config = await loadConfig();

	function syncEditTool(cwd: string): void {
		pi.registerTool(createRegisteredEditToolDefinition(cwd, config));
	}

	syncEditTool(process.cwd());

	pi.on("session_start", async (_event, ctx) => {
		syncEditTool(ctx.cwd);
	});

	pi.registerCommand(COMMAND, {
		description: "Enable or disable better-edit: /better-edit [on|off|toggle|status]",
		getArgumentCompletions(prefix) {
			const values = ["on", "off", "toggle", "status"];
			const normalized = prefix.trim().toLowerCase();
			const matches = values.filter((value) => value.startsWith(normalized));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		async handler(args, ctx) {
			const mode = parseCommandMode(args);
			if (!mode) {
				ctx.ui.notify(`Usage: /${COMMAND} [on|off|toggle|status]`, "warning");
				return;
			}

			if (mode === "status") {
				ctx.ui.notify(buildStatus(config), "info");
				return;
			}

			const nextEnabled = mode === "toggle" ? !config.enabled : mode === "on";
			config = { enabled: nextEnabled };
			try {
				await saveConfig(config);
				syncEditTool(ctx.cwd);
				ctx.ui.notify(buildStatus(config), "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to save ${COMMAND} config: ${message}`, "error");
			}
		},
	});
}
