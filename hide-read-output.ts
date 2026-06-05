import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isAbsolute, relative } from "node:path";

type ReadRenderTheme = {
	fg(color: "accent" | "dim" | "toolOutput" | "toolTitle" | "warning", text: string): string;
	bold(text: string): string;
};

type ReadToolArgs = {
	path?: unknown;
	file_path?: unknown;
	offset?: unknown;
	limit?: unknown;
};

type ReadCall = {
	id: string;
	args: ReadToolArgs | undefined;
	groupId: number;
};

type ReadGroup = {
	ids: string[];
};

type ReadRenderPatchState = {
	originalRender?: (this: ToolExecutionComponent, width: number) => string[];
	shouldHide?: (component: unknown) => boolean;
};

const PATCH_STATE_KEY = Symbol.for("pi.hide-read-output.toolExecutionRenderPatch");
const MAX_PATH_DISPLAY_LENGTH = 80;
const MAX_READABLE_PARENT_SEGMENTS = 2;
const EXTRA_PARENT_SEGMENT_PENALTY = 4;

class ReadGroupSummary extends Text {
	private args: ReadToolArgs | undefined;
	private theme: ReadRenderTheme | undefined;

	constructor(
		private readonly toolCallId: string,
		private readonly getSummary: (toolCallId: string, args: ReadToolArgs | undefined, theme: ReadRenderTheme) => string,
	) {
		super("", 0, 0);
	}

	update(args: ReadToolArgs | undefined, theme: ReadRenderTheme) {
		this.args = args;
		this.theme = theme;
	}

	render(width: number): string[] {
		if (this.theme) {
			this.setText(this.getSummary(this.toolCallId, this.args, this.theme));
		}

		return super.render(width);
	}
}

function asReadToolArgs(args: unknown): ReadToolArgs | undefined {
	if (!args || typeof args !== "object") {
		return undefined;
	}

	return args as ReadToolArgs;
}

function getPath(args: ReadToolArgs | undefined): string | undefined {
	const rawPath = args?.path ?? args?.file_path;
	return typeof rawPath === "string" ? rawPath : undefined;
}

function getNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRelativeDisplayPath(path: string): string {
	if (path.startsWith("./") && !path.startsWith("../")) {
		return path.slice(2);
	}

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
	if (relativePath.length > absolutePath.length) {
		return true;
	}

	const extraParentSegments = Math.max(0, countLeadingParentSegments(relativePath) - MAX_READABLE_PARENT_SEGMENTS);
	const relativeReadabilityCost = relativePath.length + extraParentSegments * EXTRA_PARENT_SEGMENT_PENALTY;
	return relativeReadabilityCost >= absolutePath.length;
}

function normalizeDisplayPath(path: string): string {
	if (!isAbsolute(path)) {
		return normalizeRelativeDisplayPath(path);
	}

	const relativePath = normalizeRelativeDisplayPath(relative(process.cwd(), path) || ".");
	return shouldPreferAbsolutePath(relativePath, path) ? path : relativePath;
}

function shortenPath(path: string): string {
	const normalizedPath = normalizeDisplayPath(path);
	if (normalizedPath.length <= MAX_PATH_DISPLAY_LENGTH) {
		return normalizedPath;
	}

	return `...${normalizedPath.slice(-(MAX_PATH_DISPLAY_LENGTH - 3))}`;
}

function formatReadLineRange(args: ReadToolArgs | undefined, theme: ReadRenderTheme): string {
	const offset = getNumber(args?.offset);
	const limit = getNumber(args?.limit);

	if (offset === undefined && limit === undefined) {
		return "";
	}

	const startLine = offset ?? 1;
	const endLine = limit !== undefined ? startLine + limit - 1 : undefined;
	return theme.fg("warning", `:${startLine}${endLine !== undefined ? `-${endLine}` : ""}`);
}

function formatReadTarget(args: ReadToolArgs | undefined, theme: ReadRenderTheme): string {
	const path = getPath(args);
	const pathDisplay = path ? theme.fg("accent", shortenPath(path)) : theme.fg("toolOutput", "...");
	return `${pathDisplay}${formatReadLineRange(args, theme)}`;
}

function getAssistantContent(message: unknown): unknown[] | undefined {
	if (!message || typeof message !== "object") {
		return undefined;
	}

	const candidate = message as { role?: unknown; content?: unknown };
	if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) {
		return undefined;
	}

	return candidate.content;
}

function isToolCallContent(content: unknown): content is { id?: unknown; name?: unknown; arguments?: unknown } {
	return Boolean(content && typeof content === "object" && (content as { type?: unknown }).type === "toolCall");
}

function isReadToolCallContent(content: unknown): content is { id: string; arguments?: unknown } {
	if (!isToolCallContent(content)) {
		return false;
	}

	return content.name === "read" && typeof content.id === "string";
}

function isVisibleAssistantContent(content: unknown): boolean {
	if (!content || typeof content !== "object") {
		return false;
	}

	const candidate = content as { type?: unknown; text?: unknown; thinking?: unknown };
	return (
		(candidate.type === "text" && typeof candidate.text === "string" && candidate.text.trim() !== "") ||
		(candidate.type === "thinking" && typeof candidate.thinking === "string" && candidate.thinking.trim() !== "")
	);
}

function getReadToolCallIds(message: unknown): string[] {
	return getAssistantContent(message)?.filter(isReadToolCallContent).map((item) => item.id) ?? [];
}

function installReadRenderPatch(isHiddenReadComponent: (component: unknown) => boolean) {
	// Tool renderers can return empty content, but the row spacer still renders.
	// Patch the row renderer so non-leading reads in a grouped run disappear fully.
	const patchState = (((globalThis as Record<symbol, unknown>)[PATCH_STATE_KEY] as ReadRenderPatchState | undefined) ??=
		{}) as ReadRenderPatchState;

	if (!patchState.originalRender) {
		patchState.originalRender = ToolExecutionComponent.prototype.render;
		ToolExecutionComponent.prototype.render = function (this: ToolExecutionComponent, width: number) {
			if (patchState.shouldHide?.(this)) {
				return [];
			}

			return patchState.originalRender!.call(this, width);
		};
	}

	patchState.shouldHide = isHiddenReadComponent;
	return patchState;
}

/**
 * Hide the rendered result body of the built-in read tool in pi's interactive UI.
 *
 * The read tool still returns file contents to the model and stores normal tool
 * results in the session. This only changes terminal rendering so large or
 * truncated read output is not shown in the TUI.
 */
export default function (pi: ExtensionAPI) {
	const read = createReadToolDefinition(process.cwd());
	const readCalls = new Map<string, ReadCall>();
	const readGroups = new Map<number, ReadGroup>();
	let nextGroupId = 1;

	function removeReadCalls(ids: string[]) {
		const idsToRemove = new Set(ids);
		const touchedGroupIds = new Set<number>();

		for (const id of idsToRemove) {
			const call = readCalls.get(id);
			if (!call) {
				continue;
			}

			touchedGroupIds.add(call.groupId);
			readCalls.delete(id);
		}

		for (const groupId of touchedGroupIds) {
			const group = readGroups.get(groupId);
			if (!group) {
				continue;
			}

			group.ids = group.ids.filter((id) => !idsToRemove.has(id));
			if (group.ids.length === 0) {
				readGroups.delete(groupId);
			}
		}
	}

	function addReadRun(run: Array<{ id: string; args: ReadToolArgs | undefined }>) {
		if (run.length === 0) {
			return;
		}

		const groupId = nextGroupId++;
		readGroups.set(groupId, { ids: run.map((call) => call.id) });

		for (const call of run) {
			readCalls.set(call.id, { ...call, groupId });
		}
	}

	function indexAssistantReadGroups(message: unknown) {
		const content = getAssistantContent(message);
		if (!content) {
			return;
		}

		removeReadCalls(getReadToolCallIds(message));

		let run: Array<{ id: string; args: ReadToolArgs | undefined }> = [];
		const flushRun = () => {
			addReadRun(run);
			run = [];
		};

		for (const item of content) {
			if (isReadToolCallContent(item)) {
				run.push({ id: item.id, args: asReadToolArgs(item.arguments) });
			} else if (isToolCallContent(item) || isVisibleAssistantContent(item)) {
				flushRun();
			}
		}

		flushRun();
	}

	function rebuildReadGroupsFromSession(ctx: { sessionManager: { getBranch(): unknown[] } }) {
		readCalls.clear();
		readGroups.clear();
		nextGroupId = 1;

		let run: Array<{ id: string; args: ReadToolArgs | undefined }> = [];
		const flushRun = () => {
			addReadRun(run);
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

			const message = candidate.message as { role?: unknown };
			const content = getAssistantContent(message);
			if (!content) {
				if (message.role !== "toolResult") {
					flushRun();
				}
				continue;
			}

			for (const item of content) {
				if (isReadToolCallContent(item)) {
					run.push({ id: item.id, args: asReadToolArgs(item.arguments) });
				} else if (isToolCallContent(item) || isVisibleAssistantContent(item)) {
					flushRun();
				}
			}
		}

		flushRun();
	}

	function isHiddenReadComponent(component: unknown): boolean {
		if (!component || typeof component !== "object") {
			return false;
		}

		const candidate = component as { toolName?: unknown; toolCallId?: unknown };
		if (candidate.toolName !== "read" || typeof candidate.toolCallId !== "string") {
			return false;
		}

		const call = readCalls.get(candidate.toolCallId);
		const group = call ? readGroups.get(call.groupId) : undefined;
		return Boolean(group && group.ids.length > 1 && group.ids[0] !== candidate.toolCallId);
	}

	function formatReadSummary(toolCallId: string, fallbackArgs: ReadToolArgs | undefined, theme: ReadRenderTheme): string {
		const call = readCalls.get(toolCallId);
		const group = call ? readGroups.get(call.groupId) : undefined;
		const calls = group
			? group.ids.map((id) => readCalls.get(id)).filter((item): item is ReadCall => Boolean(item))
			: [{ id: toolCallId, args: fallbackArgs, groupId: -1 }];

		const targets = calls.map((item) => formatReadTarget(item.args, theme)).join(theme.fg("dim", ", "));
		return `${theme.fg("toolTitle", theme.bold("read"))} ${targets}`;
	}

	const patchState = installReadRenderPatch(isHiddenReadComponent);

	pi.on("session_start", (_event, ctx) => {
		rebuildReadGroupsFromSession(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		rebuildReadGroupsFromSession(ctx);
	});

	pi.on("session_compact", (_event, ctx) => {
		rebuildReadGroupsFromSession(ctx);
	});

	pi.on("message_update", (event) => {
		indexAssistantReadGroups(event.message);
	});

	pi.on("message_end", (event, ctx) => {
		rebuildReadGroupsFromSession(ctx);

		// Fallback for runtimes where the finalized assistant message is not in session state yet.
		if (getReadToolCallIds(event.message).some((id) => !readCalls.has(id))) {
			indexAssistantReadGroups(event.message);
		}
	});

	pi.on("session_shutdown", () => {
		if (patchState.shouldHide === isHiddenReadComponent) {
			patchState.shouldHide = undefined;
		}
	});

	pi.registerTool({
		...read,
		renderShell: "self",

		renderCall(args, theme, context) {
			const component =
				context.lastComponent instanceof ReadGroupSummary
					? context.lastComponent
					: new ReadGroupSummary(context.toolCallId, formatReadSummary);
			component.update(asReadToolArgs(args), theme);
			return component;
		},

		renderResult() {
			return new Text("", 0, 0);
		},
	});
}
