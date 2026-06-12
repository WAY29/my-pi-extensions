import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
	prepareAdvisedEditArguments,
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
				const result = await currentBase.execute(toolCallId, validated, signal, onUpdate as never, ctx);
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
			return getBaseEditDefinition(currentCwd).renderCall?.(args as never, theme as never, context as never);
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
