import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { stripControls } from "./format.js";
import type { GlanceConfig, GlanceState, GoalSnapshot } from "./types.js";

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;

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

export class GlanceFooterBridge implements Component {
	private goalTimer: ReturnType<typeof setInterval> | undefined;

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
	}

	invalidate(): void {
		this.sync();
	}

	render(width: number): string[] {
		this.sync();
		const line = renderGoalFooterLine(this.getState(), this.getConfig(), width);
		return line ? [line] : [];
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

	private stopGoalTimer(): void {
		if (!this.goalTimer) return;
		clearInterval(this.goalTimer);
		this.goalTimer = undefined;
	}
}
