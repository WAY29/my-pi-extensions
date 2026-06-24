import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { stripControls } from "./format.js";
import type { GlanceConfig, GlanceState, GoalSnapshot } from "./types.js";

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;
const REVIEW_STATUS_KEYS = ["review-live", "review"] as const;
const DEBUG_STATUS_KEYS = ["pi-debug-mode"] as const;
const DEBUG_SPINNING_PHASE_PREFIXES = ["Debug Collecting", "Debug Analyzing", "Debug Fixing", "Debug Cleanup"] as const;
const DEBUG_STATUS_MARKER = /^[●•◦]\s*/;

function formatElapsed(seconds: number): string {
	const safeSeconds = Math.max(0, Math.floor(seconds));
	if (safeSeconds < 60) return `${safeSeconds}s`;
	const minutes = Math.floor(safeSeconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remMinutes = minutes % 60;
	return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

function elapsedSeconds(goal: GoalSnapshot, now: number): number {
	const activeStartedAt = goal.status === "active" && typeof goal.activeTurnStartedAt === "number" ? goal.activeTurnStartedAt : null;
	const activeDelta = activeStartedAt === null ? 0 : Math.max(0, Math.floor((now - activeStartedAt) / 1000));
	return Math.max(0, goal.timeUsedSeconds + activeDelta);
}

function goalMarker(goal: GoalSnapshot, now: number): string {
	if (goal.status === "active") return SPINNER_FRAMES[Math.floor(now / 250) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
	if (goal.status === "paused") return "‖";
	if (goal.status === "budget_limited") return "!";
	return "";
}

export function renderGoalFooterLine(state: GlanceState, config: GlanceConfig, width: number, now = Date.now()): string | undefined {
	const goal = state.goal;
	if (!config.goal.enabled || !goal || goal.status === "complete" || width <= 0) return undefined;

	const marker = goalMarker(goal, now);
	const prefix = marker ? `${marker} goal ` : "goal ";
	const suffix = ` · ${formatElapsed(elapsedSeconds(goal, now))}`;
	const objectiveBudget = Math.max(0, width - visibleWidth(prefix) - visibleWidth(suffix));
	const objective = truncateToWidth(stripControls(goal.objective), objectiveBudget, "…");
	return truncateToWidth(`${prefix}${objective}${suffix}`, width, "…");
}

function firstStatusText(footerData: ReadonlyFooterDataProvider, keys: readonly string[]): string | undefined {
	const statuses = footerData.getExtensionStatuses();
	for (const key of keys) {
		const value = statuses.get(key);
		if (value && stripControls(value).trim()) return stripControls(value).trim();
	}
	return undefined;
}

function reviewStatusText(footerData: ReadonlyFooterDataProvider): string | undefined {
	return firstStatusText(footerData, REVIEW_STATUS_KEYS);
}

function debugStatusText(footerData: ReadonlyFooterDataProvider): string | undefined {
	return firstStatusText(footerData, DEBUG_STATUS_KEYS);
}

function renderReviewFooterLine(footerData: ReadonlyFooterDataProvider, width: number, now = Date.now()): string | undefined {
	const status = reviewStatusText(footerData);
	if (!status || width <= 0) return undefined;
	const marker = SPINNER_FRAMES[Math.floor(now / 250) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
	return truncateToWidth(`${marker} ${status}`, width, "…");
}

function stripDebugStatusMarker(status: string): string {
	return status.replace(DEBUG_STATUS_MARKER, "");
}

function shouldSpinDebugStatus(status: string): boolean {
	const normalized = stripDebugStatusMarker(status);
	return DEBUG_SPINNING_PHASE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function renderDebugFooterLine(footerData: ReadonlyFooterDataProvider, width: number, now = Date.now()): string | undefined {
	const status = debugStatusText(footerData);
	if (!status || width <= 0) return undefined;
	if (!shouldSpinDebugStatus(status)) return truncateToWidth(status, width, "…");
	const marker = SPINNER_FRAMES[Math.floor(now / 250) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
	return truncateToWidth(`${marker} ${stripDebugStatusMarker(status)}`, width, "…");
}

export class GlanceFooterBridge implements Component {
	private goalTimer: ReturnType<typeof setInterval> | undefined;
	private statusTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly getState: () => GlanceState,
		private readonly getConfig: () => GlanceConfig,
		private readonly footerData: ReadonlyFooterDataProvider,
		private readonly requestRender?: () => void,
	) {
		this.sync();
	}

	dispose(): void {
		this.stopGoalTimer();
		this.stopStatusTimer();
	}

	invalidate(): void {
		this.sync();
	}

	render(width: number): string[] {
		this.sync();
		const lines: string[] = [];
		const now = Date.now();
		const goalLine = renderGoalFooterLine(this.getState(), this.getConfig(), width, now);
		const reviewLine = renderReviewFooterLine(this.footerData, width, now);
		const debugLine = renderDebugFooterLine(this.footerData, width, now);
		if (goalLine) lines.push(goalLine);
		if (reviewLine) lines.push(reviewLine);
		if (debugLine) lines.push(debugLine);
		return lines;
	}

	private sync(): void {
		const state = this.getState();
		let changed = false;

		const providerCount = this.footerData.getAvailableProviderCount();
		if (state.providers.availableCount !== providerCount) {
			state.providers.availableCount = providerCount;
			changed = true;
		}

		this.syncGoalTimer(state);
		this.syncStatusTimer();
		if (changed) state.version++;
	}

	private syncGoalTimer(state: GlanceState): void {
		const shouldSpin = this.getConfig().goal.enabled && state.goal?.status === "active";
		if (!shouldSpin || !this.requestRender) {
			this.stopGoalTimer();
			return;
		}
		if (this.goalTimer) return;
		this.goalTimer = setInterval(() => this.requestRender?.(), 250);
	}

	private syncStatusTimer(): void {
		const debugStatus = debugStatusText(this.footerData);
		const shouldSpin = (!!reviewStatusText(this.footerData) || (!!debugStatus && shouldSpinDebugStatus(debugStatus))) && !!this.requestRender;
		if (!shouldSpin) {
			this.stopStatusTimer();
			return;
		}
		if (this.statusTimer) return;
		this.statusTimer = setInterval(() => this.requestRender?.(), 250);
	}

	private stopGoalTimer(): void {
		if (!this.goalTimer) return;
		clearInterval(this.goalTimer);
		this.goalTimer = undefined;
	}

	private stopStatusTimer(): void {
		if (!this.statusTimer) return;
		clearInterval(this.statusTimer);
		this.statusTimer = undefined;
	}
}
