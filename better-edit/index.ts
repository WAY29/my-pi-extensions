import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	createEditToolDefinition,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildAdvisedEditErrorMessage,
	prepareAdvisedEditArguments,
	validateAdvisedEditInput,
	type ValidatedEditInput,
} from "./diagnostics.ts";

const COMMAND = "better-edit";
const CONFIG_PATH = join(getAgentDir(), "better-edit.json");

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
		prepareArguments: prepareAdvisedEditArguments,
		async execute(toolCallId: string, input: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext) {
			const validated = validateAdvisedEditInput(input) as ValidatedEditInput;
			const currentBase = getBaseEditDefinition(ctx.cwd);
			try {
				return await currentBase.execute(toolCallId, validated, signal, onUpdate as never, ctx);
			} catch (error) {
				throw new Error(await buildAdvisedEditErrorMessage({ cwd: ctx.cwd, input: validated, error }));
			}
		},
		renderCall(args: unknown, theme: unknown, context: unknown) {
			const currentCwd = typeof (context as { cwd?: unknown } | undefined)?.cwd === "string" ? ((context as { cwd: string }).cwd) : cwd;
			return getBaseEditDefinition(currentCwd).renderCall?.(args as never, theme as never, context as never);
		},
		renderResult(result: unknown, options: unknown, theme: unknown, context: unknown) {
			const currentCwd = typeof (context as { cwd?: unknown } | undefined)?.cwd === "string" ? ((context as { cwd: string }).cwd) : cwd;
			return getBaseEditDefinition(currentCwd).renderResult?.(result as never, options as never, theme as never, context as never);
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
