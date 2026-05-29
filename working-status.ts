import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ActionKey =
	| "working"
	| "thinking"
	| "responding"
	| "bash"
	| "read"
	| "grep"
	| "find"
	| "ls"
	| "edit"
	| "write"
	| "otherTool";

type ActiveTool = {
	toolCallId: string;
	action: ActionKey;
	startedAt: number;
};

type State = {
	agentStartedAt: number | null;
	currentAction: ActionKey | null;
	activeTools: Map<string, ActiveTool>;
	finishedDurationMs: number | null;
	timer: ReturnType<typeof setInterval> | null;
	lastCtx: ExtensionContext | null;
};

const STATUS_KEY = "00-working-status";
const FINISHED_WIDGET_KEY = "working-status-finished";
const TICK_MS = 1000;
const ACTION_LABELS: Record<ActionKey, string> = {
	working: "Working...",
	thinking: "Thinking...",
	responding: "Writing Response...",
	bash: "Running Command...",
	read: "Reading File...",
	grep: "Searching Text...",
	find: "Finding Files...",
	ls: "Listing Directory...",
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
	};

	pi.on("session_start", async (_event, ctx) => {
		state.lastCtx = ctx;
		clearFinishedWidget(ctx);
		ctx.ui.setWorkingIndicator({
			frames: [ctx.ui.theme.fg("accent", "⠋"), ctx.ui.theme.fg("accent", "⠙"), ctx.ui.theme.fg("accent", "⠹"), ctx.ui.theme.fg("accent", "⠸"), ctx.ui.theme.fg("accent", "⠼"), ctx.ui.theme.fg("accent", "⠴"), ctx.ui.theme.fg("accent", "⠦"), ctx.ui.theme.fg("accent", "⠧"), ctx.ui.theme.fg("accent", "⠇"), ctx.ui.theme.fg("accent", "⠏")],
			intervalMs: 80,
		});
		refreshUI(state);
	});

	pi.on("agent_start", async (_event, ctx) => {
		state.lastCtx = ctx;
		resetForNewAgent(state);
		ensureTimer(state);
		refreshUI(state);
	});

	pi.on("message_update", async (event, ctx) => {
		state.lastCtx = ctx;
		if (state.agentStartedAt == null) return;
		if (state.activeTools.size > 0) return;

		const streamEvent = event.assistantMessageEvent;
		const streamEventType = streamEvent.type;

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
		state.agentStartedAt = null;
		state.currentAction = null;
		state.activeTools.clear();
		state.finishedDurationMs = null;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		clearFinishedWidget(ctx);
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
	});
}
