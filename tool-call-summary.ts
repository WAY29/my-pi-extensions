import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	ToolExecutionComponent,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Key, Text } from "@earendil-works/pi-tui";
import { isAbsolute, relative } from "node:path";

import {
	ensureBashToolRegistered,
	refreshBashTool,
	registerBashToolPlugin,
	releaseBashToolOwner,
} from "./bash-tool-coordinator";
import {
	activateToolOutputMode,
	deactivateToolOutputMode,
	nextToolOutputMode,
	peekToolOutputMode,
	setToolOutputMode,
	type ToolOutputMode,
} from "./tool-output-mode-state";

const TARGET_TOOL_NAMES = ["read", "find", "grep", "ls"] as const;
type TargetToolName = (typeof TARGET_TOOL_NAMES)[number];
const TARGET_TOOL_NAME_SET = new Set<string>(TARGET_TOOL_NAMES);

const STATUS_KEY = "tool-output-mode";
const COMMAND = "tool-output-mode";
const TOOL_SCOPE = "bash/read/grep/find/ls/semble";
const SHORTCUTS = [
	Key.ctrlShift("o"),
	Key.alt("o"),
] as const;

const PATCH_STATE_KEY = Symbol.for("pi.tool-call-summary.toolExecutionRenderPatch");
const MAX_PATH_DISPLAY_LENGTH = 80;
const MAX_READABLE_PARENT_SEGMENTS = 2;
const EXTRA_PARENT_SEGMENT_PENALTY = 4;

const TOOL_RESULT_LABELS: Record<TargetToolName, string> = {
	read: "lines",
	find: "paths",
	grep: "lines",
	ls: "entries",
};

type SummaryTheme = {
	fg(color: "accent" | "dim" | "error" | "success" | "toolOutput" | "toolTitle" | "warning" | string, text: string): string;
	bold(text: string): string;
};

type ReadToolArgs = {
	path?: unknown;
	file_path?: unknown;
	offset?: unknown;
	limit?: unknown;
};

type FindToolArgs = {
	pattern?: unknown;
	path?: unknown;
	limit?: unknown;
};

type GrepToolArgs = {
	pattern?: unknown;
	path?: unknown;
	glob?: unknown;
	ignoreCase?: unknown;
	literal?: unknown;
	context?: unknown;
	limit?: unknown;
};

type LsToolArgs = {
	path?: unknown;
	limit?: unknown;
};

type FileToolArgs = ReadToolArgs | FindToolArgs | GrepToolArgs | LsToolArgs | Record<string, unknown> | undefined;

type TargetToolCallContent = {
	id: string;
	name: TargetToolName;
	arguments?: unknown;
};

type GroupedToolCall = {
	id: string;
	toolName: TargetToolName;
	args: FileToolArgs;
	groupId: number;
	leaderId: string;
};

type ToolGroupSection = {
	toolName: TargetToolName;
	ids: string[];
};

type ToolGroup = {
	leaderId: string;
	sections: ToolGroupSection[];
};

type StoredToolResult = {
	toolName: TargetToolName;
	content?: unknown[];
	details?: unknown;
	isError?: boolean;
};

type RenderPatchState = {
	originalRender?: (this: ToolExecutionComponent, width: number) => string[];
	shouldHide?: (component: unknown) => boolean;
};

type GroupedToolDefinition =
	| ReturnType<typeof createReadToolDefinition>
	| ReturnType<typeof createFindToolDefinition>
	| ReturnType<typeof createGrepToolDefinition>
	| ReturnType<typeof createLsToolDefinition>;

function isTargetToolName(value: unknown): value is TargetToolName {
	return typeof value === "string" && TARGET_TOOL_NAME_SET.has(value);
}

function asFileToolArgs(args: unknown): FileToolArgs {
	if (!args || typeof args !== "object") return undefined;
	return args as FileToolArgs;
}

function asStoredToolResult(toolName: TargetToolName, result: { content?: unknown[]; details?: unknown; isError?: boolean }): StoredToolResult {
	return {
		toolName,
		content: Array.isArray(result.content) ? result.content : undefined,
		details: result.details,
		isError: result.isError === true,
	};
}

function getAssistantContent(message: unknown): unknown[] | undefined {
	if (!message || typeof message !== "object") return undefined;
	const candidate = message as { role?: unknown; content?: unknown };
	if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return undefined;
	return candidate.content;
}

function isToolCallContent(content: unknown): content is { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown } {
	return Boolean(content && typeof content === "object" && (content as { type?: unknown }).type === "toolCall");
}

function isTargetToolCallContent(content: unknown): content is TargetToolCallContent {
	if (!isToolCallContent(content)) return false;
	return typeof content.id === "string" && isTargetToolName(content.name);
}

function isVisibleAssistantContent(content: unknown): boolean {
	if (!content || typeof content !== "object") return false;
	const candidate = content as { type?: unknown; text?: unknown; thinking?: unknown };
	return (
		(candidate.type === "text" && typeof candidate.text === "string" && candidate.text.trim() !== "") ||
		(candidate.type === "thinking" && typeof candidate.thinking === "string" && candidate.thinking.trim() !== "")
	);
}

function getTargetToolCallIds(message: unknown): string[] {
	return getAssistantContent(message)?.filter(isTargetToolCallContent).map((item) => item.id) ?? [];
}

function getString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRelativeDisplayPath(path: string): string {
	if (path.startsWith("./") && !path.startsWith("../")) return path.slice(2);
	return path;
}

function countLeadingParentSegments(path: string): number {
	let count = 0;
	let remainingPath = path;
	while (remainingPath === ".." || remainingPath.startsWith("../")) {
		count += 1;
		remainingPath = remainingPath === ".." ? "" : remainingPath.slice(3);
	}
	return count;
}

function shouldPreferAbsolutePath(relativePath: string, absolutePath: string): boolean {
	if (relativePath.length > absolutePath.length) return true;
	const extraParentSegments = Math.max(0, countLeadingParentSegments(relativePath) - MAX_READABLE_PARENT_SEGMENTS);
	const relativeReadabilityCost = relativePath.length + extraParentSegments * EXTRA_PARENT_SEGMENT_PENALTY;
	return relativeReadabilityCost >= absolutePath.length;
}

function normalizeDisplayPath(path: string): string {
	if (!isAbsolute(path)) return normalizeRelativeDisplayPath(path);
	const relativePath = normalizeRelativeDisplayPath(relative(process.cwd(), path) || ".");
	return shouldPreferAbsolutePath(relativePath, path) ? path : relativePath;
}

function shortenPath(path: string): string {
	const normalizedPath = normalizeDisplayPath(path);
	if (normalizedPath.length <= MAX_PATH_DISPLAY_LENGTH) return normalizedPath;
	return `...${normalizedPath.slice(-(MAX_PATH_DISPLAY_LENGTH - 3))}`;
}

function formatPath(path: string | undefined, theme: SummaryTheme): string {
	return path ? theme.fg("accent", shortenPath(path)) : theme.fg("toolOutput", "...");
}

function formatPlainPath(path: string | undefined): string {
	return path ? shortenPath(path) : "...";
}

function formatReadLineRange(args: ReadToolArgs | undefined, theme: SummaryTheme): string {
	const offset = getNumber(args?.offset);
	const limit = getNumber(args?.limit);
	if (offset === undefined && limit === undefined) return "";
	const startLine = offset ?? 1;
	const endLine = limit !== undefined ? startLine + limit - 1 : undefined;
	return theme.fg("warning", `:${startLine}${endLine !== undefined ? `-${endLine}` : ""}`);
}

function formatReadTarget(args: ReadToolArgs | undefined, theme: SummaryTheme): string {
	const path = getString(args?.path) ?? getString(args?.file_path);
	return `${formatPath(path, theme)}${formatReadLineRange(args, theme)}`;
}

function formatFindTarget(args: FindToolArgs | undefined, theme: SummaryTheme): string {
	const pattern = getString(args?.pattern) ?? theme.fg("toolOutput", "...");
	const path = getString(args?.path) ?? ".";
	return `${theme.fg("accent", pattern)}${theme.fg("dim", " in ")}${theme.fg("accent", formatPlainPath(path))}`;
}

function formatGrepFlags(args: GrepToolArgs | undefined): string[] {
	const flags: string[] = [];
	if (getString(args?.glob)) flags.push(`glob=${getString(args?.glob)}`);
	if (args?.ignoreCase === true) flags.push("ignoreCase");
	if (args?.literal === true) flags.push("literal");
	const context = getNumber(args?.context);
	if (context !== undefined) flags.push(`context=${context}`);
	const limit = getNumber(args?.limit);
	if (limit !== undefined) flags.push(`limit=${limit}`);
	return flags.filter((flag): flag is string => typeof flag === "string");
}

function formatGrepTarget(args: GrepToolArgs | undefined, theme: SummaryTheme): string {
	const pattern = getString(args?.pattern) ?? theme.fg("toolOutput", "...");
	const path = getString(args?.path) ?? ".";
	const flags = formatGrepFlags(args);
	const suffix = flags.length > 0 ? theme.fg("dim", ` [${flags.join(", ")}]`) : "";
	return `${theme.fg("accent", pattern)}${theme.fg("dim", " in ")}${theme.fg("accent", formatPlainPath(path))}${suffix}`;
}

function formatLsTarget(args: LsToolArgs | undefined, theme: SummaryTheme): string {
	const path = getString(args?.path) ?? ".";
	const limit = getNumber(args?.limit);
	const suffix = limit !== undefined ? theme.fg("dim", ` (limit=${limit})`) : "";
	return `${theme.fg("accent", formatPlainPath(path))}${suffix}`;
}

function formatToolTarget(toolName: TargetToolName, args: FileToolArgs, theme: SummaryTheme): string {
	switch (toolName) {
		case "read":
			return formatReadTarget(args as ReadToolArgs | undefined, theme);
		case "find":
			return formatFindTarget(args as FindToolArgs | undefined, theme);
		case "grep":
			return formatGrepTarget(args as GrepToolArgs | undefined, theme);
		case "ls":
			return formatLsTarget(args as LsToolArgs | undefined, theme);
	}
}

function getToolResultText(result: StoredToolResult | undefined): string | undefined {
	if (!result?.content) return undefined;
	const texts = result.content
		.filter((item): item is { type?: unknown; text?: unknown } => Boolean(item && typeof item === "object"))
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text as string);
	if (texts.length === 0) return undefined;
	return texts.join("\n");
}

function hasImageContent(result: StoredToolResult | undefined): boolean {
	return Boolean(
		result?.content?.some(
			(item) => Boolean(item && typeof item === "object" && (item as { type?: unknown }).type === "image"),
		),
	);
}

function getFirstMeaningfulLine(text: string | undefined): string | undefined {
	if (!text) return undefined;
	return text
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line !== "");
}

function getErrorText(result: StoredToolResult | undefined): string | undefined {
	if (!result) return undefined;
	const text = getToolResultText(result);
	const firstLine = getFirstMeaningfulLine(text);
	if (result.isError) return firstLine ?? "Error";
	if (firstLine && /^error[:\s]/i.test(firstLine)) return firstLine;
	return undefined;
}

function countOutputLines(text: string | undefined): number {
	if (!text) return 0;
	return text.split("\n").length;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function getTruncationSuffix(result: StoredToolResult | undefined, theme: SummaryTheme): string {
	const details = getRecord(result?.details);
	const truncation = getRecord(details?.truncation);
	if (truncation?.truncated !== true) return "";
	const totalLines = getNumber(truncation.totalLines);
	return totalLines !== undefined
		? theme.fg("warning", ` (truncated from ${totalLines})`)
		: theme.fg("warning", " (truncated)");
}

function installGroupedRenderPatch(isHiddenComponent: (component: unknown) => boolean) {
	const patchState = (((globalThis as Record<symbol, unknown>)[PATCH_STATE_KEY] as RenderPatchState | undefined) ??= {}) as RenderPatchState;
	if (!patchState.originalRender) {
		patchState.originalRender = ToolExecutionComponent.prototype.render;
		ToolExecutionComponent.prototype.render = function (this: ToolExecutionComponent, width: number) {
			if (patchState.shouldHide?.(this)) return [];
			return patchState.originalRender!.call(this, width);
		};
	}
	patchState.shouldHide = isHiddenComponent;
	return patchState;
}

function setStatus(ctx: { ui: { setStatus(key: string, text: string | undefined): void } }): void {
	ctx.ui.setStatus(STATUS_KEY, `tool output: ${peekToolOutputMode()}`);
}

function refreshToolRows(ctx: {
	ui: {
		getToolsExpanded(): boolean;
		setToolsExpanded(expanded: boolean): void;
	};
}): void {
	refreshBashTool();
	ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
}

function syncGroupedCallsFromSession(ctx: {
	sessionManager: { getBranch(): unknown[] };
	ui: {
		getToolsExpanded(): boolean;
		setToolsExpanded(expanded: boolean): void;
	};
}, rebuildStateFromSession: (ctx: { sessionManager: { getBranch(): unknown[] } }) => void): void {
	rebuildStateFromSession(ctx);
	refreshToolRows(ctx);
}

function applyOutputMode(
	ctx: {
		ui: {
			setStatus(key: string, text: string | undefined): void;
			notify(message: string, type?: "info" | "warning" | "error"): void;
			getToolsExpanded(): boolean;
			setToolsExpanded(expanded: boolean): void;
		};
	},
	mode: ToolOutputMode,
): void {
	const previousMode = setToolOutputMode(mode);
	const nextMode = peekToolOutputMode();
	setStatus(ctx);
	refreshToolRows(ctx);
	ctx.ui.notify(`${TOOL_SCOPE} output: ${previousMode} → ${nextMode}`, "info");
}

function parseMode(value: string): ToolOutputMode | undefined {
	const normalized = value.trim().toLowerCase();
	if (normalized === "hidden" || normalized === "compact" || normalized === "full") return normalized;
	return undefined;
}

export default function toolCallSummary(pi: ExtensionAPI) {
	const groupedCalls = new Map<string, GroupedToolCall>();
	const toolGroups = new Map<number, ToolGroup>();
	const toolResults = new Map<string, StoredToolResult>();
	let nextGroupId = 1;

	function removeGroupedCalls(ids: string[]) {
		const idsToRemove = new Set(ids);
		const touchedGroupIds = new Set<number>();
		for (const id of idsToRemove) {
			const call = groupedCalls.get(id);
			if (!call) continue;
			touchedGroupIds.add(call.groupId);
			groupedCalls.delete(id);
			toolResults.delete(id);
		}
		for (const groupId of touchedGroupIds) {
			const group = toolGroups.get(groupId);
			if (!group) continue;
			group.sections = group.sections
				.map((section) => ({ ...section, ids: section.ids.filter((id) => !idsToRemove.has(id)) }))
				.filter((section) => section.ids.length > 0);
			if (group.sections.length === 0) {
				toolGroups.delete(groupId);
				continue;
			}
			group.leaderId = group.sections[0]?.ids[0] ?? group.leaderId;
			for (const section of group.sections) {
				for (const id of section.ids) {
					const call = groupedCalls.get(id);
					if (!call) continue;
					call.leaderId = group.leaderId;
				}
			}
		}
	}

	function addGroupedRun(run: Array<{ id: string; toolName: TargetToolName; args: FileToolArgs }>) {
		if (run.length === 0) return;
		const groupId = nextGroupId++;
		const leaderId = run[0]!.id;
		const sections: ToolGroupSection[] = [];
		let currentSection: ToolGroupSection | undefined;
		for (const call of run) {
			if (!currentSection || currentSection.toolName !== call.toolName) {
				currentSection = { toolName: call.toolName, ids: [] };
				sections.push(currentSection);
			}
			currentSection.ids.push(call.id);
			groupedCalls.set(call.id, {
				id: call.id,
				toolName: call.toolName,
				args: call.args,
				groupId,
				leaderId,
			});
		}
		toolGroups.set(groupId, { leaderId, sections });
	}

	function indexAssistantTargetGroups(message: unknown) {
		const content = getAssistantContent(message);
		if (!content) return;
		removeGroupedCalls(getTargetToolCallIds(message));
		let run: Array<{ id: string; toolName: TargetToolName; args: FileToolArgs }> = [];
		const flushRun = () => {
			addGroupedRun(run);
			run = [];
		};
		for (const item of content) {
			if (isTargetToolCallContent(item)) {
				run.push({
					id: item.id,
					toolName: item.name,
					args: asFileToolArgs(item.arguments),
				});
				continue;
			}
			if (isToolCallContent(item) || isVisibleAssistantContent(item)) flushRun();
		}
		flushRun();
	}

	function storeToolResultMessage(message: unknown) {
		if (!message || typeof message !== "object") return;
		const candidate = message as {
			role?: unknown;
			toolCallId?: unknown;
			toolName?: unknown;
			content?: unknown;
			details?: unknown;
			isError?: unknown;
		};
		if (candidate.role !== "toolResult") return;
		if (typeof candidate.toolCallId !== "string" || !isTargetToolName(candidate.toolName)) return;
		toolResults.set(candidate.toolCallId, {
			toolName: candidate.toolName,
			content: Array.isArray(candidate.content) ? candidate.content : undefined,
			details: candidate.details,
			isError: candidate.isError === true,
		});
	}

	function rebuildStateFromSession(ctx: { sessionManager: { getBranch(): unknown[] } }) {
		groupedCalls.clear();
		toolGroups.clear();
		toolResults.clear();
		nextGroupId = 1;
		let run: Array<{ id: string; toolName: TargetToolName; args: FileToolArgs }> = [];
		const flushRun = () => {
			addGroupedRun(run);
			run = [];
		};
		for (const entry of ctx.sessionManager.getBranch()) {
			if (!entry || typeof entry !== "object") {
				flushRun();
				continue;
			}
			const candidate = entry as { type?: unknown; message?: unknown };
			if (candidate.type !== "message" || !candidate.message || typeof candidate.message !== "object") {
				flushRun();
				continue;
			}
			storeToolResultMessage(candidate.message);
			const message = candidate.message as { role?: unknown };
			const content = getAssistantContent(message);
			if (!content) {
				if (message.role !== "toolResult") flushRun();
				continue;
			}
			for (const item of content) {
				if (isTargetToolCallContent(item)) {
					run.push({ id: item.id, toolName: item.name, args: asFileToolArgs(item.arguments) });
					continue;
				}
				if (isToolCallContent(item) || isVisibleAssistantContent(item)) flushRun();
			}
		}
		flushRun();
	}

	function getGroupForToolCall(toolCallId: string): ToolGroup | undefined {
		const call = groupedCalls.get(toolCallId);
		return call ? toolGroups.get(call.groupId) : undefined;
	}

	type RenderableSection = {
		toolName: TargetToolName;
		calls: Array<{ id: string; toolName: TargetToolName; args: FileToolArgs }>;
	};

	function getRenderableSections(
		toolCallId: string,
		fallbackToolName: TargetToolName,
		fallbackArgs: FileToolArgs,
	): RenderableSection[] {
		const group = getGroupForToolCall(toolCallId);
		if (!group) {
			return [{ toolName: fallbackToolName, calls: [{ id: toolCallId, toolName: fallbackToolName, args: fallbackArgs }] }];
		}

		const sections: RenderableSection[] = [];
		for (const section of group.sections) {
			const calls = section.ids
				.map((id) => groupedCalls.get(id))
				.filter((call): call is GroupedToolCall => Boolean(call))
				.map((call) => ({ id: call.id, toolName: call.toolName, args: call.args }));
			if (calls.length === 0) continue;
			sections.push({ toolName: section.toolName, calls });
		}

		return sections.length > 0
			? sections
			: [{ toolName: fallbackToolName, calls: [{ id: toolCallId, toolName: fallbackToolName, args: fallbackArgs }] }];
	}

	function formatCallCount(count: number, theme: SummaryTheme): string {
		return theme.fg("dim", ` · ${count} call${count === 1 ? "" : "s"}`);
	}

	function formatSectionHeader(section: RenderableSection, theme: SummaryTheme): string {
		return `${theme.fg("toolTitle", theme.bold(section.toolName))}${formatCallCount(section.calls.length, theme)}`;
	}

	function formatCompactLeafSuffix(
		call: { toolName: TargetToolName; args: FileToolArgs },
		result: StoredToolResult | undefined,
		theme: SummaryTheme,
	): string {
		if (!result) {
			return theme.fg("warning", " · running");
		}
		const errorText = getErrorText(result);
		if (errorText) {
			return `${theme.fg("dim", " · ")}${theme.fg("error", errorText)}`;
		}
		if (hasImageContent(result)) {
			return `${theme.fg("dim", " · ")}${theme.fg("success", "image")}`;
		}
		const text = getToolResultText(result);
		const lineCount = countOutputLines(text);
		const label = TOOL_RESULT_LABELS[call.toolName];
		const countText = lineCount > 0 ? `${lineCount} ${label}` : "done";
		return `${theme.fg("dim", " · ")}${theme.fg("success", countText)}${getTruncationSuffix(result, theme)}`;
	}

	function formatLeafLine(
		call: { toolName: TargetToolName; args: FileToolArgs },
		result: StoredToolResult | undefined,
		isLast: boolean,
		mode: ToolOutputMode,
		theme: SummaryTheme,
	): string {
		const branch = isLast ? "└─" : "├─";
		const target = formatToolTarget(call.toolName, call.args, theme);
		if (mode === "hidden") {
			return `${branch} ${target}`;
		}
		if (mode === "compact") {
			return `${branch} ${target}${formatCompactLeafSuffix(call, result, theme)}`;
		}
		return `${branch} ${target}`;
	}

	function formatFullLeafBody(
		call: { toolName: TargetToolName; args: FileToolArgs },
		result: StoredToolResult | undefined,
		isLast: boolean,
		theme: SummaryTheme,
	): string[] {
		const bodyPrefix = isLast ? "   " : "│  ";
		if (!result) {
			return [`${bodyPrefix}${theme.fg("warning", "Running...")}`];
		}
		const errorText = getErrorText(result);
		if (errorText) {
			return [`${bodyPrefix}${theme.fg("error", errorText)}`];
		}
		if (hasImageContent(result)) {
			return [`${bodyPrefix}${theme.fg("success", "[image]")}`];
		}
		const text = getToolResultText(result);
		if (!text) {
			return [`${bodyPrefix}${theme.fg("success", "Done")}`];
		}
		return text.split("\n").map((line) => `${bodyPrefix}${theme.fg("toolOutput", line)}`);
	}

	function formatGroupedTree(
		toolCallId: string,
		fallbackToolName: TargetToolName,
		fallbackArgs: FileToolArgs,
		mode: ToolOutputMode,
		theme: SummaryTheme,
	): string {
		const sections = getRenderableSections(toolCallId, fallbackToolName, fallbackArgs);
		const lines: string[] = [];

		sections.forEach((section, sectionIndex) => {
			if (sectionIndex > 0) {
				lines.push("");
			}
			lines.push(formatSectionHeader(section, theme));
			section.calls.forEach((call, callIndex) => {
				const isLast = callIndex === section.calls.length - 1;
				const result = toolResults.get(call.id);
				lines.push(formatLeafLine(call, result, isLast, mode, theme));
				if (mode === "full") {
					lines.push(...formatFullLeafBody(call, result, isLast, theme));
				}
			});
		});

		return lines.join("\n");
	}

	function isHiddenGroupedComponent(component: unknown): boolean {
		if (!component || typeof component !== "object") return false;
		const candidate = component as { toolName?: unknown; toolCallId?: unknown };
		if (!isTargetToolName(candidate.toolName) || typeof candidate.toolCallId !== "string") return false;
		const call = groupedCalls.get(candidate.toolCallId);
		return Boolean(call && call.leaderId !== candidate.toolCallId);
	}

	function registerGroupedTool(toolName: TargetToolName, definition: GroupedToolDefinition) {
		pi.registerTool({
			...definition,
			renderShell: "self",
			renderCall(args: unknown, theme: SummaryTheme, context: { lastComponent?: unknown; toolCallId: string }) {
				const component = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
				component.setText(
					formatGroupedTree(
						context.toolCallId,
						toolName,
						asFileToolArgs(args),
						peekToolOutputMode(),
						theme,
					),
				);
				return component;
			},
			renderResult() {
				return new Container();
			},
		});
	}

	const patchState = installGroupedRenderPatch(isHiddenGroupedComponent);

	registerBashToolPlugin(pi, {
		id: "tool-call-summary",
		wrapRenderResult: (next) => (result, options, theme, context) => {
			const outputMode = peekToolOutputMode();
			if (outputMode === "hidden") return new Container();
			return next(result, { ...options, expanded: outputMode === "full" }, theme, context);
		},
	});

	for (const shortcut of SHORTCUTS) {
		pi.registerShortcut(shortcut, {
			description: `Cycle ${TOOL_SCOPE} output: hidden → compact → full`,
			handler(ctx) {
				applyOutputMode(ctx, nextToolOutputMode());
			},
		});
	}

	pi.registerCommand(COMMAND, {
		description: `Cycle or set ${TOOL_SCOPE} output mode: hidden, compact, full`,
		async handler(args, ctx) {
			const requestedMode = args.trim() ? parseMode(args) : nextToolOutputMode();
			if (!requestedMode) {
				ctx.ui.notify(`Usage: /${COMMAND} [hidden|compact|full]`, "warning");
				return;
			}
			applyOutputMode(ctx, requestedMode);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		activateToolOutputMode();
		setStatus(ctx);
		ensureBashToolRegistered(pi, ctx.cwd);
		registerGroupedTool("read", createReadToolDefinition(ctx.cwd));
		registerGroupedTool("find", createFindToolDefinition(ctx.cwd));
		registerGroupedTool("grep", createGrepToolDefinition(ctx.cwd));
		registerGroupedTool("ls", createLsToolDefinition(ctx.cwd));
		rebuildStateFromSession(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		rebuildStateFromSession(ctx);
	});

	pi.on("session_compact", (_event, ctx) => {
		rebuildStateFromSession(ctx);
	});

	pi.on("tool_execution_start", (event, ctx) => {
		if (!isTargetToolName(event.toolName)) return;
		syncGroupedCallsFromSession(ctx, rebuildStateFromSession);
	});

	pi.on("tool_call", (event, ctx) => {
		if (!isTargetToolName(event.toolName)) return;
		syncGroupedCallsFromSession(ctx, rebuildStateFromSession);
	});

	pi.on("message_update", (event) => {
		indexAssistantTargetGroups(event.message);
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message && typeof event.message === "object") {
			const message = event.message as { role?: unknown; toolName?: unknown };
			if (message.role === "assistant") {
				rebuildStateFromSession(ctx);
				if (getTargetToolCallIds(event.message).some((id) => !groupedCalls.has(id))) {
					indexAssistantTargetGroups(event.message);
				}
				return;
			}
			if (message.role === "toolResult" && isTargetToolName(message.toolName)) {
				storeToolResultMessage(event.message);
				refreshToolRows(ctx);
			}
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (patchState.shouldHide === isHiddenGroupedComponent) {
			patchState.shouldHide = undefined;
		}
		releaseBashToolOwner(pi);
		deactivateToolOutputMode();
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
