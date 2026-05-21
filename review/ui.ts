import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	AssistantMessageComponent,
	DynamicBorder,
	getMarkdownTheme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	Markdown,
	matchesKey,
	type SelectItem,
	SelectList,
	Text,
	truncateToWidth,
	type Component,
	type TUI,
} from "@earendil-works/pi-tui";
import { formatLocation } from "./format.js";
import type { ReviewFinding, ReviewLiveEntry } from "./types.js";

export async function showSelectList(
	ctx: ExtensionContext | ExtensionCommandContext,
	title: string,
	items: SelectItem[],
	placeholder?: string,
): Promise<string | null> {
	if (!ctx.hasUI) return null;

	return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		if (placeholder) {
			container.addChild(new Text(theme.fg("dim", placeholder), 1, 0));
		}

		const selectList = new SelectList(items, Math.min(items.length, 10), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(null);
		container.addChild(selectList);
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

export async function showFindingPicker(
	ctx: ExtensionContext | ExtensionCommandContext,
	findings: ReviewFinding[],
): Promise<number[] | null> {
	if (!ctx.hasUI || findings.length === 0) return null;

	return ctx.ui.custom<number[] | null>((tui, theme, _kb, done) => {
		let cursor = 0;
		const selected = findings.map(() => true);
		const maxVisible = 8;

		const renderLines = (width: number): string[] => {
			const lines: string[] = [];
			lines.push(theme.fg("accent", theme.bold("Select findings to resolve")));
			lines.push(theme.fg("dim", "space toggle • enter confirm • esc cancel"));
			lines.push("");

			const start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), Math.max(0, findings.length - maxVisible)));
			const end = Math.min(findings.length, start + maxVisible);
			for (let index = start; index < end; index++) {
				const finding = findings[index];
				const prefix = index === cursor ? theme.fg("accent", "›") : " ";
				const checkbox = selected[index] ? theme.fg("success", "[x]") : theme.fg("muted", "[ ]");
				const title = truncateToWidth(`${prefix} ${checkbox} ${finding.title}`, width);
				lines.push(title);
				lines.push(truncateToWidth(`    ${formatLocation(finding)}`, width));
			}
			if (findings.length > maxVisible) {
				lines.push("");
				lines.push(theme.fg("dim", `Showing ${start + 1}-${end} of ${findings.length}`));
			}
			return lines;
		};

		return {
			render(width: number) {
				return renderLines(width);
			},
			invalidate() {},
			handleInput(data: string) {
				if (matchesKey(data, Key.up)) {
					cursor = Math.max(0, cursor - 1);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.down)) {
					cursor = Math.min(findings.length - 1, cursor + 1);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.space)) {
					selected[cursor] = !selected[cursor];
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.enter)) {
					const indices = selected.flatMap((value, index) => (value ? [index] : []));
					done(indices);
					return;
				}
				if (matchesKey(data, Key.escape)) {
					done(null);
				}
			},
		};
	});
}

type ReviewRenderItem =
	| { kind: "status"; key: string; component: Component }
	| { kind: "tool"; key: string; toolCallId: string; component: ToolExecutionComponent }
	| { kind: "assistant"; key: string; component: AssistantMessageComponent };

function makeStatusComponent(text: string): Component {
	return {
		render(width: number) {
			return [truncateToWidth(text, width)];
		},
		invalidate() {},
	};
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function isStructuredReviewJson(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{")) return false;
	return trimmed.includes('"findings"') && trimmed.includes('"overall_correctness"');
}

function normalizeToolResult(result: any, isError: boolean): {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: any;
	isError: boolean;
} {
	if (typeof result === "string") {
		return { content: [{ type: "text", text: result }], isError };
	}
	if (!result || typeof result !== "object") {
		return { content: [], isError };
	}
	if (Array.isArray(result.content)) {
		return { content: result.content, details: result.details, isError };
	}
	if (typeof result.text === "string") {
		return { content: [{ type: "text", text: result.text }], details: result.details, isError };
	}
	return { content: [], details: result.details, isError };
}

function findToolById(items: ReviewRenderItem[], toolCallId: string): ToolExecutionComponent | undefined {
	return items.find((item) => item.kind === "tool" && item.toolCallId === toolCallId)?.component as ToolExecutionComponent | undefined;
}

function ensureToolItem(
	items: ReviewRenderItem[],
	tui: TUI,
	ctx: ExtensionContext | ExtensionCommandContext,
	toolCallId: string,
	toolName: string,
	args: any,
): ToolExecutionComponent {
	const existing = findToolById(items, toolCallId);
	if (existing) {
		existing.updateArgs(args);
		existing.markExecutionStarted();
		existing.setArgsComplete();
		return existing;
	}
	const component = new ToolExecutionComponent(toolName, toolCallId, args, undefined, undefined, tui, ctx.cwd);
	component.markExecutionStarted();
	component.setArgsComplete();
	items.push({ kind: "tool", key: `tool:${toolCallId}`, toolCallId, component });
	return component;
}

function applyEventToRenderItems(
	items: ReviewRenderItem[],
	tui: TUI,
	ctx: ExtensionContext | ExtensionCommandContext,
	event: AgentSessionEvent,
): boolean {
	switch (event.type) {
		case "tool_execution_start": {
			ensureToolItem(items, tui, ctx, event.toolCallId, event.toolName, event.args);
			return true;
		}
		case "tool_execution_update": {
			const tool = ensureToolItem(items, tui, ctx, event.toolCallId, event.toolName, event.args);
			tool.updateResult(normalizeToolResult(event.partialResult, false), true);
			return true;
		}
		case "tool_execution_end": {
			const tool = ensureToolItem(items, tui, ctx, event.toolCallId, event.toolName, (event as any).args ?? {});
			tool.updateResult(normalizeToolResult(event.result, event.isError), false);
			return true;
		}
		case "message_end": {
			const message = event.message as { role?: string; content?: unknown };
			if (message.role !== "assistant") return false;
			const text = Array.isArray(message.content)
				? message.content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n")
				: "";
			if (!text.trim() || isStructuredReviewJson(text)) return false;
			const component = new AssistantMessageComponent(createAssistantMessage(text), true, getMarkdownTheme());
			items.push({ kind: "assistant", key: `assistant:${items.length}`, component });
			return true;
		}
		case "auto_retry_start":
			items.push({ kind: "status", key: `status:${items.length}`, component: makeStatusComponent(`Retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`) });
			return true;
		default:
			return false;
	}
}

export async function showReviewLivePanel<T>(
	ctx: ExtensionContext | ExtensionCommandContext,
	title: string,
	run: (api: {
		setStatus(message: string): void;
		push(entry: ReviewLiveEntry): void;
		pushEvent(event: AgentSessionEvent): void;
		finish(value: T): void;
		fail(error: unknown): void;
		abortSignal: AbortSignal;
	}) => Promise<void>,
): Promise<T> {
	return ctx.ui.custom<T>((tui, theme, _kb, done) => {
		const items: ReviewRenderItem[] = [];
		let status = "Reviewing…";
		let scrollOffset = 0;
		let finished = false;
		let failed = false;

		const push = (entry: ReviewLiveEntry) => {
			const color = entry.kind === "error" ? theme.fg("error", `✗ ${entry.text}`) : theme.fg("dim", entry.text);
			items.push({ kind: "status", key: `status:${items.length}`, component: makeStatusComponent(color) });
			tui.requestRender();
		};

		const pushEvent = (event: AgentSessionEvent) => {
			if (applyEventToRenderItems(items, tui, ctx, event)) {
				tui.requestRender();
			}
		};

		const finish = (value: T) => {
			finished = true;
			done(value);
		};
		const fail = (error: unknown) => {
			failed = true;
			push({ kind: "error", text: error instanceof Error ? error.message : String(error), isError: true });
		};

		const abortController = new AbortController();
		void run({
			setStatus(message: string) {
				status = message;
				tui.requestRender();
			},
			push,
			pushEvent,
			finish,
			fail,
			abortSignal: abortController.signal,
		}).catch((error) => {
			fail(error);
		});

		return {
			render(width: number): string[] {
				const lines: string[] = [];
				const border = theme.fg("border", "─".repeat(Math.max(0, width)));
				lines.push(border);
				lines.push(truncateToWidth(theme.fg("accent", theme.bold(title)), width));
				if (status.trim()) {
					lines.push(truncateToWidth(theme.fg("dim", status), width));
				}
				lines.push(border);

				const renderedBody = items.flatMap((item) => item.component.render(width));
				const viewportHeight = Math.max(10, tui.terminal.rows - 7);
				const maxOffset = Math.max(0, renderedBody.length - viewportHeight);
				scrollOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
				const start = Math.max(0, renderedBody.length - viewportHeight - scrollOffset);
				const visible = renderedBody.slice(start, start + viewportHeight);
				for (const line of visible) lines.push(truncateToWidth(line, width, ""));
				for (let i = visible.length; i < viewportHeight; i++) lines.push("");

				lines.push(border);
				const footer = failed ? theme.fg("error", "Review failed") : theme.fg("dim", "esc cancel • ↑↓ scroll");
				lines.push(truncateToWidth(footer, width));
				return lines;
			},
			invalidate() {
				for (const item of items) item.component.invalidate();
			},
			handleInput(data: string) {
				if (matchesKey(data, Key.up)) {
					scrollOffset += 1;
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.down)) {
					scrollOffset = Math.max(0, scrollOffset - 1);
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.escape) && !finished) {
					status = "Stopping…";
					abortController.abort();
					tui.requestRender();
				}
			},
			dispose() {},
		};
	});
}

export function buildReviewResultComponent(message: string, rawJson: string | undefined) {
	return (theme: ExtensionContext["ui"]["theme"], expanded: boolean) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("border", s)));
		container.addChild(new Markdown(message, 1, 0, getMarkdownTheme()));
		if (expanded && rawJson) {
			container.addChild(new Text(theme.fg("dim", ""), 0, 0));
			container.addChild(new Text(theme.fg("dim", "Raw review JSON:"), 1, 0));
			container.addChild(new Text(theme.fg("dim", rawJson), 1, 0));
		}
		container.addChild(new DynamicBorder((s: string) => theme.fg("border", s)));
		return container;
	};
}
