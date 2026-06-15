import { beforeEach, describe, expect, mock, test } from "bun:test";

type GrepInput = { pattern: string; literal?: boolean };

type RegisteredTool = {
	name: string;
	execute: (toolCallId: string, params: GrepInput, signal?: AbortSignal, onUpdate?: unknown, ctx?: { cwd: string }) => Promise<unknown>;
	renderCall?: () => string;
};

const registrations: RegisteredTool[] = [];
const calls: GrepInput[] = [];

async function loadCoordinator(options?: { failWith?: Error }) {
	registrations.length = 0;
	calls.length = 0;
	mock.module("@earendil-works/pi-coding-agent", () => ({
		createGrepToolDefinition: () => ({
			name: "grep",
			label: "grep",
			description: "base grep",
			parameters: { base: true },
			async execute(_toolCallId: string, params: GrepInput) {
				calls.push(params);
				if (!params.literal && options?.failWith) throw options.failWith;
				return { content: [{ type: "text", text: "ok" }] };
			},
		}),
	}));
	return import(`./grep-tool-coordinator.ts?cacheBust=${Date.now()}-${Math.random()}`);
}

beforeEach(() => {
	mock.restore();
	registrations.length = 0;
	calls.length = 0;
});

describe("grep-tool-coordinator", () => {
	test("composes execution and rendering wrappers into one grep tool", async () => {
		const coordinator = await loadCoordinator({
			failWith: new Error("rg: regex parse error:\nerror: unclosed group"),
		});
		const pi = {
			registerTool(tool: RegisteredTool) {
				registrations.push(tool);
			},
		} as never;

		coordinator.registerGrepToolPlugin(pi, {
			id: "better-grep-test",
			priority: -10,
			wrapDefinition: (definition) => ({
				...definition,
				async execute(toolCallId, params, signal, onUpdate, ctx) {
					try {
						return await definition.execute(toolCallId, params, signal, onUpdate, ctx);
					} catch (error) {
						if (!String(error).includes("regex parse error")) throw error;
						return definition.execute(toolCallId, { ...params, literal: true }, signal, onUpdate, ctx);
					}
				},
			}),
		});
		coordinator.registerGrepToolPlugin(pi, {
			id: "summary-test",
			wrapDefinition: (definition) => ({
				...definition,
				renderCall: () => "summary-render",
			}),
		});

		coordinator.ensureGrepToolRegistered(pi, "/repo");
		const tool = registrations.at(-1)!;

		expect(tool.renderCall?.()).toBe("summary-render");
		await expect(tool.execute("call-1", { pattern: "AuthSpecialUser(" }, undefined, undefined, { cwd: "/repo" })).resolves.toEqual({
			content: [{ type: "text", text: "ok" }],
		});
		expect(calls).toEqual([{ pattern: "AuthSpecialUser(" }, { pattern: "AuthSpecialUser(", literal: true }]);
	});
});
