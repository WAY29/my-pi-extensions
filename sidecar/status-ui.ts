/**
 * Read-only dual-pane status overlay for sidecars.
 * Left: instance list (↑↓ when focused). Right: live log viewport (scroll/wheel/Home/End).
 * Mouse click hit-testing intentionally omitted (v1).
 */
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type OverlayHandle,
	type TUI,
} from "@earendil-works/pi-tui";
import { renderSidecarTranscript } from "./transcript.js";

export type SidecarLiveView = {
	name: string;
	status: string;
	mode: string;
	blocking: boolean;
	/** dim chrome above transcript */
	statusLines: string[];
	/** session messages — rendered like stock main agent */
	messages: any[];
	updatedAt: number;
};

export type StatusOverlaySource = {
	list: () => SidecarLiveView[];
	/** Subscribe to live line updates; return unsubscribe. */
	subscribe: (cb: () => void) => () => void;
	/** Stop a live sidecar by name (no-op / throw if missing). */
	stop?: (name: string) => Promise<void>;
	/** Whether name is currently stoppable (live instance). */
	canStop?: (name: string) => boolean;
};

type FocusPane = "list" | "log";
type ConfirmChoice = "yes" | "no";
type ConfirmState = { name: string; choice: ConfirmChoice; busy: boolean; error?: string };

const LEFT_W = 18;
const MAX_WRAP_CACHE = 4000;

/** SGR / legacy wheel → log scroll delta (lines). */
function parseWheelDelta(data: string): number | null {
	const sgr = /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(data);
	if (sgr) {
		const button = Number(sgr[1]);
		if ((button & 64) !== 64) return null;
		return (button & 1) === 0 ? -3 : 3;
	}
	if (data.length === 6 && data.startsWith("\x1b[M")) {
		const button = data.charCodeAt(3) - 32;
		if ((button & 64) !== 64) return null;
		return (button & 1) === 0 ? -3 : 3;
	}
	return null;
}

type ThemeLike = { fg: (k: string, s: string) => string; bold: (s: string) => string };

export type StatusOverlayOptions = {
	/** Prefer selecting this sidecar when opening. */
	selectName?: string;
	/** Close overlay when this settles (blocking wait mode). */
	until?: Promise<unknown>;
	/** Called when user Esc/cancels in wait mode (before close). */
	onCancel?: () => void;
	/** True when overlay is the blocking-wait UI (Esc cancels work). */
	waitMode?: boolean;
};

class SidecarStatusOverlay {
	private tui: TUI;
	private theme: ThemeLike;
	private source: StatusOverlaySource;
	private done: () => void;
	private opts: StatusOverlayOptions;
	private cwd: string;
	private unsub: (() => void) | null = null;
	private focus: FocusPane = "log";
	private selected = 0;
	private scrollOffset = 0;
	/** stick to bottom while true; re-enabled when user scrolls back to end */
	private follow = true;
	/** last frame was at bottom — used if follow was lost without user scrolling up */
	private wasAtBottom = true;
	private viewportH = 12;
	private disposed = false;
	/** last rendered right-pane width for wrap */
	private logInnerW = 40;
	private transcriptCache: { key: string; lines: string[] } | null = null;
	private confirm: ConfirmState | null = null;
	private overlayHandle: OverlayHandle | null = null;
	private removeWheelListener: (() => void) | null = null;

	constructor(
		tui: TUI,
		theme: ThemeLike,
		source: StatusOverlaySource,
		done: () => void,
		opts: StatusOverlayOptions = {},
		cwd: string = process.cwd(),
	) {
		this.tui = tui;
		this.theme = theme;
		this.source = source;
		this.done = done;
		this.opts = opts;
		this.cwd = cwd;
		// Never toggle terminal mouse modes (breaks chat scroll on close).
		// Capture wheel via TUI input listener while focused instead.
		this.syncSelection();
		this.installWheelCapture();
		this.unsub = source.subscribe(() => {
			if (this.disposed) return;
			// New output while already at bottom → keep pinning to end.
			if (this.follow || this.wasAtBottom) {
				this.follow = true;
				this.scrollOffset = Number.MAX_SAFE_INTEGER;
			}
			// waitMode: keep the running sidecar selected as the list reorders
			if (this.opts.waitMode) this.syncSelection();
			// content changed — drop transcript cache so height/maxScroll refresh
			this.transcriptCache = null;
			this.tui.requestRender();
		});
		if (opts.until) {
			void opts.until.finally(() => {
				if (this.disposed) return;
				this.close();
			});
		}
	}

	setHandle(handle: OverlayHandle): void {
		this.overlayHandle = handle;
	}

	/**
	 * Pi alt-screen registers a wheel listener that always scrolls chat.
	 * We insert ours first so, while this overlay is focused, wheel scrolls the log.
	 * No terminal mode toggles — chat scroll stays intact after close.
	 */
	private installWheelCapture(): void {
		const listener = (data: string): { consume: true } | undefined => {
			if (this.disposed || this.confirm) return;
			// When unfocused, let Pi scroll the main transcript.
			if (this.overlayHandle && !this.overlayHandle.isFocused()) return;
			const delta = parseWheelDelta(data);
			if (delta == null) return;
			this.scrollLog(delta);
			return { consume: true };
		};

		const listeners = (this.tui as unknown as { inputListeners?: Set<(data: string) => unknown> })
			.inputListeners;
		if (listeners && typeof listeners.clear === "function") {
			const existing = [...listeners];
			listeners.clear();
			listeners.add(listener);
			for (const l of existing) listeners.add(l);
			this.removeWheelListener = () => listeners.delete(listener);
			return;
		}
		// Fallback: may run after alt-screen (wheel won't reach us)
		this.removeWheelListener = this.tui.addInputListener(listener);
	}

	/** Keep selectName pinned; otherwise clamp index. */
	private syncSelection(): void {
		const list = this.views();
		if (!list.length) {
			this.selected = 0;
			return;
		}
		if (this.opts.selectName) {
			const idx = list.findIndex((v) => v.name === this.opts.selectName);
			if (idx >= 0) {
				this.selected = idx;
				return;
			}
		}
		if (this.selected < 0) this.selected = 0;
		if (this.selected >= list.length) this.selected = list.length - 1;
	}

	private close(): void {
		if (this.disposed) return;
		this.dispose();
		this.done();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.removeWheelListener?.();
		this.removeWheelListener = null;
		this.overlayHandle = null;
		this.unsub?.();
		this.unsub = null;
	}

	private views(): SidecarLiveView[] {
		return this.source.list();
	}

	private current(): SidecarLiveView | undefined {
		const list = this.views();
		if (!list.length) return undefined;
		if (this.selected < 0) this.selected = 0;
		if (this.selected >= list.length) this.selected = list.length - 1;
		return list[this.selected];
	}

	private transcriptLines(view: SidecarLiveView, width: number): string[] {
		const last = view.messages[view.messages.length - 1];
		const key = `${width}:${view.name}:${view.messages.length}:${view.statusLines.length}:${view.updatedAt}:${typeof last?.content === "string" ? last.content.length : Array.isArray(last?.content) ? last.content.length : 0}`;
		if (this.transcriptCache?.key === key) return this.transcriptCache.lines;
		let lines = renderSidecarTranscript(
			view.messages,
			view.statusLines,
			Math.max(1, width),
			this.tui,
			this.cwd,
		);
		if (lines.length > MAX_WRAP_CACHE) lines = lines.slice(lines.length - MAX_WRAP_CACHE);
		this.transcriptCache = { key, lines };
		return lines;
	}

	private scrollLog(delta: number): void {
		if (delta < 0) {
			this.follow = false;
			this.wasAtBottom = false;
		}
		this.scrollOffset = Math.max(0, this.scrollOffset + delta);
		this.tui.requestRender();
	}


	private moveSelection(delta: number): void {
		const list = this.views();
		if (!list.length) return;
		this.selected = Math.max(0, Math.min(list.length - 1, this.selected + delta));
		this.follow = true;
		this.scrollOffset = Number.MAX_SAFE_INTEGER;
		this.transcriptCache = null;
		this.tui.requestRender();
	}

	private openStopConfirm(): void {
		const cur = this.current();
		if (!cur) return;
		if (this.source.canStop && !this.source.canStop(cur.name)) {
			// finished history entry — not stoppable
			return;
		}
		if (!this.source.stop) return;
		this.confirm = { name: cur.name, choice: "no", busy: false };
		this.tui.requestRender();
	}

	private async confirmStop(): Promise<void> {
		const c = this.confirm;
		if (!c || c.busy || !this.source.stop) return;
		if (c.choice === "no") {
			this.confirm = null;
			this.tui.requestRender();
			return;
		}
		c.busy = true;
		c.error = undefined;
		this.tui.requestRender();
		try {
			await this.source.stop(c.name);
			this.confirm = null;
		} catch (err) {
			c.busy = false;
			c.error = err instanceof Error ? err.message : String(err);
		}
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		// --- confirm dialog captures input ---
		if (this.confirm) {
			if (this.confirm.busy) return;
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				this.confirm = null;
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.left) || data === "h") {
				this.confirm.choice = "yes";
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.right) || data === "l") {
				this.confirm.choice = "no";
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.tab)) {
				this.confirm.choice = this.confirm.choice === "yes" ? "no" : "yes";
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
				void this.confirmStop();
				return;
			}
			return;
		}

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			if (this.opts.waitMode) this.opts.onCancel?.();
			this.close();
			return;
		}

		// Shift+S → stop selected (with confirm)
		if (matchesKey(data, Key.shift("s")) || data === "S") {
			this.openStopConfirm();
			return;
		}

		// Wheel is handled by Pi alt-screen (main transcript). Log pane uses keys only.

		if (matchesKey(data, Key.tab)) {
			this.focus = this.focus === "list" ? "log" : "list";
			this.tui.requestRender();
			return;
		}

		// left/right only switch panes when not in confirm
		if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
			this.focus = this.focus === "list" ? "log" : "list";
			this.tui.requestRender();
			return;
		}

		if (this.focus === "list") {
			if (matchesKey(data, Key.up) || data === "k") {
				this.moveSelection(-1);
				return;
			}
			if (matchesKey(data, Key.down) || data === "j") {
				this.moveSelection(1);
				return;
			}
			if (matchesKey(data, Key.home)) {
				this.selected = 0;
				this.follow = true;
				this.scrollOffset = Number.MAX_SAFE_INTEGER;
				this.tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.end)) {
				this.selected = Math.max(0, this.views().length - 1);
				this.follow = true;
				this.scrollOffset = Number.MAX_SAFE_INTEGER;
				this.tui.requestRender();
				return;
			}
		}

		// log focus (default) — also absorb scroll keys when focus is log
		if (matchesKey(data, Key.up) || data === "k") {
			this.scrollLog(-1);
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			this.scrollLog(1);
			return;
		}
		if (matchesKey(data, Key.pageUp)) {
			this.scrollLog(-(this.viewportH - 1));
			return;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.scrollLog(this.viewportH - 1);
			return;
		}
		if (matchesKey(data, Key.home)) {
			this.follow = false;
			this.wasAtBottom = false;
			this.scrollOffset = 0;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.end)) {
			this.follow = true;
			this.wasAtBottom = true;
			this.scrollOffset = Number.MAX_SAFE_INTEGER;
			this.tui.requestRender();
			return;
		}
	}

	private renderConfirm(width: number): string[] {
		const fg = (k: string, s: string) => this.theme.fg(k, s);
		const bold = (s: string) => this.theme.bold(s);
		const border = (s: string) => fg("border", s);
		const c = this.confirm!;
		const totalW = Math.max(36, Math.min(width, 56));
		const inner = totalW - 2;
		const pad = (s: string) => {
			const t = truncateToWidth(s, inner, "");
			return t + " ".repeat(Math.max(0, inner - visibleWidth(t)));
		};
		const title = bold(fg("warning", " stop sidecar "));
		const titlePad = Math.max(0, inner - visibleWidth(title));
		const out: string[] = [];
		out.push(border("╭") + title + border("─".repeat(titlePad) + "╮"));
		out.push(border("│") + pad("") + border("│"));
		out.push(border("│") + pad(` Stop ${c.name}?`) + border("│"));
		out.push(border("│") + pad(" This ends the run and may close its tab.") + border("│"));
		out.push(border("│") + pad("") + border("│"));

		const yesLabel = c.choice === "yes" ? bold(fg("accent", "[ Yes ]")) : "  Yes  ";
		const noLabel = c.choice === "no" ? bold(fg("accent", "[ No ]")) : "  No  ";
		const choices = `   ${yesLabel}     ${noLabel}`;
		const choicesPad = truncateToWidth(choices, inner, "");
		// visibleWidth ignores some ANSI; use raw structure padding carefully
		out.push(
			border("│") +
				choicesPad +
				" ".repeat(Math.max(0, inner - visibleWidth(choicesPad))) +
				border("│"),
		);
		out.push(border("│") + pad("") + border("│"));
		if (c.busy) {
			out.push(border("│") + pad(fg("dim", " Stopping…")) + border("│"));
		} else if (c.error) {
			out.push(border("│") + pad(fg("error", ` ${c.error}`)) + border("│"));
		} else {
			out.push(border("│") + pad(fg("dim", " ←/→ switch · Enter confirm · Esc cancel")) + border("│"));
		}
		out.push(border("╰" + "─".repeat(inner) + "╯"));
		return out;
	}

	render(width: number): string[] {
		if (this.confirm) return this.renderConfirm(width);

		const fg = (k: string, s: string) => this.theme.fg(k, s);
		const bold = (s: string) => this.theme.bold(s);
		const border = (s: string) => fg("border", s);

		const totalW = Math.max(40, width);
		const leftInner = LEFT_W;
		const rightInner = Math.max(12, totalW - leftInner - 3); // 3 = separators
		this.logInnerW = rightInner - 1;

		const rows = process.stdout.rows ?? 30;
		const boxH = Math.max(12, Math.min(28, Math.floor(rows * 0.72)));
		const headerH = 1;
		const footerH = 1;
		const bodyH = boxH - headerH - footerH - 2; // top/bottom borders of body
		this.viewportH = Math.max(3, bodyH);

		const views = this.views();
		const cur = this.current();

		const title = bold(fg("accent", " sidecar status "));
		const titlePad = Math.max(0, totalW - 2 - visibleWidth(title));
		const out: string[] = [];
		out.push(border("╭") + title + border("─".repeat(titlePad) + "╮"));

		// header row under title
		const leftHead = truncateToWidth(
			(this.focus === "list" ? "▸" : " ") + "sidecars",
			leftInner,
			"",
		);
		const rightHead = truncateToWidth(
			(this.focus === "log" ? "▸" : " ") +
				(cur
					? `${cur.name} · ${cur.status} · ${cur.mode}${cur.blocking ? " · block" : " · async"}`
					: "(none)"),
			rightInner,
			"",
		);
		out.push(
			border("│") +
				fg("dim", leftHead.padEnd(leftInner)) +
				border("│") +
				fg("dim", rightHead.padEnd(rightInner)) +
				border("│"),
		);
		out.push(
			border("├") +
				border("─".repeat(leftInner)) +
				border("┼") +
				border("─".repeat(rightInner)) +
				border("┤"),
		);

		const wrapped = cur
			? this.transcriptLines(cur, this.logInnerW)
			: ["\x1b[2m(no sidecar selected)\x1b[22m"];
		const maxScroll = Math.max(0, wrapped.length - this.viewportH);
		if (this.scrollOffset < 0) this.scrollOffset = 0;
		if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;
		// Pin to bottom while following; re-arm follow when user reaches end again.
		if (this.follow || this.scrollOffset >= maxScroll) {
			this.follow = true;
			this.scrollOffset = maxScroll;
			this.wasAtBottom = true;
		} else {
			this.wasAtBottom = false;
		}
		const visible = wrapped.slice(this.scrollOffset, this.scrollOffset + this.viewportH);

		for (let i = 0; i < this.viewportH; i++) {
			// left cell
			let leftCell: string;
			if (i < views.length) {
				const v = views[i]!;
				const mark = i === this.selected ? "●" : "○";
				const raw = truncateToWidth(`${mark} ${v.name}`, leftInner, "");
				const colored = i === this.selected ? bold(fg("accent", raw)) : raw;
				leftCell = colored + " ".repeat(Math.max(0, leftInner - visibleWidth(raw)));
			} else if (i === 0 && !views.length) {
				const raw = truncateToWidth("(empty)", leftInner, "");
				leftCell = fg("dim", raw) + " ".repeat(Math.max(0, leftInner - visibleWidth(raw)));
			} else {
				leftCell = " ".repeat(leftInner);
			}

			const logLine = visible[i] ?? "";
			const rightRaw = truncateToWidth(" " + logLine, rightInner, "");
			const rightCell = rightRaw + " ".repeat(Math.max(0, rightInner - visibleWidth(rightRaw)));

			out.push(border("│") + leftCell + border("│") + rightCell + border("│"));
		}

		const scrollInfo =
			maxScroll > 0
				? `↑${this.scrollOffset} ↓${Math.max(0, maxScroll - this.scrollOffset)}`
				: "·";
		const escHint = this.opts.waitMode ? "Esc cancel" : "Esc close";
		const hints = `Tab pane · ↑↓ · wheel=log · Shift+S stop · ${escHint}`;
		const foot = truncateToWidth(` ${scrollInfo}  ${hints}`, totalW - 2, "");
		const footPad = foot + " ".repeat(Math.max(0, totalW - 2 - visibleWidth(foot)));
		out.push(border("│") + fg("dim", footPad) + border("│"));
		out.push(border("╰" + "─".repeat(totalW - 2) + "╯"));
		return out;
	}
}

export async function showSidecarStatusOverlay(
	ctx: ExtensionContext | ExtensionCommandContext,
	source: StatusOverlaySource,
	opts: StatusOverlayOptions = {},
): Promise<void> {
	if (!ctx.hasUI) return;
	let overlay: SidecarStatusOverlay | null = null;
	try {
		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => {
				overlay = new SidecarStatusOverlay(tui, theme, source, () => done(), opts, ctx.cwd);
				return {
					render: (w) => overlay!.render(w),
					invalidate: () => {},
					handleInput: (data) => overlay!.handleInput(data),
					dispose: () => overlay?.dispose(),
				};
			},
			{
				overlay: true,
				overlayOptions: {
					width: "82%",
					minWidth: 56,
					maxHeight: "80%",
					anchor: "top-center",
					margin: { top: 1, left: 2, right: 2 },
					nonCapturing: true,
				},
				onHandle: (handle) => {
					overlay?.setHandle(handle);
					handle.focus();
				},
			},
		);
	} finally {
		overlay?.dispose();
	}
}
