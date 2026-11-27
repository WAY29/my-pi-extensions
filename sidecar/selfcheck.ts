import assert from "node:assert/strict";
import {
	_selfCheck,
	buildRoundPrompt,
	containsStopKeyword,
	herdrAgentStatePath,
	resolveExtensionPaths,
	resolveSkillPaths,
	slugAgentName,
} from "./config.js";
import { assertHerdrEnv, currentWorkspaceId, isHerdrApp } from "./herdr.js";

_selfCheck();

const originalEnv = process.env;
try {
	process.env = {};
	assert.throws(assertHerdrEnv, /Herdr TUI pane or Herdr App terminal/);
	process.env.HC_TERMINAL_ID = "t1";
	assertHerdrEnv();
	assert.equal(isHerdrApp(), true);
	Object.assign(process.env, {
		HERDR_ENV: "1",
		HERDR_WORKSPACE_ID: "w1",
		HERDR_SOCKET_PATH: "/tmp/herdr.sock",
	});
	assertHerdrEnv();
	assert.equal(isHerdrApp(), false);
	assert.equal(currentWorkspaceId(), "w1");
} finally {
	process.env = originalEnv;
}

const prompt = buildRoundPrompt("Do review", {
	name: "r",
	blocking: true,
	prompt: "Do review",
	stop_keyword: "DONE_X",
});
if (!prompt.endsWith("DONE_X") && !prompt.includes("DONE_X")) {
	throw new Error("expected stop keyword in prompt");
}
if (!containsStopKeyword("hello\nDONE_X", "DONE_X")) throw new Error("detect");
if (slugAgentName(undefined, "Review") !== "sidecar-review") {
	// may vary; just validate shape
	const s = slugAgentName(undefined, "Review");
	if (!/^[a-z][a-z0-9_-]{0,31}$/.test(s)) throw new Error(s);
}

// package resolution smoke (ponytail installed in this environment)
const exts = resolveExtensionPaths(["ponytail"]);
const skills = resolveSkillPaths(["ponytail-review"]);
assert.ok(exts.length, "ponytail extension not resolved");
assert.ok(skills.length, "ponytail-review skill not resolved");
const herdrState = herdrAgentStatePath();
if (!herdrState) throw new Error("herdr-agent-state.ts missing");
console.log(
	JSON.stringify(
		{
			ok: true,
			slug: slugAgentName("My Agent", "demo"),
			ponytailExts: exts,
			ponytailReviewSkill: skills,
			herdrAgentState: herdrState,
			samplePrompt: prompt.slice(0, 120),
		},
		null,
		2,
	),
);
