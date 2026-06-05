import { StringEnum } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Type } from "typebox";

const STATUS_KEY = "00-pi-debug-mode";
const ENTRY_TYPE = "pi-debug-mode-state";
const DEBUG_SKILL_COMMAND_PREFIX = "/skill:debug-mode";
const DEBUG_TOOL_NAMES = ["debug_mode_state", "debug_mode_session"] as const;
const DEBUG_ACTIVE_PHASES: DebugPhase[] = [
	"collecting",
	"waiting-for-repro",
	"analyzing",
	"fixing",
	"verifying",
	"cleanup",
];
const COLLECTOR_SCRIPT = join(getAgentDir(), "skills", "debug-mode", "scripts", "collector.mjs");
const DEBUG_BLOCK_START = "PI_DEBUG_START";
const DEBUG_BLOCK_END = "PI_DEBUG_END";
const DEBUG_BLOCK_REGEX = /^[^\n\r]*PI_DEBUG_START[^\n\r]*\r?\n[\s\S]*?^[^\n\r]*PI_DEBUG_END[^\n\r]*(?:\r?\n)?/gm;
const WALK_SKIP_DIRS = new Set([".git", "node_modules", ".pi-debug"]);

type DebugPhase =
	| "idle"
	| "collecting"
	| "waiting-for-repro"
	| "analyzing"
	| "fixing"
	| "verifying"
	| "cleanup"
	| "done";

interface DebugModeState {
	phase: DebugPhase;
	updatedAt: number;
	bugSummary?: string;
	sessionId?: string;
	logFile?: string;
	logCount?: number;
	collectorPort?: number;
	note?: string;
}

interface CollectorReady {
	sessionId: string;
	host: string;
	port: number;
	endpoint: string;
	healthUrl: string;
	clearUrl: string;
	shutdownUrl: string;
	logFile: string;
	readyFile: string;
	workspaceRoot: string;
	pid: number;
	startedAt: string;
}

const StateParams = Type.Object({
	phase: StringEnum(["idle", "collecting", "waiting-for-repro", "analyzing", "fixing", "verifying", "cleanup", "done"] as const),
	bugSummary: Type.Optional(Type.String({ description: "Short bug summary" })),
	sessionId: Type.Optional(Type.String({ description: "Debug collector session id" })),
	logFile: Type.Optional(Type.String({ description: "Absolute log file path" })),
	logCount: Type.Optional(Type.Number({ description: "Current log entry count" })),
	collectorPort: Type.Optional(Type.Number({ description: "Collector port" })),
	note: Type.Optional(Type.String({ description: "Optional status note" })),
});

const SessionParams = Type.Object({
	action: StringEnum(["start", "status", "clear", "stop"] as const),
	bugSummary: Type.Optional(Type.String({ description: "Bug summary used to derive a session id when starting" })),
	sessionId: Type.Optional(Type.String({ description: "Collector session id" })),
	forceRestart: Type.Optional(Type.Boolean({ description: "Restart the collector even if an existing healthy session is found" })),
});

function formatRelativeTime(timestamp: number): string {
	const diffMs = Math.max(0, Date.now() - timestamp);
	const seconds = Math.floor(diffMs / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ago`;
}

function isDebugPhaseActive(phase: DebugPhase | undefined): boolean {
	return phase ? DEBUG_ACTIVE_PHASES.includes(phase) : false;
}

function stripDebugTools(names: string[]): string[] {
	return names.filter((name) => !DEBUG_TOOL_NAMES.includes(name as (typeof DEBUG_TOOL_NAMES)[number]));
}

function mergeDebugTools(names: string[]): string[] {
	return Array.from(new Set([...stripDebugTools(names), ...DEBUG_TOOL_NAMES]));
}

function slugify(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "debug";
}

function getDebugDir(cwd: string): string {
	return resolve(cwd, ".pi-debug");
}

function getReadyFilePath(cwd: string, sessionId: string): string {
	return join(getDebugDir(cwd), `${sessionId}.ready.json`);
}

function getSessionArtifactPaths(cwd: string, sessionId: string) {
	const debugDir = getDebugDir(cwd);
	return {
		debugDir,
		logFile: join(debugDir, `${sessionId}.ndjson`),
		readyFile: join(debugDir, `${sessionId}.ready.json`),
		stdoutFile: join(debugDir, `${sessionId}.stdout.log`),
		stderrFile: join(debugDir, `${sessionId}.stderr.log`),
	};
}

function readJsonFile<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
	const startedAt = Date.now();
	while (!existsSync(path)) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(`Timed out waiting for file: ${path}`);
		}
		await delay(100);
	}
}

async function postJson(url: string): Promise<unknown> {
	const response = await fetch(url, { method: "POST" });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from ${url}`);
	}
	return (await response.json()) as unknown;
}

async function getJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from ${url}`);
	}
	return (await response.json()) as unknown;
}

async function isCollectorHealthy(ready: CollectorReady): Promise<boolean> {
	try {
		await getJson(ready.healthUrl);
		return true;
	} catch {
		return false;
	}
}

function cleanupSessionArtifacts(cwd: string, sessionId: string): string[] {
	const { debugDir, logFile, readyFile, stdoutFile, stderrFile } = getSessionArtifactPaths(cwd, sessionId);
	const removed: string[] = [];
	for (const target of [logFile, readyFile, stdoutFile, stderrFile]) {
		if (!existsSync(target)) continue;
		rmSync(target, { force: true });
		removed.push(target);
	}
	if (existsSync(debugDir)) {
		const remaining = readdirSync(debugDir);
		if (remaining.length === 0) {
			rmSync(debugDir, { recursive: true, force: true });
			removed.push(debugDir);
		}
	}
	return removed;
}

function stopCollectorsFromDebugDir(cwd: string): Promise<string[]> {
	const debugDir = getDebugDir(cwd);
	if (!existsSync(debugDir)) return Promise.resolve([]);
	const stopped: string[] = [];
	const entries = readdirSync(debugDir, { withFileTypes: true });
	const readyFiles = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ready.json"))
		.map((entry) => join(debugDir, entry.name));

	return Promise.all(
		readyFiles.map(async (readyFile) => {
			const ready = readJsonFile<CollectorReady>(readyFile);
			if (!ready) return;
			try {
				await postJson(ready.shutdownUrl);
				stopped.push(ready.sessionId);
			} catch {
				// best effort shutdown before deleting artifacts
			}
		}),
	).then(() => stopped);
}

function getModifiedFilesFromGit(cwd: string): { files: string[]; repoRoot: string | null } {
	try {
		const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		const output = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const tokens = output.split("\0").filter(Boolean);
		const files = new Set<string>();
		for (const token of tokens) {
			if (token.startsWith("?? ") || token.startsWith("!! ")) {
				files.add(resolve(repoRoot, token.slice(3)));
				continue;
			}
			if (token.length > 3 && token[2] === " ") {
				const pathText = token.slice(3);
				const arrowIndex = pathText.indexOf(" -> ");
				const finalPath = arrowIndex >= 0 ? pathText.slice(arrowIndex + 4) : pathText;
				files.add(resolve(repoRoot, finalPath));
			}
		}
		return { files: Array.from(files), repoRoot };
	} catch {
		return { files: [], repoRoot: null };
	}
}

function cleanupDebugBlocksInFiles(filePaths: string[]): { files: string[]; blocksRemoved: number; suspiciousFiles: string[] } {
	const files: string[] = [];
	const suspiciousFiles: string[] = [];
	let blocksRemoved = 0;

	for (const filePath of filePaths) {
		if (!existsSync(filePath)) continue;

		let original: string;
		try {
			original = readFileSync(filePath, "utf8");
		} catch {
			continue;
		}
		if (!original.includes(DEBUG_BLOCK_START) && !original.includes(DEBUG_BLOCK_END)) continue;
		if (original.includes("\u0000")) continue;

		const matches = [...original.matchAll(DEBUG_BLOCK_REGEX)];
		const cleaned = original.replace(DEBUG_BLOCK_REGEX, "");
		if (matches.length > 0 && cleaned !== original) {
			writeFileSync(filePath, cleaned);
			files.push(filePath);
			blocksRemoved += matches.length;
		}
		if (cleaned.includes(DEBUG_BLOCK_START) || cleaned.includes(DEBUG_BLOCK_END)) {
			suspiciousFiles.push(filePath);
		}
	}

	return { files, blocksRemoved, suspiciousFiles };
}

function walkWorkspaceFiles(root: string, out: string[] = []): string[] {
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry.name === "." || entry.name === "..") continue;
		const absolute = join(root, entry.name);
		if (entry.isDirectory()) {
			if (WALK_SKIP_DIRS.has(entry.name)) continue;
			walkWorkspaceFiles(absolute, out);
			continue;
		}
		if (!entry.isFile()) continue;
		out.push(absolute);
	}
	return out;
}

function cleanupDebugBlocksInWorkspace(cwd: string): { files: string[]; blocksRemoved: number; suspiciousFiles: string[] } {
	return cleanupDebugBlocksInFiles(walkWorkspaceFiles(cwd));
}

function phaseLabel(phase: DebugPhase): string {
	switch (phase) {
		case "idle":
			return "Idle";
		case "collecting":
			return "Collecting";
		case "waiting-for-repro":
			return "Waiting for repro";
		case "analyzing":
			return "Analyzing";
		case "fixing":
			return "Fixing";
		case "verifying":
			return "Verifying";
		case "cleanup":
			return "Cleanup";
		case "done":
			return "Done";
	}
}

function buildStatusText(ctx: ExtensionContext, state: DebugModeState | null): string | undefined {
	if (!state || state.phase === "idle") return undefined;
	const theme = ctx.ui.theme;
	const accent = state.phase === "done" ? theme.fg("success", "●") : theme.fg("accent", "●");
	const pieces: string[] = [theme.bold(` Debug ${phaseLabel(state.phase)}`)];
	if (state.bugSummary) pieces.push(theme.fg("dim", state.bugSummary));
	if (typeof state.logCount === "number") pieces.push(theme.fg("dim", `${state.logCount} logs`));
	if (state.note) pieces.push(theme.fg("dim", state.note));
	pieces.push(theme.fg("dim", formatRelativeTime(state.updatedAt)));
	return `${accent}${pieces.join(theme.fg("dim", " · "))}`;
}

function applyStatus(ctx: ExtensionContext, state: DebugModeState | null) {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, buildStatusText(ctx, state));
}

function readLatestState(ctx: ExtensionContext): DebugModeState | null {
	let latest: DebugModeState | null = null;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const data = entry.data as DebugModeState | undefined;
		if (!data) continue;
		latest = data;
	}
	return latest;
}

export default function piDebugModeExtension(pi: ExtensionAPI) {
	let currentState: DebugModeState | null = null;
	let injectForNextTurn = false;
	let restoreActiveToolsAfterTurn: string[] | null = null;

	const restore = (ctx: ExtensionContext) => {
		currentState = readLatestState(ctx);
		applyStatus(ctx, currentState);
	};

	const persist = (state: DebugModeState) => {
		currentState = state;
		pi.appendEntry<DebugModeState>(ENTRY_TYPE, state);
	};

	const resetToIdle = (ctx: ExtensionContext, note?: string) => {
		const nextState: DebugModeState = {
			phase: "idle",
			updatedAt: Date.now(),
			note,
		};
		persist(nextState);
		applyStatus(ctx, nextState);
	};

	const persistInitialState = (ctx: ExtensionContext, bugSummary: string, note?: string) => {
		const nextState: DebugModeState = {
			phase: "collecting",
			updatedAt: Date.now(),
			bugSummary,
			sessionId: undefined,
			logFile: undefined,
			logCount: undefined,
			collectorPort: undefined,
			note,
		};
		persist(nextState);
		applyStatus(ctx, nextState);
	};

	const armDebugToolsForUpcomingTurn = () => {
		injectForNextTurn = true;
	};

	const ensureDebugToolsDisabled = () => {
		pi.setActiveTools(stripDebugTools(pi.getActiveTools()));
	};

	const maybeInjectDebugToolsForTurn = () => {
		const shouldInject = injectForNextTurn || isDebugPhaseActive(currentState?.phase);
		if (!shouldInject) return;
		const previousTools = stripDebugTools(pi.getActiveTools());
		restoreActiveToolsAfterTurn = previousTools;
		pi.setActiveTools(mergeDebugTools(previousTools));
		injectForNextTurn = false;
	};

	const getPreferredSessionId = (cwd: string, requestedSessionId: string | undefined, bugSummary: string | undefined) => {
		if (requestedSessionId?.trim()) return requestedSessionId.trim();
		if (currentState?.sessionId?.trim()) return currentState.sessionId.trim();
		return `${slugify(bugSummary || currentState?.bugSummary || "debug")}-${Date.now()}`;
	};

	const readCollectorReady = (cwd: string, sessionId: string): CollectorReady | null => {
		return readJsonFile<CollectorReady>(getReadyFilePath(cwd, sessionId));
	};

	const startCollector = async (cwd: string, sessionId: string, forceRestart = false): Promise<{ ready: CollectorReady; reused: boolean }> => {
		const debugDir = getDebugDir(cwd);
		mkdirSync(debugDir, { recursive: true });

		const existing = readCollectorReady(cwd, sessionId);
		if (existing && !forceRestart && (await isCollectorHealthy(existing))) {
			return { ready: existing, reused: true };
		}
		if (existing && forceRestart) {
			try {
				await postJson(existing.shutdownUrl);
			} catch {
				// ignore shutdown failures; we are replacing the session
			}
		}

		const { stdoutFile, stderrFile } = getSessionArtifactPaths(cwd, sessionId);
		const stdoutFd = openSync(stdoutFile, "a");
		const stderrFd = openSync(stderrFile, "a");
		const child = spawn(process.execPath, [COLLECTOR_SCRIPT, "--workspace-root", cwd, "--session-id", sessionId], {
			cwd,
			detached: true,
			stdio: ["ignore", stdoutFd, stderrFd],
		});
		child.unref();

		const readyFile = getReadyFilePath(cwd, sessionId);
		await waitForFile(readyFile, 5000);
		const ready = readJsonFile<CollectorReady>(readyFile);
		if (!ready) {
			throw new Error(`Collector ready file unreadable: ${readyFile}`);
		}
		return { ready, reused: false };
	};

	pi.on("session_start", async (_event, ctx) => {
		restore(ctx);
		ensureDebugToolsDisabled();
	});

	pi.on("session_tree", async (_event, ctx) => {
		restore(ctx);
		ensureDebugToolsDisabled();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		restoreActiveToolsAfterTurn = null;
		injectForNextTurn = false;
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		if (event.text.startsWith(DEBUG_SKILL_COMMAND_PREFIX)) {
			armDebugToolsForUpcomingTurn();
			const summary = event.text.slice(DEBUG_SKILL_COMMAND_PREFIX.length).trim();
			if (summary) {
				persistInitialState(ctx, summary, event.streamingBehavior === "followUp" ? "queued follow-up" : undefined);
			}
		}
		return { action: "continue" };
	});

	pi.on("before_agent_start", async () => {
		maybeInjectDebugToolsForTurn();
		return undefined;
	});

	pi.on("agent_end", async () => {
		if (restoreActiveToolsAfterTurn) {
			pi.setActiveTools(restoreActiveToolsAfterTurn);
			restoreActiveToolsAfterTurn = null;
		}
		if (!isDebugPhaseActive(currentState?.phase)) {
			ensureDebugToolsDisabled();
		}
	});

	pi.registerCommand("debug", {
		description: "Start Cursor-style debug mode via /skill:debug-mode",
		handler: async (args, ctx) => {
			const summary = args.trim();
			if (!summary) {
				if (ctx.hasUI) {
					ctx.ui.setEditorText("/skill:debug-mode ");
					ctx.ui.notify("Prefilled /skill:debug-mode in the editor.", "info");
				} else {
					ctx.ui.notify("Usage: /debug <bug summary>", "warning");
				}
				return;
			}

			armDebugToolsForUpcomingTurn();
			const message = `${DEBUG_SKILL_COMMAND_PREFIX} ${summary}`;
			if (ctx.isIdle()) {
				persistInitialState(ctx, summary);
				pi.sendUserMessage(message);
			} else {
				persistInitialState(ctx, summary, "queued follow-up");
				pi.sendUserMessage(message, { deliverAs: "followUp" });
				ctx.ui.notify("Queued debug mode as a follow-up.", "info");
			}
		},
	});

	pi.registerCommand("debug:cleanup", {
		description: "Remove debug collector artifacts and PI_DEBUG_START/END instrumentation blocks from the current workspace",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait until the agent is idle before running /debug:cleanup.", "warning");
				return;
			}

			const cwd = ctx.cwd;
			const stoppedSessions = await stopCollectorsFromDebugDir(cwd);
			const debugDir = getDebugDir(cwd);
			const hadDebugDir = existsSync(debugDir);
			if (hadDebugDir) {
				rmSync(debugDir, { recursive: true, force: true });
			}
			const { files: modifiedFiles, repoRoot } = getModifiedFilesFromGit(cwd);
			const cleanup = repoRoot ? cleanupDebugBlocksInFiles(modifiedFiles) : cleanupDebugBlocksInWorkspace(cwd);
			ensureDebugToolsDisabled();
			injectForNextTurn = false;
			restoreActiveToolsAfterTurn = null;
			resetToIdle(ctx, "manual cleanup");

			const parts = [
				stoppedSessions.length > 0 ? `stopped ${stoppedSessions.length} collector session(s)` : null,
				hadDebugDir ? "removed .pi-debug" : null,
				repoRoot
					? cleanup.blocksRemoved > 0
						? `removed ${cleanup.blocksRemoved} debug block(s) in ${cleanup.files.length} modified file(s)`
						: "no debug blocks found in modified files"
					: cleanup.blocksRemoved > 0
						? `not in a git repo; removed ${cleanup.blocksRemoved} debug block(s) in ${cleanup.files.length} workspace file(s)`
						: "not in a git repo; no debug blocks found in workspace scan",
				cleanup.suspiciousFiles.length > 0 ? `${cleanup.suspiciousFiles.length} file(s) still contain debug markers` : null,
			]
				.filter(Boolean)
				.join("; ");
			ctx.ui.notify(parts || "Nothing to clean.", cleanup.suspiciousFiles.length > 0 ? "warning" : "info");
		},
	});

	pi.registerCommand("debug-status", {
		description: "Show the latest Pi Debug Mode state",
		handler: async (_args, ctx) => {
			const state = currentState ?? readLatestState(ctx);
			if (!state || state.phase === "idle") {
				ctx.ui.notify("No active debug-mode state in this branch.", "info");
				return;
			}

			const summary = [
				`phase=${state.phase}`,
				state.sessionId ? `session=${state.sessionId}` : null,
				state.logFile ? `logFile=${state.logFile}` : null,
				typeof state.logCount === "number" ? `logCount=${state.logCount}` : null,
				state.note ? `note=${state.note}` : null,
			]
				.filter(Boolean)
				.join("\n");
			ctx.ui.notify(summary || "No debug state details.", "info");
		},
	});

	pi.registerTool({
		name: "debug_mode_state",
		label: "Debug Mode State",
		description:
			"Update Pi Debug Mode session state for footer status and session persistence. Use only while following the debug-mode skill.",
		promptSnippet: "Publish debug-mode phase updates for the current investigation.",
		promptGuidelines: [
			"Use debug_mode_state at debug-mode phase boundaries so the footer reflects collecting, waiting-for-repro, analyzing, fixing, verifying, cleanup, and done.",
		],
		parameters: StateParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const nextState: DebugModeState = {
				phase: params.phase,
				updatedAt: Date.now(),
				bugSummary: params.bugSummary,
				sessionId: params.sessionId,
				logFile: params.logFile,
				logCount: params.logCount,
				collectorPort: params.collectorPort,
				note: params.note,
			};
			persist(nextState);
			applyStatus(ctx, nextState);
			return {
				content: [{ type: "text", text: `Debug mode state updated: ${nextState.phase}` }],
				details: nextState,
			};
		},
	});

	pi.registerTool({
		name: "debug_mode_session",
		label: "Debug Mode Session",
		description:
			"Start, inspect, clear, or stop the local debug collector used by the debug-mode skill. Use only while following the debug-mode skill.",
		promptSnippet: "Manage the local debug collector session for runtime evidence capture.",
		promptGuidelines: [
			"Use debug_mode_session with action=start before adding browser/client instrumentation so you have an endpoint, ready file, and log path.",
			"Use debug_mode_session with action=clear before each reproduction run so stale evidence does not pollute the next pass.",
			"Use debug_mode_session with action=status to verify the collector is still healthy before another recording pass.",
			"Use debug_mode_session with action=stop during final cleanup after the fix is verified; stop also removes this session's collector log artifacts.",
		],
		parameters: SessionParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const sessionId = getPreferredSessionId(cwd, params.sessionId, params.bugSummary);

			switch (params.action) {
				case "start": {
					const { ready, reused } = await startCollector(cwd, sessionId, params.forceRestart ?? false);
					return {
						content: [
							{
								type: "text",
								text: `${reused ? "Reused" : "Started"} collector session ${ready.sessionId} on port ${ready.port}.`,
							},
						],
						details: ready,
					};
				}
				case "status": {
					const ready = readCollectorReady(cwd, sessionId);
					if (!ready) {
						return {
							content: [{ type: "text", text: `No collector ready file found for session ${sessionId}.` }],
							details: { sessionId, found: false },
						};
					}
					const health = (await getJson(ready.healthUrl)) as Record<string, unknown>;
					return {
						content: [{ type: "text", text: `Collector ${sessionId} is healthy on port ${ready.port}.` }],
						details: { ready, health },
					};
				}
				case "clear": {
					const ready = readCollectorReady(cwd, sessionId);
					if (!ready) {
						return {
							content: [{ type: "text", text: `No collector ready file found for session ${sessionId}.` }],
							details: { sessionId, cleared: false, found: false },
						};
					}
					const result = await postJson(ready.clearUrl);
					return {
						content: [{ type: "text", text: `Cleared collector logs for session ${sessionId}.` }],
						details: { ready, result },
					};
				}
				case "stop": {
					const ready = readCollectorReady(cwd, sessionId);
					if (!ready) {
						const removed = cleanupSessionArtifacts(cwd, sessionId);
						return {
							content: [{ type: "text", text: `No collector ready file found for session ${sessionId}; cleaned ${removed.length} local artifact(s).` }],
							details: { sessionId, stopped: false, found: false, removedArtifacts: removed },
						};
					}
					const result = await postJson(ready.shutdownUrl);
					const removed = cleanupSessionArtifacts(cwd, sessionId);
					return {
						content: [{ type: "text", text: `Stopped collector session ${sessionId} and removed ${removed.length} artifact(s).` }],
						details: { ready, result, removedArtifacts: removed },
					};
				}
			}
		},
	});
}
