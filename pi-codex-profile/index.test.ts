import assert from "node:assert/strict";
import test from "node:test";
import { applyCodexUserAgent } from "./index.ts";

test("applies Codex UA for gpt models and strips existing user-agent casings", () => {
	const headers: Record<string, string | null> = {
		"user-agent": "old",
		"X-Other": "1",
	};
	assert.equal(applyCodexUserAgent(headers, { id: "gpt-5" }), true);
	assert.equal(headers["user-agent"], null);
	assert.equal(headers["User-Agent"]?.startsWith("Codex Desktop/"), true);
	assert.equal(headers["X-Other"], "1");
});

test("skips non-gpt models", () => {
	const headers: Record<string, string | null> = { "User-Agent": "keep" };
	assert.equal(applyCodexUserAgent(headers, { id: "claude-opus-4" }), false);
	assert.equal(headers["User-Agent"], "keep");
});
