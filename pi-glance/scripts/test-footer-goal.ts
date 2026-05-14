import { strict as assert } from "node:assert";
import { defaultConfig } from "../config.js";
import { stripControls } from "../format.js";
import { renderGoalFooterLine } from "../footer-bridge.js";
import { testState } from "./helpers.js";

const config = defaultConfig();

const activeLine = stripControls(
	renderGoalFooterLine(
		testState({
			goal: {
				id: "goal-1",
				objective: "finish the pi-goal and pi-glance integration",
				status: "active",
				timeUsedSeconds: 10,
				activeTurnStartedAt: 0,
			},
		}),
		config,
		120,
		2000,
	) ?? "",
);
assert.equal(activeLine, "◐ goal finish the pi-goal and pi-glance integration · 12s", "active goal footer shows spinner, objective, and live duration");

const pausedLine = stripControls(
	renderGoalFooterLine(
		testState({
			goal: {
				id: "goal-1",
				objective: "wait for user confirmation",
				status: "paused",
				timeUsedSeconds: 90,
				activeTurnStartedAt: null,
			},
		}),
		config,
		120,
		2000,
	) ?? "",
);
assert.equal(pausedLine, "‖ goal wait for user confirmation · 1m", "paused goal footer stays visible without spinning");

const completeLine = renderGoalFooterLine(
	testState({
		goal: {
			id: "goal-1",
			objective: "done",
			status: "complete",
			timeUsedSeconds: 42,
			activeTurnStartedAt: null,
		},
	}),
	config,
	120,
	2000,
);
assert.equal(completeLine, undefined, "completed goals are hidden from the footer");

const truncatedLine = stripControls(
	renderGoalFooterLine(
		testState({
			goal: {
				id: "goal-1",
				objective: "this objective is intentionally long",
				status: "active",
				timeUsedSeconds: 0,
				activeTurnStartedAt: 0,
			},
		}),
		config,
		24,
		0,
	) ?? "",
);
assert.equal(truncatedLine, "◐ goal this object… · 0s", "goal footer truncates the objective to fit");

const disabledConfig = defaultConfig();
disabledConfig.goal.enabled = false;
const disabledLine = renderGoalFooterLine(
	testState({
		goal: {
			id: "goal-1",
			objective: "hidden by user preference",
			status: "active",
			timeUsedSeconds: 0,
			activeTurnStartedAt: 0,
		},
	}),
	disabledConfig,
	120,
	0,
);
assert.equal(disabledLine, undefined, "goal footer setting hides active goals");

console.log("✓ goal footer render checks passed");
