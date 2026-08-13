import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createHerdrNotifyHookAdapter } from "./herdr";

const ENV_KEYS = ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID"] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
	(typeof ENV_KEYS)[number],
	string | undefined
>;

function restoreEnv() {
	for (const key of ENV_KEYS) {
		const value = ORIGINAL_ENV[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function makePi() {
	const emitted: Array<{ name: string; data: unknown }> = [];
	const pi = {
		events: {
			emit(name: string, data: unknown) {
				emitted.push({ name, data });
			},
		},
	} as unknown as ExtensionAPI;
	return { pi, emitted };
}

describe("createHerdrNotifyHookAdapter", () => {
	beforeEach(restoreEnv);
	afterEach(restoreEnv);

	test("returns null when herdr env is missing", () => {
		delete process.env.HERDR_ENV;
		delete process.env.HERDR_SOCKET_PATH;
		delete process.env.HERDR_PANE_ID;
		expect(createHerdrNotifyHookAdapter(makePi().pi)).toBeNull();
	});

	test("attention wait emits herdr:blocked active true/false", async () => {
		process.env.HERDR_ENV = "1";
		process.env.HERDR_SOCKET_PATH = "/tmp/herdr.sock";
		process.env.HERDR_PANE_ID = "pane-1";

		const { pi, emitted } = makePi();
		const adapter = createHerdrNotifyHookAdapter(pi);
		expect(adapter).not.toBeNull();

		await adapter!.fire({
			eventName: "request_user_input",
			source: "attention_start",
			details: { source: "AskUserQuestion", kind: "input" },
		});
		await adapter!.fire({
			eventName: "Start",
			source: "attention_end",
		});
		// regular Start must not clear/block
		await adapter!.fire({
			eventName: "Start",
			source: "agent_start",
		});

		expect(emitted).toEqual([
			{ name: "herdr:blocked", data: { active: true, label: "AskUserQuestion" } },
			{ name: "herdr:blocked", data: { active: false } },
		]);
	});
});
