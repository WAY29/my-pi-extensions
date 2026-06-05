import { strict as assert } from "node:assert";
import { defaultConfig } from "../config.js";
import { stripControls } from "../format.js";
import { renderDebugFooterLine, renderGoalFooterLine } from "../footer-bridge.js";
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

const footerData = {
	getExtensionStatuses() {
		return new Map<string, string>([["pi-debug-mode", "● Debug Collecting · login spinner frozen · 12 logs · 1s ago"]]);
	},
	getAvailableProviderCount() {
		return 1;
	},
};

const debugCollectingA = stripControls(renderDebugFooterLine(footerData as any, 120, 0) ?? "");
const debugCollectingB = stripControls(renderDebugFooterLine(footerData as any, 120, 250) ?? "");
assert.equal(
	debugCollectingA,
	"◐ Debug Collecting · login spinner frozen · 12 logs · 1s ago",
	"collecting debug footer should render an animated marker",
);
assert.equal(
	debugCollectingB,
	"◓ Debug Collecting · login spinner frozen · 12 logs · 1s ago",
	"collecting debug footer should advance frames over time",
);

const waitingFooterData = {
	getExtensionStatuses() {
		return new Map<string, string>([["pi-debug-mode", "● Debug Waiting for repro · login spinner frozen · 12 logs · 1s ago"]]);
	},
	getAvailableProviderCount() {
		return 1;
	},
};
assert.equal(
	stripControls(renderDebugFooterLine(waitingFooterData as any, 120, 0) ?? ""),
	"● Debug Waiting for repro · login spinner frozen · 12 logs · 1s ago",
	"waiting-for-repro debug footer should stay static",
);

const verifyingFooterData = {
	getExtensionStatuses() {
		return new Map<string, string>([["pi-debug-mode", "● Debug Verifying · login spinner frozen · 12 logs · 1s ago"]]);
	},
	getAvailableProviderCount() {
		return 1;
	},
};
assert.equal(
	stripControls(renderDebugFooterLine(verifyingFooterData as any, 120, 250) ?? ""),
	"● Debug Verifying · login spinner frozen · 12 logs · 1s ago",
	"verifying debug footer should stay static until human verification finishes",
);

const fixingFooterData = {
	getExtensionStatuses() {
		return new Map<string, string>([["pi-debug-mode", "● Debug Fixing · login spinner frozen · 12 logs · 1s ago"]]);
	},
	getAvailableProviderCount() {
		return 1;
	},
};
assert.equal(
	stripControls(renderDebugFooterLine(fixingFooterData as any, 120, 500) ?? ""),
	"◑ Debug Fixing · login spinner frozen · 12 logs · 1s ago",
	"fixing debug footer should reuse the animated footer frames",
);

console.log("✓ goal/debug footer render checks passed");
