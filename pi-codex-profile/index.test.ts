import assert from "node:assert/strict";
import test from "node:test";
import { applyCodexProfile } from "./index.ts";

test("applies Codex official headers for gpt models and strips old casings", () => {
	const headers: Record<string, string | null> = {
		"user-agent": "old",
		ORIGINATOR: "old-origin",
		Version: "0.1.0",
		"X-Codex-Window-Id": "old-win",
		"X-Other": "1",
	};

	assert.equal(applyCodexProfile(headers, { id: "gpt-5" }, "win-1"), true);

	assert.equal(headers["user-agent"], null);
	assert.equal(headers.ORIGINATOR, null);
	assert.equal(headers.Version, null);
	assert.equal(headers["X-Codex-Window-Id"], null);

	assert.equal(
		headers["User-Agent"],
		"codex-tui/0.146.0 (Mac OS X 15.0; arm64) xterm-256color",
	);
	assert.equal(headers.originator, "codex-tui");
	assert.equal(headers.version, "0.146.0");
	assert.equal(headers["x-codex-window-id"], "win-1");
	assert.equal(headers["X-Other"], "1");
});

test("skips non-gpt models", () => {
	const headers: Record<string, string | null> = { "User-Agent": "keep" };
	assert.equal(applyCodexProfile(headers, { id: "claude-opus-4" }), false);
	assert.equal(headers["User-Agent"], "keep");
	assert.equal(headers["x-codex-window-id"], undefined);
});
