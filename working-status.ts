import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

type ActionKey =
	| "working"
	| "thinking"
	| "responding"
	| "bash"
	| "read"
	| "grep"
	| "find"
	| "ls"
	| "patch"
	| "edit"
	| "write"
	| "otherTool";

type ActiveTool = {
	toolCallId: string;
	action: ActionKey;
	startedAt: number;
};

/** Duck-typed AssistantMessageComponent. */
interface ThinkingLabelTarget {
	setHiddenThinkingLabel(label: string): void;
	setHideThinkingBlock(hide: boolean): void;
}

type State = {
	agentStartedAt: number | null;
	currentAction: ActionKey | null;
	activeTools: Map<string, ActiveTool>;
	finishedDurationMs: number | null;
	timer: ReturnType<typeof setInterval> | null;
	lastCtx: ExtensionContext | null;
	capturedTui: TUI | undefined;
	/** Wall-clock start of the active thinking segment; null when paused/idle. */
	thinkingStartedAt: number | null;
	/** Frozen duration from earlier segments on the same assistant message. */
	thinkingAccumulatedMs: number;
	/** Component currently receiving live/frozen thinking labels. */
	thinkingTarget: ThinkingLabelTarget | null;
	thinkingTicker: ReturnType<typeof setInterval> | null;
};

const STATUS_KEY = "00-working-status";
const FINISHED_WIDGET_KEY = "working-status-finished";
const TUI_CAPTURE_WIDGET_KEY = "working-status-tui-capture";
const TICK_MS = 1000;
const THINKING_TICK_MS = 250;
const THINKING_BASE_LABEL = "thoughts";
const ACTION_LABELS: Record<ActionKey, string> = {
	working: "Working...",
	thinking: "Thinking...",
	responding: "Writing Response...",
	bash: "Running Command...",
	read: "Reading File...",
	grep: "Searching Text...",
	find: "Finding Files...",
	ls: "Listing Directory...",
	patch: "Patching...",
	edit: "Editing File...",
	write: "Writing File...",
	otherTool: "Using Tool...",
};

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`;
	}

	if (totalMinutes > 0) {
		return `${totalMinutes}m ${seconds}s`;
	}

	return `${seconds}s`;
}

function formatThinkingDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0.0s";
	if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
	const totalSeconds = Math.round(ms / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	return `${minutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
}

function toolToAction(toolName: string): ActionKey {
	switch (toolName) {
		case "bash":
			return "bash";
		case "read":
			return "read";
		case "grep":
			return "grep";
		case "find":
			return "find";
		case "ls":
			return "ls";
		case "apply_patch":
			return "patch";
		case "edit":
			return "edit";
		case "write":
			return "write";
		default:
			return "otherTool";
	}
}

function getEffectiveAction(state: State): ActionKey | null {
	if (state.agentStartedAt == null) return null;
	return state.currentAction ?? "working";
}

function clearFinishedWidget(ctx: ExtensionContext) {
	ctx.ui.setWidget(FINISHED_WIDGET_KEY, undefined);
}

function isThinkingLabelTarget(node: object): node is ThinkingLabelTarget {
	const candidate = node as Partial<ThinkingLabelTarget>;
	return (
		typeof candidate.setHiddenThinkingLabel === "function" &&
		typeof candidate.setHideThinkingBlock === "function"
	);
}

function findThinkingLabelTargets(tui: TUI): ThinkingLabelTarget[] {
	const targets: ThinkingLabelTarget[] = [];
	const seen = new Set<unknown>();
	const walk = (node: unknown): void => {
		if (typeof node !== "object" || node === null || seen.has(node)) return;
		seen.add(node);
		if (isThinkingLabelTarget(node)) targets.push(node);
		const children = (node as { children?: unknown }).children;
		if (Array.isArray(children)) {
			for (const child of children) walk(child);
		}
	};
	walk(tui);
	return targets;
}

function resolveThinkingTarget(state: State): ThinkingLabelTarget | null {
	const tui = state.capturedTui;
	if (!tui) return null;
	return findThinkingLabelTargets(tui).at(-1) ?? null;
}

function thinkingElapsedMs(state: State): number {
	const live = state.thinkingStartedAt != null ? Date.now() - state.thinkingStartedAt : 0;
	return state.thinkingAccumulatedMs + live;
}

function paintThinkingLabel(state: State, label: string): void {
	// Prefer the sticky target so later thinking on a new message never rewrites earlier ones.
	const target = state.thinkingTarget ?? resolveThinkingTarget(state);
	if (target) {
		state.thinkingTarget = target;
		try {
			target.setHiddenThinkingLabel(label);
			state.capturedTui?.requestRender();
			return;
		} catch {
			// fall through
		}
	}
	// Global setter rewrites every assistant message — only use when no per-message target exists.
	const ctx = state.lastCtx;
	if (!ctx?.hasUI) return;
	try {
		ctx.ui.setHiddenThinkingLabel(label);
	} catch {
		// ignore
	}
}

function clearThinkingTicker(state: State): void {
	if (state.thinkingTicker) {
		clearInterval(state.thinkingTicker);
		state.thinkingTicker = null;
	}
}

function stopThinkingTimer(state: State): void {
	clearThinkingTicker(state);
	state.thinkingStartedAt = null;
	state.thinkingAccumulatedMs = 0;
	state.thinkingTarget = null;
}

function tickThinking(state: State): void {
	if (state.thinkingStartedAt == null) return;
	if (!state.thinkingTarget) {
		state.thinkingTarget = resolveThinkingTarget(state);
	}
	const label = `${THINKING_BASE_LABEL} · ${formatThinkingDuration(thinkingElapsedMs(state))}`;
	paintThinkingLabel(state, label);
}

function beginThinkingTimer(state: State): void {
	// Duplicate thinking_start while already live: keep the running clock.
	if (state.thinkingStartedAt != null) return;

	const target = resolveThinkingTarget(state);
	if (target && target !== state.thinkingTarget) {
		// New assistant message component: independent duration.
		state.thinkingTarget = target;
		state.thinkingAccumulatedMs = 0;
	} else if (target) {
		state.thinkingTarget = target;
	}
	// Same target after a pause: resume from thinkingAccumulatedMs (no reset).

	state.thinkingStartedAt = Date.now();
	clearThinkingTicker(state);
	tickThinking(state);
	state.thinkingTicker = setInterval(() => tickThinking(state), THINKING_TICK_MS);
	(state.thinkingTicker as unknown as { unref?: () => void }).unref?.();
}

function finishThinkingTimer(state: State): void {
	if (state.thinkingStartedAt == null) return;
	state.thinkingAccumulatedMs += Date.now() - state.thinkingStartedAt;
	state.thinkingStartedAt = null;
	clearThinkingTicker(state);
	paintThinkingLabel(state, `${THINKING_BASE_LABEL} · ${formatThinkingDuration(state.thinkingAccumulatedMs)}`);
}

function captureTui(state: State, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setWidget(
		TUI_CAPTURE_WIDGET_KEY,
		(tui: TUI) => {
			state.capturedTui = tui;
			const widget: Component & { dispose?(): void } = {
				render: () => [],
				invalidate() {},
				dispose() {
					if (state.capturedTui === tui) state.capturedTui = undefined;
				},
			};
			return widget;
		},
		{ placement: "belowEditor" },
	);
}

function setFinishedAppearance(ctx: ExtensionContext, durationMs: number) {
	const message = `Finished working in ${formatDuration(durationMs)}`;
	const dimMessage = ctx.ui.theme.fg("dim", message);
	ctx.ui.setWorkingMessage(dimMessage);
	ctx.ui.setStatus(STATUS_KEY, dimMessage);
	ctx.ui.setWidget(FINISHED_WIDGET_KEY, [dimMessage]);
}

function setRunningAppearance(ctx: ExtensionContext, state: State) {
	const effectiveAction = getEffectiveAction(state);
	if (!effectiveAction || state.agentStartedAt == null) return;
	const label = ACTION_LABELS[effectiveAction];
	const duration = formatDuration(Date.now() - state.agentStartedAt);
	ctx.ui.setWorkingMessage(`${label} (${duration})`);
	ctx.ui.setStatus(STATUS_KEY, undefined);
	clearFinishedWidget(ctx);
}

function refreshUI(state: State) {
	const ctx = state.lastCtx;
	if (!ctx?.hasUI) return;

	if (state.finishedDurationMs != null) {
		setFinishedAppearance(ctx, state.finishedDurationMs);
		return;
	}

	if (state.agentStartedAt != null) {
		setRunningAppearance(ctx, state);
		return;
	}

	ctx.ui.setWorkingMessage();
	ctx.ui.setStatus(STATUS_KEY, undefined);
	clearFinishedWidget(ctx);
}

function stopTimer(state: State) {
	if (state.timer) {
		clearInterval(state.timer);
		state.timer = null;
	}
}

function ensureTimer(state: State) {
	if (state.timer) return;
	state.timer = setInterval(() => {
		refreshUI(state);
	}, TICK_MS);
}

function resetForNewAgent(state: State) {
	state.agentStartedAt = Date.now();
	state.currentAction = "working";
	state.activeTools.clear();
	state.finishedDurationMs = null;
}

export default function workingStatusExtension(pi: ExtensionAPI) {
	const state: State = {
		agentStartedAt: null,
		currentAction: null,
		activeTools: new Map(),
		finishedDurationMs: null,
		timer: null,
		lastCtx: null,
		capturedTui: undefined,
		thinkingStartedAt: null,
		thinkingAccumulatedMs: 0,
		thinkingTarget: null,
		thinkingTicker: null,
	};

	pi.on("session_start", async (_event, ctx) => {
		state.lastCtx = ctx;
		clearFinishedWidget(ctx);
		captureTui(state, ctx);
		try {
			ctx.ui.setHiddenThinkingLabel(THINKING_BASE_LABEL);
		} catch {
			// ignore
		}
		ctx.ui.setWorkingIndicator({
			frames: [
				ctx.ui.theme.fg("accent", "⠋"),
				ctx.ui.theme.fg("accent", "⠙"),
				ctx.ui.theme.fg("accent", "⠹"),
				ctx.ui.theme.fg("accent", "⠸"),
				ctx.ui.theme.fg("accent", "⠼"),
				ctx.ui.theme.fg("accent", "⠴"),
				ctx.ui.theme.fg("accent", "⠦"),
				ctx.ui.theme.fg("accent", "⠧"),
				ctx.ui.theme.fg("accent", "⠇"),
				ctx.ui.theme.fg("accent", "⠏"),
			],
			intervalMs: 80,
		});
		refreshUI(state);
	});

	pi.on("agent_start", async (_event, ctx) => {
		state.lastCtx = ctx;
		stopThinkingTimer(state);
		resetForNewAgent(state);
		ensureTimer(state);
		refreshUI(state);
	});

	pi.on("message_update", async (event, ctx) => {
		state.lastCtx = ctx;
		const streamEvent = event.assistantMessageEvent;
		const streamEventType = streamEvent?.type;

		if (streamEventType === "thinking_start") {
			beginThinkingTimer(state);
		} else if (streamEventType === "thinking_end") {
			finishThinkingTimer(state);
		}

		if (state.agentStartedAt == null) return;
		if (state.activeTools.size > 0) return;

		if (streamEventType === "thinking_start" || streamEventType === "thinking_delta" || streamEventType === "thinking_end") {
			state.currentAction = "thinking";
			refreshUI(state);
			return;
		}

		if (streamEventType === "toolcall_end") {
			state.currentAction = toolToAction(streamEvent.toolCall.name);
			refreshUI(state);
			return;
		}

		if (streamEventType === "text_start" || streamEventType === "text_delta" || streamEventType === "text_end") {
			state.currentAction = "responding";
			refreshUI(state);
		}
	});

	pi.on("message_end", async (event) => {
		if (event.message && typeof event.message === "object") {
			const message = event.message as { role?: unknown };
			if (message.role === "assistant" && state.thinkingStartedAt != null) {
				finishThinkingTimer(state);
			}
		}
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		state.lastCtx = ctx;
		if (state.agentStartedAt == null) return;
		const action = toolToAction(event.toolName);
		state.activeTools.set(event.toolCallId, {
			toolCallId: event.toolCallId,
			action,
			startedAt: Date.now(),
		});
		state.currentAction = action;
		refreshUI(state);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		state.lastCtx = ctx;
		state.activeTools.delete(event.toolCallId);
	});

	pi.on("agent_end", async (_event, ctx) => {
		state.lastCtx = ctx;
		if (state.thinkingStartedAt != null) finishThinkingTimer(state);
		if (state.agentStartedAt == null) {
			return;
		}
		state.activeTools.clear();
		state.currentAction = null;
		state.finishedDurationMs = Date.now() - state.agentStartedAt;
		state.agentStartedAt = null;
		stopTimer(state);
		refreshUI(state);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		state.lastCtx = ctx;
		stopTimer(state);
		stopThinkingTimer(state);
		state.agentStartedAt = null;
		state.currentAction = null;
		state.activeTools.clear();
		state.finishedDurationMs = null;
		state.capturedTui = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		clearFinishedWidget(ctx);
		ctx.ui.setWidget(TUI_CAPTURE_WIDGET_KEY, undefined);
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
		try {
			ctx.ui.setHiddenThinkingLabel();
		} catch {
			// ignore
		}
	});
}
