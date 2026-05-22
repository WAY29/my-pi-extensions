import type { AgentSessionEvent, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DynamicBorder,
	getMarkdownTheme,
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

function summarizeWorkingEvent(event: AgentSessionEvent): string | null {
	switch (event.type) {
		case "tool_execution_start": {
			const args: any = event.args;
			switch (event.toolName) {
				case "bash":
					return `$ ${String(args?.command ?? "").replace(/\s+/g, " ").trim()}`;
				case "read": {
					const path = String(args?.path ?? "");
					const offset = typeof args?.offset === "number" ? args.offset : 1;
					const limit = typeof args?.limit === "number" ? args.limit : undefined;
					return limit ? `read ${path}:${offset}-${offset + limit - 1}` : `read ${path}`;
				}
				case "grep": {
					const pattern = String(args?.pattern ?? "");
					const searchPath = String(args?.path ?? ".");
					return pattern ? `grep /${pattern}/ in ${searchPath}` : `grep in ${searchPath}`;
				}
				case "find":
					return `find ${String(args?.pattern ?? "*")} in ${String(args?.path ?? ".")}`;
				case "ls":
					return `ls ${String(args?.path ?? ".")}`;
				default:
					return event.toolName;
			}
		}
		case "tool_execution_end":
			return event.isError ? `${event.toolName} failed` : null;
		case "auto_retry_start":
			return `retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`;
		case "agent_end":
			return event.willRetry ? "audit turn ended, retry queued" : null;
		default:
			return null;
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
	if (!ctx.hasUI) {
		const abortController = new AbortController();
		return await new Promise<T>((resolve, reject) => {
			void run({
				setStatus() {},
				push() {},
				pushEvent() {},
				finish: resolve,
				fail: reject,
				abortSignal: abortController.signal,
			}).catch(reject);
		});
	}

	let currentStatus = title;
	let finished = false;
	const abortController = new AbortController();
	let unsubscribeInput: (() => void) | null = null;

	const renderStatus = () => {
		ctx.ui.setStatus("review-live", currentStatus);
	};

	renderStatus();

	unsubscribeInput = ctx.ui.onTerminalInput((data) => {
		if (matchesKey(data, Key.escape) && !finished) {
			abortController.abort();
			return { consume: true };
		}
		return undefined;
	});

	return await new Promise<T>((resolve, reject) => {
		const cleanup = () => {
			finished = true;
			unsubscribeInput?.();
			unsubscribeInput = null;
			ctx.ui.setStatus("review-live", undefined);
		};
		void run({
			setStatus(message: string) {
				currentStatus = message.trim() || title;
				renderStatus();
			},
			push(entry: ReviewLiveEntry) {
				const text = entry.kind === "error" ? `✗ ${entry.text}` : entry.text;
				currentStatus = text;
				renderStatus();
			},
			pushEvent(event: AgentSessionEvent) {
				const summary = summarizeWorkingEvent(event);
				if (!summary) return;
				if (event.type === "tool_execution_end" && !event.isError) return;
				if (event.type === "tool_execution_start") return;
				currentStatus = summary;
				renderStatus();
			},
			finish(value: T) {
				cleanup();
				resolve(value);
			},
			fail(error: unknown) {
				cleanup();
				reject(error instanceof Error ? error : new Error(String(error)));
			},
			abortSignal: abortController.signal,
		}).catch((error) => {
			cleanup();
			reject(error);
		});
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
