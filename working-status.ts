import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ActionKey =
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
	lastToolAction: ActionKey | null;
	activeTools: Map<string, ActiveTool>;
	hasAssistantStreamedText: boolean;
	finishedDurationMs: number | null;
	timer: ReturnType<typeof setInterval> | null;
	lastCtx: ExtensionContext | null;
};

const STATUS_KEY = "00-working-status";
const TICK_MS = 1000;
const ACTION_LABELS: Record<ActionKey, string> = {
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

function getLatestToolAction(state: State): ActionKey | null {
	let latest: ActiveTool | null = null;
	for (const tool of state.activeTools.values()) {
		if (!latest || tool.startedAt >= latest.startedAt) {
			latest = tool;
		}
	}
	return latest?.action ?? null;
}

function getEffectiveAction(state: State): ActionKey | null {
	const latestToolAction = getLatestToolAction(state);
	if (latestToolAction) return latestToolAction;
	if (state.agentStartedAt == null) return null;
	if (state.lastToolAction) return state.lastToolAction;
	return state.currentAction ?? "thinking";
}

function setFinishedAppearance(ctx: ExtensionContext, durationMs: number) {
	const message = ctx.ui.theme.fg("dim", `Finished working in ${formatDuration(durationMs)}`);
	ctx.ui.setWorkingMessage(message);
	ctx.ui.setStatus(STATUS_KEY, message);
}

function setRunningAppearance(ctx: ExtensionContext, state: State) {
	const effectiveAction = getEffectiveAction(state);
	if (!effectiveAction || state.agentStartedAt == null) return;
	const label = ACTION_LABELS[effectiveAction];
	const duration = formatDuration(Date.now() - state.agentStartedAt);
	ctx.ui.setWorkingMessage(`${label} (${duration})`);
	ctx.ui.setStatus(STATUS_KEY, undefined);
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
	state.currentAction = "thinking";
	state.lastToolAction = null;
	state.activeTools.clear();
	state.hasAssistantStreamedText = false;
	state.finishedDurationMs = null;
}

export default function workingStatusExtension(pi: ExtensionAPI) {
	const state: State = {
		agentStartedAt: null,
		currentAction: null,
		lastToolAction: null,
		activeTools: new Map(),
		hasAssistantStreamedText: false,
		finishedDurationMs: null,
		timer: null,
		lastCtx: null,
	};

	pi.on("session_start", async (_event, ctx) => {
		state.lastCtx = ctx;
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

		const streamEventType = event.assistantMessageEvent.type;
		if (streamEventType === "text_start" || streamEventType === "text_delta" || streamEventType === "text_end") {
			state.hasAssistantStreamedText = true;
			if (!state.lastToolAction) {
				state.currentAction = "thinking";
				refreshUI(state);
			}
			return;
		}

		if (!state.hasAssistantStreamedText && !state.lastToolAction) {
			state.currentAction = "thinking";
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
		state.lastToolAction = action;
		refreshUI(state);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		state.lastCtx = ctx;
		state.activeTools.delete(event.toolCallId);
		if (state.agentStartedAt == null) return;
		state.currentAction = state.activeTools.size > 0 ? getLatestToolAction(state) : state.lastToolAction ?? "thinking";
		refreshUI(state);
	});

	pi.on("agent_end", async (_event, ctx) => {
		state.lastCtx = ctx;
		if (state.agentStartedAt == null) {
			return;
		}
		state.activeTools.clear();
		state.currentAction = null;
		state.lastToolAction = null;
		state.hasAssistantStreamedText = false;
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
		state.lastToolAction = null;
		state.activeTools.clear();
		state.hasAssistantStreamedText = false;
		state.finishedDurationMs = null;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
	});
}
