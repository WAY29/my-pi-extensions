import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { getAgentDir, renderDiff, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ExecutePatchError, executePatch, type ExecutePatchResult } from "./patch.ts";
import { getApplyPatchPreviewSections, type ApplyPatchPreviewSection } from "./rendering.ts";

const COMMAND = "codex-style-apply-patch";
const TOOL_NAME = "apply_patch";
const DISABLED_TOOLS = ["edit", "write"] as const;
const CONFIG_PATH = join(getAgentDir(), "codex-style-apply-patch.json");
const COMPACT_PREVIEW_LINES = 10;

interface Config {
	enabled: boolean;
}

interface ApplyPatchSuccessDetails {
	status: "success";
	result: ExecutePatchResult;
	previewSections?: ApplyPatchPreviewSection[] | undefined;
}

interface ApplyPatchPartialFailureDetails {
	status: "partial_failure";
	result: ExecutePatchResult;
	error: string;
	failedFiles: string[];
	appliedFiles: string[];
	previewSections?: ApplyPatchPreviewSection[] | undefined;
}

type ApplyPatchDetails = ApplyPatchSuccessDetails | ApplyPatchPartialFailureDetails;

type ApplyPatchCallRenderComponent = Box & {
	previewSections?: ApplyPatchPreviewSection[] | undefined;
	previewArgsKey?: string | undefined;
	settledSuccess?: boolean | undefined;
	settledError?: boolean | undefined;
};

type ApplyPatchRenderState = {
	callComponent?: ApplyPatchCallRenderComponent | undefined;
};

function defaultConfig(): Config {
	return { enabled: true };
}

function normalizeConfig(raw: unknown): Config {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultConfig();
	return {
		enabled: typeof (raw as { enabled?: unknown }).enabled === "boolean" ? Boolean((raw as { enabled: boolean }).enabled) : true,
	};
}

async function loadConfig(): Promise<Config> {
	try {
		return normalizeConfig(JSON.parse(await readFile(CONFIG_PATH, "utf8")));
	} catch {
		return defaultConfig();
	}
}

async function saveConfig(config: Config): Promise<void> {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(normalizeConfig(config), null, "\t")}\n`, "utf8");
}

function isGptOrCodexModel(ctx: ExtensionContext): boolean {
	const id = typeof ctx.model?.id === "string" ? ctx.model.id.toLowerCase() : "";
	return id.startsWith("gpt") || id.includes("codex");
}

function shouldUseCodexStyle(ctx: ExtensionContext, config: Config): boolean {
	return config.enabled && isGptOrCodexModel(ctx);
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function sameToolList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}

function enableCodexStyleTools(activeTools: string[], previousToolNames: string[] | undefined): { nextTools: string[]; previousToolNames: string[] } {
	const previous = previousToolNames ?? [...activeTools];
	const next = unique([...activeTools.filter((toolName) => !DISABLED_TOOLS.includes(toolName as (typeof DISABLED_TOOLS)[number])), TOOL_NAME]);
	return { nextTools: next, previousToolNames: previous };
}

function restoreTools(activeTools: string[], previousToolNames: string[] | undefined): string[] {
	const next = [...activeTools];
	for (const toolName of DISABLED_TOOLS) {
		if (previousToolNames?.includes(toolName) && !next.includes(toolName)) next.push(toolName);
	}
	return unique(next);
}

function buildStatus(ctx: ExtensionContext, config: Config, active: boolean): string {
	const modelLabel = typeof ctx.model?.id === "string" ? ctx.model.id : "no-model";
	return `codex-style-apply-patch ${config.enabled ? "on" : "off"} (${active ? `active:${modelLabel}` : `idle:${modelLabel}`})`;
}

function parseCommandMode(args: string): "on" | "off" | "toggle" | "status" | undefined {
	const normalized = args.trim().toLowerCase();
	if (!normalized) return "status";
	if (["on", "enable", "enabled", "yes", "1"].includes(normalized)) return "on";
	if (["off", "disable", "disabled", "no", "0"].includes(normalized)) return "off";
	if (["toggle", "switch"].includes(normalized)) return "toggle";
	if (["status", "state", "show"].includes(normalized)) return "status";
	return undefined;
}

function summarizePatchCounts(result: ExecutePatchResult): string {
	return [
		`changed ${result.changedFiles.length} file${result.changedFiles.length === 1 ? "" : "s"}`,
		`created ${result.createdFiles.length}`,
		`deleted ${result.deletedFiles.length}`,
		`moved ${result.movedFiles.length}`,
	].join(", ");
}

function getFailedPaths(error: ExecutePatchError): string[] {
	return [...new Set(error.failures.map((failure) => failure.action.path))];
}

function getAppliedPaths(result: ExecutePatchResult, failedFiles: string[]): string[] {
	return result.changedFiles.filter((path) => !failedFiles.includes(path));
}

function buildPartialFailureMessage(message: string, failedFiles: string[], appliedFiles: string[]): string {
	const lines = [message];
	if (failedFiles.length > 0) {
		lines.push(`Failed file${failedFiles.length === 1 ? "" : "s"}: ${failedFiles.join(", ")}`);
		lines.push(`Recovery: MUST read ${failedFiles.join(", ")} before retrying.`);
	}
	if (appliedFiles.length > 0) {
		lines.push("Earlier file actions in this patch were already applied.");
		lines.push("Recovery: MUST NOT reread other files from this patch unless a specific dependency requires it.");
	}
	return lines.join("\n");
}

function buildPromptGuidelines(): string[] {
	return [
		"Use apply_patch for text-file changes on GPT/Codex models; prefer it over edit and write.",
		"Use apply_patch with full patch text wrapped in *** Begin Patch / *** End Patch.",
		"When apply_patch partially fails, read only the reported failed files before retrying.",
	];
}

function getPatchText(args: { input?: unknown | undefined }): string {
	return typeof args.input === "string" ? args.input : "";
}

function createApplyPatchCallRenderComponent(): ApplyPatchCallRenderComponent {
	return Object.assign(new Box(1, 1, (text) => text), {
		previewSections: undefined,
		previewArgsKey: undefined,
		settledSuccess: false,
		settledError: false,
	});
}

function getApplyPatchCallRenderComponent(state: ApplyPatchRenderState, lastComponent: unknown): ApplyPatchCallRenderComponent {
	if (lastComponent instanceof Box) {
		const component = lastComponent as ApplyPatchCallRenderComponent;
		state.callComponent = component;
		return component;
	}
	if (state.callComponent) return state.callComponent;
	const component = createApplyPatchCallRenderComponent();
	state.callComponent = component;
	return component;
}

function colorizeCountGroup(counts: string, theme: { fg(role: string, text: string): string }): string {
	const trimmed = counts.trim();
	if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return counts;
	const inner = trimmed.slice(1, -1);
	const parts = inner.split(" ").filter(Boolean);
	const rendered = parts.map((part) => {
		if (part.startsWith("+")) return theme.fg("success", part);
		if (part.startsWith("-")) return theme.fg("error", part);
		return theme.fg("dim", part);
	});
	return `${theme.fg("dim", "(")}${rendered.join(theme.fg("dim", " "))}${theme.fg("dim", ")")}`;
}

function stylePreviewLine(line: string, theme: { fg(role: string, text: string): string; bold(text: string): string }): string {
	if (line.startsWith("• ")) {
		const match = line.match(/^(.*?)(\s\([^)]*\))?$/);
		if (!match) return line;
		const lead = theme.fg("toolTitle", theme.bold(match[1] ?? line));
		const counts = match[2] ? ` ${colorizeCountGroup(match[2], theme)}` : "";
		return `${lead}${counts}`;
	}

	if (line.startsWith("  └ ")) {
		const match = line.match(/^(\s*└\s.*?)(\s\([^)]*\))?$/);
		if (!match) return line;
		const lead = theme.fg("accent", match[1] ?? line);
		const counts = match[2] ? ` ${colorizeCountGroup(match[2], theme)}` : "";
		return `${lead}${counts}`;
	}

	return line;
}

function stylePreviewText(text: string, theme: { fg(role: string, text: string): string; bold(text: string): string }): string {
	return text
		.split("\n")
		.map((line) => stylePreviewLine(line, theme))
		.join("\n");
}

function getApplyPatchHeaderBg(
	settledSuccess: boolean | undefined,
	settledError: boolean | undefined,
	theme: { bg(role: string, text: string): string },
): (text: string) => string {
	if (settledError) return (text) => theme.bg("toolErrorBg", text);
	if (settledSuccess) return (text) => theme.bg("toolSuccessBg", text);
	return (text) => theme.bg("toolPendingBg", text);
}

function buildApplyPatchCallComponent(
	component: ApplyPatchCallRenderComponent,
	previewSections: ApplyPatchPreviewSection[],
	theme: { fg(role: string, text: string): string; bold(text: string): string; bg(role: string, text: string): string },
): ApplyPatchCallRenderComponent {
	component.setBgFn(getApplyPatchHeaderBg(component.settledSuccess, component.settledError, theme));
	component.clear();
	component.addChild(new Text(theme.fg("toolTitle", theme.bold("apply_patch")), 0, 0));
	for (const section of previewSections) {
		component.addChild(new Spacer(1));
		component.addChild(new Text(stylePreviewText(section.summary, theme), 0, 0));
		if (section.diffText) {
			component.addChild(new Spacer(1));
			component.addChild(new Text(renderDiff(section.diffText), 0, 0));
		}
	}
	if (previewSections.length === 0) {
		component.addChild(new Spacer(1));
		component.addChild(new Text(theme.fg("warning", "Patching..."), 0, 0));
	}
	return component;
}

function formatApplyPatchResult(
	result: { content: Array<{ type: string; text?: string | undefined }> },
	theme: { fg(role: string, text: string): string },
	isError: boolean,
	isPartialFailure: boolean,
): string | undefined {
	const output = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text || "")
		.join("\n");
	if (!output) return undefined;
	if (isError) return theme.fg("error", output);
	if (isPartialFailure) return theme.fg("warning", output);
	return undefined;
}

function buildFailureMessage(message: string, failedFiles: string[]): string {
	const lines = [message];
	if (message.includes("Failed to find expected lines in ")) {
		lines.push("Reason: the patch context did not match the file's current contents.");
	} else if (message.includes("File not found:")) {
		lines.push("Reason: the target path does not exist at apply time.");
	} else if (message.includes("Duplicate Path:")) {
		lines.push("Reason: the patch references the same path more than once.");
	} else if (message.includes("Move target already exists:")) {
		lines.push("Reason: the destination path for a move already exists.");
	}
	if (failedFiles.length > 0) {
		lines.push(`Recovery: MUST read ${failedFiles.join(", ")} before retrying.`);
	}
	return lines.join("\n");
}

export default async function codexStyleApplyPatch(pi: ExtensionAPI): Promise<void> {
	let config = await loadConfig();
	let codexStyleActive = false;
	let previousToolNames: string[] | undefined;

	function syncTools(ctx: ExtensionContext): void {
		const activeTools = pi.getActiveTools();
		if (shouldUseCodexStyle(ctx, config)) {
			const next = enableCodexStyleTools(activeTools, previousToolNames);
			previousToolNames = next.previousToolNames;
			codexStyleActive = true;
			if (!sameToolList(activeTools, next.nextTools)) {
				pi.setActiveTools(next.nextTools);
			}
			return;
		}

		if (!codexStyleActive) return;

		const nextTools = restoreTools(activeTools, previousToolNames);
		codexStyleActive = false;
		previousToolNames = undefined;
		if (!sameToolList(activeTools, nextTools)) {
			pi.setActiveTools(nextTools);
		}
	}

	pi.registerTool({
		name: TOOL_NAME,
		label: TOOL_NAME,
		description: "Apply Codex-style patches using *** Begin Patch / *** End Patch with Add/Update/Delete File sections.",
		promptSnippet: "Apply file edits with a Codex-style patch envelope.",
		promptGuidelines: buildPromptGuidelines(),
		executionMode: "sequential",
		parameters: Type.Object({
			input: Type.String({
				description: "Full patch text. Use *** Begin Patch / *** End Patch with Add/Update/Delete File sections.",
			}),
		}),
		prepareArguments(args) {
			if (args && typeof args === "object") {
				if ("input" in args && typeof (args as { input?: unknown }).input === "string") return { input: (args as { input: string }).input };
				if ("patchText" in args && typeof (args as { patchText?: unknown }).patchText === "string") return { input: (args as { patchText: string }).patchText };
				if ("patch" in args && typeof (args as { patch?: unknown }).patch === "string") return { input: (args as { patch: string }).patch };
			}
			return args as { input: string };
		},
		renderShell: "self",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (typeof params.input !== "string") {
				throw new Error("apply_patch requires a string 'input' parameter");
			}

			const previewSections = getApplyPatchPreviewSections(params.input, ctx.cwd, {
				allowPartial: false,
				maxPreviewLinesPerFile: Number.MAX_SAFE_INTEGER,
			});
			try {
				const result = executePatch({ cwd: ctx.cwd, patchText: params.input });
				const summary = [
					"Applied patch successfully.",
					`Changed files: ${result.changedFiles.length}`,
					`Created files: ${result.createdFiles.length}`,
					`Deleted files: ${result.deletedFiles.length}`,
					`Moved files: ${result.movedFiles.length}`,
					`Fuzz: ${result.fuzz}`,
				].join("\n");
				return {
					content: [{ type: "text", text: summary }],
					details: { status: "success", result, previewSections } satisfies ApplyPatchSuccessDetails,
				};
			} catch (error) {
				if (error instanceof ExecutePatchError) {
					const partial = error.hasPartialSuccess();
					const prefix = partial ? `apply_patch partially failed after ${summarizePatchCounts(error.result)}` : "apply_patch failed";
					const failurePaths = getFailedPaths(error);
					const pathSummary = failurePaths.join(", ");
					const message = pathSummary ? `${prefix} while patching ${pathSummary}: ${error.message}` : `${prefix}: ${error.message}`;
					if (partial) {
						const appliedFiles = getAppliedPaths(error.result, failurePaths);
						const recoveryMessage = buildPartialFailureMessage(message, failurePaths, appliedFiles);
						return {
							content: [{ type: "text", text: recoveryMessage }],
							details: {
								status: "partial_failure",
								result: error.result,
								error: recoveryMessage,
								failedFiles: failurePaths,
								appliedFiles,
								previewSections,
							} satisfies ApplyPatchPartialFailureDetails,
						};
					}
					throw new Error(buildFailureMessage(message, failurePaths));
				}
				throw error;
			}
		},
		renderCall(args, theme, context) {
			const patchText = getPatchText(args as { input?: unknown | undefined });
			const cwd = context.cwd ?? process.cwd();
			const state = context.state as ApplyPatchRenderState;
			const component = getApplyPatchCallRenderComponent(state, context.lastComponent);
			const argsKey = patchText;
			if (component.previewArgsKey !== argsKey) {
				component.previewArgsKey = argsKey;
				component.settledSuccess = false;
				component.settledError = false;
			}
			const previewSections = getApplyPatchPreviewSections(patchText, cwd, {
				allowPartial: context.argsComplete === false,
				maxPreviewLinesPerFile: context.expanded ? Number.MAX_SAFE_INTEGER : COMPACT_PREVIEW_LINES,
			});
			component.previewSections = previewSections;
			return buildApplyPatchCallComponent(component, previewSections, theme);
		},
		renderResult(result, { expanded }, theme, context) {
			const state = context.state as ApplyPatchRenderState;
			const details = result.details as ApplyPatchDetails | undefined;
			const isPartialFailure = details?.status === "partial_failure";
			const callComponent = state.callComponent;
			if (callComponent) {
				callComponent.settledSuccess = !context.isError && !isPartialFailure;
				callComponent.settledError = context.isError || isPartialFailure;
				if ((!callComponent.previewSections || callComponent.previewSections.length === 0) && details?.previewSections) {
					callComponent.previewSections = details.previewSections;
				}
				buildApplyPatchCallComponent(callComponent, callComponent.previewSections ?? [], theme);
			}
			const output = formatApplyPatchResult(result, theme, context.isError, isPartialFailure);
			const component = context.lastComponent instanceof Container ? context.lastComponent : new Container();
			component.clear();
			if (!output) return component;
			component.addChild(new Spacer(1));
			component.addChild(new Text(output, 1, 0));
			return component;
		},
	});

	pi.on("model_select", async (event, ctx) => {
		if (event.source === "restore") return;
		syncTools(ctx);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		syncTools(ctx);
	});

	pi.registerCommand(COMMAND, {
		description: "Toggle Codex-style apply_patch mode for GPT/Codex models: /codex-style-apply-patch [on|off|toggle|status]",
		getArgumentCompletions: (prefix) => {
			const values = ["on", "off", "toggle", "status"];
			const normalized = prefix.trim().toLowerCase();
			const matches = values.filter((value) => value.startsWith(normalized));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const mode = parseCommandMode(args);
			if (!mode) {
				ctx.ui.notify("Usage: /codex-style-apply-patch [on|off|toggle|status]", "warning");
				return;
			}

			if (mode === "status") {
				syncTools(ctx);
				ctx.ui.notify(buildStatus(ctx, config, shouldUseCodexStyle(ctx, config)), "info");
				return;
			}

			const nextEnabled = mode === "toggle" ? !config.enabled : mode === "on";
			config = { enabled: nextEnabled };
			try {
				await saveConfig(config);
				syncTools(ctx);
				ctx.ui.notify(buildStatus(ctx, config, shouldUseCodexStyle(ctx, config)), "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to save ${COMMAND} config: ${message}`, "error");
			}
		},
	});
}
