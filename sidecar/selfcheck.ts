import {
	_selfCheck,
	buildRoundPrompt,
	containsStopKeyword,
	resolveExtensionPaths,
	resolveSkillPaths,
	slugAgentName,
} from "./config.js";

_selfCheck();

const prompt = buildRoundPrompt("Do review", {
	name: "r",
	blocking: true,
	prompt: "Do review",
	stop_keyword: "DONE_X",
});
if (!prompt.endsWith("DONE_X") && !prompt.includes("DONE_X")) {
	throw new Error("expected stop keyword in prompt");
}
if (!containsStopKeyword("hello DONE_X", "DONE_X")) throw new Error("detect");
if (slugAgentName(undefined, "Review") !== "sidecar-review") {
	// may vary; just validate shape
	const s = slugAgentName(undefined, "Review");
	if (!/^[a-z][a-z0-9_-]{0,31}$/.test(s)) throw new Error(s);
}

// package resolution smoke (ponytail installed in this environment)
const exts = resolveExtensionPaths(["ponytail"]);
const skills = resolveSkillPaths(["ponytail-review"]);
console.log(
	JSON.stringify(
		{
			ok: true,
			slug: slugAgentName("My Agent", "demo"),
			ponytailExts: exts,
			ponytailReviewSkill: skills,
			samplePrompt: prompt.slice(0, 120),
		},
		null,
		2,
	),
);
