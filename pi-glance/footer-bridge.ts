import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { stripControls } from "./format.js";
import type { GlanceConfig, GlanceState, GoalSnapshot } from "./types.js";

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;
const REVIEW_STATUS_KEYS = ["review-live", "review"] as const;

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

function reviewStatusText(footerData: ReadonlyFooterDataProvider): string | undefined {
	const statuses = footerData.getExtensionStatuses();
	for (const key of REVIEW_STATUS_KEYS) {
		const value = statuses.get(key);
		if (value && stripControls(value).trim()) return stripControls(value).trim();
	}
	return undefined;
}

function renderReviewFooterLine(footerData: ReadonlyFooterDataProvider, width: number, now = Date.now()): string | undefined {
	const status = reviewStatusText(footerData);
	if (!status || width <= 0) return undefined;
	const marker = SPINNER_FRAMES[Math.floor(now / 250) % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
	return truncateToWidth(`${marker} ${status}`, width, "…");
}

export class GlanceFooterBridge implements Component {
	private goalTimer: ReturnType<typeof setInterval> | undefined;
	private reviewTimer: ReturnType<typeof setInterval> | undefined;

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
		this.stopReviewTimer();
	}

	invalidate(): void {
		this.sync();
	}

	render(width: number): string[] {
		this.sync();
		const lines: string[] = [];
		const goalLine = renderGoalFooterLine(this.getState(), this.getConfig(), width);
		const reviewLine = renderReviewFooterLine(this.footerData, width);
		if (goalLine) lines.push(goalLine);
		if (reviewLine) lines.push(reviewLine);
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
		this.syncReviewTimer();
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

	private syncReviewTimer(): void {
		const shouldSpin = !!reviewStatusText(this.footerData) && !!this.requestRender;
		if (!shouldSpin) {
			this.stopReviewTimer();
			return;
		}
		if (this.reviewTimer) return;
		this.reviewTimer = setInterval(() => this.requestRender?.(), 250);
	}

	private stopGoalTimer(): void {
		if (!this.goalTimer) return;
		clearInterval(this.goalTimer);
		this.goalTimer = undefined;
	}

	private stopReviewTimer(): void {
		if (!this.reviewTimer) return;
		clearInterval(this.reviewTimer);
		this.reviewTimer = undefined;
	}
}
