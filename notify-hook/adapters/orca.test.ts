import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __test__, createOrcaNotifyHookAdapter } from "./orca";
import type { NotifyHookContext } from "./types";

type Capture = {
	url: string;
	headers: IncomingMessage["headers"];
	body: string;
};

const ENV_KEYS = [
	"ORCA_PANE_KEY",
	"ORCA_TAB_ID",
	"ORCA_WORKTREE_ID",
	"ORCA_AGENT_HOOK_PORT",
	"ORCA_AGENT_HOOK_TOKEN",
	"ORCA_AGENT_HOOK_ENV",
	"ORCA_AGENT_HOOK_VERSION",
	"ORCA_AGENT_HOOK_ENDPOINT",
	"ORCA_USER_DATA_PATH",
	"ORCA_AGENT_LAUNCH_TOKEN",
	"NOTIFY_HOOK_FORCE_ORCA_ADAPTER",
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function restoreEnv() {
	for (const key of ENV_KEYS) {
		const value = ORIGINAL_ENV[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function makeContext(branch: unknown[]): NotifyHookContext {
	return {
		sessionManager: {
			getBranch: () => branch,
		} as NotifyHookContext["sessionManager"],
	};
}

function parsePayload(body: string): Record<string, unknown> {
	return JSON.parse(body) as Record<string, unknown>;
}

async function startCaptureServer(): Promise<{ server: Server; port: number; captures: Capture[] }> {
	const captures: Capture[] = [];
	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			captures.push({
				url: req.url ?? "",
				headers: req.headers,
				body: Buffer.concat(chunks).toString("utf8"),
			});
			res.writeHead(204);
			res.end();
		});
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no port");
	return { server, port: address.port, captures };
}

describe("createOrcaNotifyHookAdapter", () => {
	let tempDir: string;
	let server: Server | undefined;
	let captures: Capture[];

	beforeEach(() => {
		restoreEnv();
		process.env.NOTIFY_HOOK_FORCE_ORCA_ADAPTER = "1";
		tempDir = mkdtempSync(join(tmpdir(), "notify-hook-orca-"));
		captures = [];
		server = undefined;
	});

	afterEach(async () => {
		restoreEnv();
		rmSync(tempDir, { recursive: true, force: true });
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
		}
	});

	test("returns null without Orca runtime hints", () => {
		delete process.env.ORCA_PANE_KEY;
		delete process.env.ORCA_AGENT_HOOK_PORT;
		delete process.env.ORCA_AGENT_HOOK_TOKEN;
		delete process.env.ORCA_AGENT_HOOK_ENDPOINT;
		expect(createOrcaNotifyHookAdapter()).toBeNull();
	});

	test("UserPromptSubmit posts before_agent_start with event prompt details first", async () => {
		const capture = await startCaptureServer();
		server = capture.server;
		captures = capture.captures;

		process.env.ORCA_PANE_KEY = "tab-1:leaf-1";
		process.env.ORCA_TAB_ID = "tab-1";
		process.env.ORCA_WORKTREE_ID = "wt-1";
		process.env.ORCA_AGENT_HOOK_PORT = String(capture.port);
		process.env.ORCA_AGENT_HOOK_TOKEN = "secret";
		process.env.ORCA_AGENT_HOOK_ENV = "production";
		process.env.ORCA_AGENT_HOOK_VERSION = "1";

		const adapter = createOrcaNotifyHookAdapter();
		expect(adapter).not.toBeNull();
		await adapter!.fire(
			{
				eventName: "UserPromptSubmit",
				source: "before_agent_start",
				details: { prompt: "Ship Orca notify" },
			},
			makeContext([]),
		);

		expect(captures).toHaveLength(1);
		expect(captures[0]?.url).toBe("/hook/pi");
		expect(captures[0]?.headers["x-orca-agent-hook-token"]).toBe("secret");
		const payload = parsePayload(captures[0]!.body);
		expect(payload.paneKey).toBe("tab-1:leaf-1");
		expect(payload.tabId).toBe("tab-1");
		expect(payload.worktreeId).toBe("wt-1");
		expect(payload.payload).toEqual({ hook_event_name: "before_agent_start", prompt: "Ship Orca notify" });
	});

	test("request_user_input posts a synthetic message_end preview and rings BEL", async () => {
		const capture = await startCaptureServer();
		server = capture.server;
		captures = capture.captures;

		process.env.ORCA_PANE_KEY = "tab-1:leaf-1";
		process.env.ORCA_AGENT_HOOK_PORT = String(capture.port);
		process.env.ORCA_AGENT_HOOK_TOKEN = "secret";

		const adapter = createOrcaNotifyHookAdapter();
		expect(adapter).not.toBeNull();
		await adapter!.fire(
			{ eventName: "request_user_input", source: "attention_start" },
			makeContext([
				{
					type: "message",
					message: {
						role: "assistant",
						content: [
							{
								type: "toolCall",
								name: "AskUserQuestion",
								arguments: {
									questions: [
										{ prompt: "Which adapter behavior do you want?" },
										{ prompt: "Should it coexist?" },
									],
								},
							},
						],
					},
				},
			]),
		);

		expect(captures).toHaveLength(1);
		expect(parsePayload(captures[0]!.body).payload).toEqual({
			hook_event_name: "message_end",
			role: "assistant",
			text: "Which adapter behavior do you want? · Should it coexist?",
		});
	});

	test("Stop posts final assistant text before agent_end", async () => {
		const capture = await startCaptureServer();
		server = capture.server;
		captures = capture.captures;

		process.env.ORCA_PANE_KEY = "tab-1:leaf-1";
		process.env.ORCA_AGENT_HOOK_PORT = String(capture.port);
		process.env.ORCA_AGENT_HOOK_TOKEN = "secret";

		const adapter = createOrcaNotifyHookAdapter();
		expect(adapter).not.toBeNull();
		await adapter!.fire(
			{ eventName: "Stop", source: "agent_settled" },
			makeContext([
				{
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Done — notify adapter is wired." }],
					},
				},
			]),
		);

		expect(captures).toHaveLength(2);
		expect(parsePayload(captures[0]!.body).payload).toEqual({
			hook_event_name: "message_end",
			role: "assistant",
			text: "Done — notify adapter is wired.",
		});
		expect(parsePayload(captures[1]!.body).payload).toEqual({ hook_event_name: "agent_end" });
	});

	test("session_shutdown Stop is a no-op for Orca", async () => {
		const capture = await startCaptureServer();
		server = capture.server;
		captures = capture.captures;

		process.env.ORCA_PANE_KEY = "tab-1:leaf-1";
		process.env.ORCA_AGENT_HOOK_PORT = String(capture.port);
		process.env.ORCA_AGENT_HOOK_TOKEN = "secret";

		const adapter = createOrcaNotifyHookAdapter();
		expect(adapter).not.toBeNull();
		await adapter!.fire(
			{ eventName: "Stop", source: "session_shutdown" },
			makeContext([
				{
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "stale assistant text" }],
					},
				},
			]),
		);

		expect(captures).toHaveLength(0);
	});

	test("endpoint file is used only via ORCA_AGENT_HOOK_ENDPOINT", async () => {
		const capture = await startCaptureServer();
		server = capture.server;
		captures = capture.captures;

		process.env.ORCA_PANE_KEY = "tab-1:leaf-1";
		process.env.ORCA_AGENT_HOOK_PORT = "1111";
		process.env.ORCA_AGENT_HOOK_TOKEN = "stale-token";
		process.env.ORCA_AGENT_HOOK_ENDPOINT = join(tempDir, "endpoint.env");
		writeFileSync(
			process.env.ORCA_AGENT_HOOK_ENDPOINT,
			[
				`ORCA_AGENT_HOOK_PORT=${capture.port}`,
				"ORCA_AGENT_HOOK_TOKEN=fresh-token",
				"ORCA_AGENT_HOOK_ENV=production",
				"ORCA_AGENT_HOOK_VERSION=1",
			].join("\n"),
		);

		// Prefer env port over file — env wins, so force empty env port to exercise file path.
		delete process.env.ORCA_AGENT_HOOK_PORT;
		delete process.env.ORCA_AGENT_HOOK_TOKEN;

		const adapter = createOrcaNotifyHookAdapter();
		expect(adapter).not.toBeNull();
		await adapter!.fire({ eventName: "Start", source: "attention_end" }, makeContext([]));

		expect(captures).toHaveLength(1);
		expect(captures[0]?.headers["x-orca-agent-hook-token"]).toBe("fresh-token");
		expect(parsePayload(captures[0]!.body).payload).toEqual({ hook_event_name: "agent_start" });
	});

	test("USER_DATA_PATH alone no longer activates adapter (stale endpoint guard)", () => {
		process.env.ORCA_PANE_KEY = "tab-1:leaf-1";
		process.env.ORCA_USER_DATA_PATH = tempDir;
		delete process.env.ORCA_AGENT_HOOK_PORT;
		delete process.env.ORCA_AGENT_HOOK_TOKEN;
		delete process.env.ORCA_AGENT_HOOK_ENDPOINT;
		const endpointDir = join(tempDir, "agent-hooks");
		mkdirSync(endpointDir, { recursive: true });
		writeFileSync(
			join(endpointDir, "endpoint.env"),
			["ORCA_AGENT_HOOK_PORT=57998", "ORCA_AGENT_HOOK_TOKEN=userdata-token"].join("\n"),
		);

		expect(createOrcaNotifyHookAdapter()).toBeNull();
	});

	test("helper preview falls back to generic text when no richer context exists", () => {
		expect(__test__.previewForUserInput(makeContext([]))).toBe("Needs your input");
	});
});
