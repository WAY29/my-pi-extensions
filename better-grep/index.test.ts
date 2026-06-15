import { beforeEach, describe, expect, mock, test } from "bun:test";

type GrepInput = {
	pattern: string;
	literal?: boolean;
};

const calls: GrepInput[] = [];

function createBaseDefinition(options?: { failWith?: Error }) {
	return {
		name: "grep",
		label: "grep",
		description: "base grep",
		promptSnippet: "base snippet",
		promptGuidelines: ["base guideline"],
		parameters: { base: true },
		async execute(_toolCallId: string, params: GrepInput) {
			calls.push(params);
			if (!params.literal && options?.failWith) throw options.failWith;
			return {
				content: [{ type: "text", text: "match.go:1: AuthSpecialUser(" }],
				details: { matchCount: 1 },
			};
		},
	};
}

async function loadBetterGrepModule() {
	calls.length = 0;
	mock.module("@earendil-works/pi-coding-agent", () => ({}));
	mock.module("../grep-tool-coordinator", () => ({
		ensureGrepToolRegistered: () => undefined,
		registerGrepToolPlugin: () => undefined,
		releaseGrepToolOwner: () => undefined,
	}));
	mock.module("typebox", () => ({
		Type: {
			Object: (value: unknown) => value,
			Optional: (value: unknown) => value,
			String: (value: unknown) => value,
			Boolean: (value: unknown) => value,
			Number: (value: unknown) => value,
		},
	}));
	return import(`./index.ts?cacheBust=${Date.now()}-${Math.random()}`);
}

beforeEach(() => {
	mock.restore();
	calls.length = 0;
});

describe("better-grep regex fallback", () => {
	test("retries invalid regex patterns as literal searches", async () => {
		const { createBetterGrepToolDefinition } = await loadBetterGrepModule();
		const tool = createBetterGrepToolDefinition(createBaseDefinition({
			failWith: new Error("rg: regex parse error:\n    AuthSpecialUser(\n                   ^\nerror: unclosed group"),
		}) as never);

		const result = await tool.execute(
			"call-1",
			{ pattern: "AuthSpecialUser(" },
			undefined,
			undefined,
			{ cwd: "/repo" } as never,
		);

		expect(calls).toEqual([{ pattern: "AuthSpecialUser(" }, { pattern: "AuthSpecialUser(", literal: true }]);
		expect(result.content[0].text).toContain("retried with literal=true");
		expect(result.details.betterGrep.literalRetry).toBe(true);
	});

	test("does not retry when literal is already true", async () => {
		const { createBetterGrepToolDefinition } = await loadBetterGrepModule();
		const tool = createBetterGrepToolDefinition(createBaseDefinition({
			failWith: new Error("rg: regex parse error: still bad"),
		}) as never);

		await expect(
			tool.execute("call-1", { pattern: "AuthSpecialUser(", literal: true }, undefined, undefined, { cwd: "/repo" } as never),
		).resolves.toEqual({
			content: [{ type: "text", text: "match.go:1: AuthSpecialUser(" }],
			details: { matchCount: 1 },
		});
		expect(calls).toEqual([{ pattern: "AuthSpecialUser(", literal: true }]);
	});

	test("passes through non-regex errors", async () => {
		const { createBetterGrepToolDefinition } = await loadBetterGrepModule();
		const tool = createBetterGrepToolDefinition(createBaseDefinition({
			failWith: new Error("Path not found: /missing"),
		}) as never);

		await expect(tool.execute("call-1", { pattern: "AuthSpecialUser(" }, undefined, undefined, { cwd: "/repo" } as never)).rejects.toThrow(
			/Path not found/,
		);
		expect(calls).toEqual([{ pattern: "AuthSpecialUser(" }]);
	});
});
