import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	buildRoundPrompt,
	containsStopKeyword,
	discoverSidecars,
	findSidecar,
	loadGlobalConfig,
	resolveExtensionPaths,
	resolveSkillPaths,
	setGlobalMode,
	slugAgentName,
} from "./config.js";
import {
	agentPrompt,
	agentRead,
	agentStart,
	assertHerdrEnv,
	currentWorkspaceId,
	HerdrError,
	reclaimAgentName,
	tabClose,
	tabCreate,
	waitForAvailableShell,
} from "./herdr.js";
import {
	createInnerRuntime,
	disposeInnerRuntime,
	runInnerRound,
} from "./inner.js";
import {
	newSidecarSessionFile,
	readLastAssistantFromSession,
	readMessagesFromSession,
} from "./session.js";
import {
	showSidecarStatusOverlay,
	type SidecarLiveView,
	type StatusOverlaySource,
} from "./status-ui.js";
import type { SidecarDefinition, SidecarInstance, SidecarMode } from "./types.js";

const STATUS_MAX_LINES = 40;

const TOOL_NAMES = ["sidecar_prompt", "sidecar_stop"] as const;
const MSG_RESULT = "sidecar-result";
const MSG_INFO = "sidecar-info";

function formatDefLine(d: SidecarDefinition): string {
	const bits = [d.blocking ? "blocking" : "async"];
	if (d.mode) bits.push(d.mode);
	if (d.source === "project") bits.push("project");
	const meta = bits.join(", ");
	const desc = d.description?.trim();
	return desc ? `- **${d.name}** (${meta}) — ${desc}` : `- **${d.name}** (${meta})`;
}

export default function sidecarExtension(pi: ExtensionAPI): void {
	const instances = new Map<string, SidecarInstance>();
	const liveListeners = new Set<() => void>();
	let toolsArmed = false;
	let sessionCwd = process.cwd();

	function notifyLive(): void {
		for (const cb of liveListeners) {
			try {
				cb();
			} catch {
				// ignore listener errors
			}
		}
	}

	function appendStatus(inst: SidecarInstance, line: string, quiet = false): void {
		inst.statusLines.push(line);
		if (inst.statusLines.length > STATUS_MAX_LINES) {
			inst.statusLines.splice(0, inst.statusLines.length - STATUS_MAX_LINES);
		}
		if (!quiet) notifyLive();
	}

	function setMessages(inst: SidecarInstance, messages: any[]): void {
		inst.messages = messages;
		notifyLive();
	}

	function refreshMessagesFromSession(inst: SidecarInstance): void {
		if (inst.mode === "inner" && inst.inner) {
			setMessages(inst, [...(inst.inner.session.messages as any[])]);
			return;
		}
		if (inst.sessionFile) {
			setMessages(inst, readMessagesFromSession(inst.sessionFile));
		}
	}

	function toLiveView(inst: SidecarInstance): SidecarLiveView {
		return {
			name: inst.name,
			status: inst.status,
			mode: inst.mode,
			blocking: inst.def.blocking,
			statusLines: inst.statusLines,
			messages: inst.messages,
			updatedAt: Date.now(),
		};
	}

	function statusSource(): StatusOverlaySource {
		return {
			// Only live instances — completed sidecars are removed from the map on cleanup.
			list: () => [...instances.values()].map(toLiveView).sort((a, b) => b.updatedAt - a.updatedAt),
			subscribe: (cb) => {
				liveListeners.add(cb);
				return () => liveListeners.delete(cb);
			},
			canStop: (name) => instances.has(name),
			stop: async (name) => {
				await stopSidecar(name);
			},
		};
	}

	const SUBCOMMANDS = [
		{ name: "start", description: "Start a sidecar: start <name> [extra…]" },
		{ name: "stop", description: "Stop a running sidecar: stop [name]" },
		{ name: "list", description: "List discovered .sidecar definitions" },
		{ name: "status", description: "Open live dual-pane status overlay" },
		{ name: "mode", description: "Get/set mode: mode [herdr|inner]" },
	] as const;

	function completeSidecarArgs(prefix: string) {
		// value replaces the entire argument string (see builtin-tools / pi autocomplete)
		const hasTrailingSpace = /\s$/.test(prefix);
		const parts = prefix.trim().split(/\s+/).filter(Boolean);
		const head = parts[0]?.toLowerCase() ?? "";

		if (parts.length === 0) {
			return SUBCOMMANDS.map((s) => ({
				value: s.name,
				label: s.name,
				description: s.description,
			}));
		}

		if (parts.length === 1 && !hasTrailingSpace) {
			const matches = SUBCOMMANDS.filter((s) => s.name.startsWith(head)).map((s) => ({
				value: s.name,
				label: s.name,
				description: s.description,
			}));
			return matches.length ? matches : null;
		}

		if (head === "start") {
			// start | start name… — complete definition name as 2nd token only
			if (parts.length >= 3 || (parts.length === 2 && hasTrailingSpace)) return null;
			const namePrefix = parts.length === 1 ? "" : parts[1] ?? "";
			const items = discoverSidecars(sessionCwd)
				.filter((d) => !namePrefix || d.name.startsWith(namePrefix))
				.map((d) => ({
					value: `start ${d.name}`,
					label: d.name,
					description:
						d.description ||
						`${d.blocking ? "blocking" : "async"}${d.source === "project" ? " · project" : ""}`,
				}));
			return items.length ? items : null;
		}

		if (head === "stop") {
			if (parts.length >= 3 || (parts.length === 2 && hasTrailingSpace)) return null;
			const namePrefix = parts.length === 1 ? "" : parts[1] ?? "";
			const items = [...instances.keys()]
				.filter((name) => !namePrefix || name.startsWith(namePrefix))
				.map((name) => ({
					value: `stop ${name}`,
					label: name,
					description: instances.get(name)?.status,
				}));
			return items.length ? items : null;
		}

		if (head === "mode") {
			if (parts.length >= 3 || (parts.length === 2 && hasTrailingSpace)) return null;
			const modePrefix = (parts.length === 1 ? "" : parts[1] ?? "").toLowerCase();
			const items = (["herdr", "inner"] as const)
				.filter((m) => !modePrefix || m.startsWith(modePrefix))
				.map((m) => ({ value: `mode ${m}`, label: m }));
			return items.length ? items : null;
		}

		return null;
	}

	function activeNonToolNames(): string[] {
		return pi.getActiveTools().filter((n) => !(TOOL_NAMES as readonly string[]).includes(n));
	}

	function armTools(): void {
		if (toolsArmed) return;
		const base = activeNonToolNames();
		pi.setActiveTools([...base, ...TOOL_NAMES]);
		toolsArmed = true;
	}

	function disarmTools(): void {
		if (!toolsArmed && !instances.size) {
			pi.setActiveTools(activeNonToolNames());
			return;
		}
		const stillLive = [...instances.values()].some(
			(i) => i.status === "running" || i.status === "waiting" || i.status === "starting",
		);
		if (stillLive) return;
		pi.setActiveTools(activeNonToolNames());
		toolsArmed = false;
	}

	function send(
		customType: string,
		content: string,
		details?: unknown,
		opts?: { kick?: boolean },
	): void {
		pi.sendMessage(
			{
				customType,
				content,
				display: true,
				details,
			},
			opts?.kick
				? { deliverAs: "followUp", triggerTurn: true }
				: undefined,
		);
	}

	function buildPiArgs(
		def: SidecarDefinition,
		ctx: ExtensionContext | ExtensionCommandContext,
		sessionFile: string,
	): string[] {
		const args: string[] = ["--no-extensions", "--no-skills", "--session", sessionFile];
		const extPaths = resolveExtensionPaths(def.agent?.extensions);
		for (const p of extPaths) {
			args.push("-e", p);
		}
		const skillPaths = resolveSkillPaths(def.agent?.skills);
		for (const p of skillPaths) {
			args.push("--skill", p);
		}
		const model =
			def.agent?.model?.trim() ||
			(ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
		if (model) args.push("--model", model);
		const effort = def.agent?.effort ?? ctx.thinkingLevel;
		if (effort && effort !== "off") args.push("--thinking", effort);
		return args;
	}

	async function readSidecarOutput(inst: SidecarInstance): Promise<string> {
		// Prefer child session jsonl (clean assistant text). Fall back to herdr TUI scrape.
		const fromSession = readLastAssistantFromSession(inst.sessionFile);
		if (fromSession.trim()) return fromSession.trim();
		const cfg = loadGlobalConfig();
		return (await agentRead({ target: inst.agentName, lines: cfg.read_lines })).trim();
	}

	/**
	 * Blocking wait UI by mode:
	 * - herdr: BorderedLoader (captures input; user watches the tab)
	 * - inner: status overlay (live transcript; no separate tab)
	 */
	async function withBlockingWait<T>(
		ctx: ExtensionContext | ExtensionCommandContext | undefined,
		inst: SidecarInstance,
		message: string,
		work: () => Promise<T>,
	): Promise<T> {
		if (inst.mode === "inner") return withStatusWait(ctx, inst, work);
		return withWaitingSpinner(ctx, message, inst, work);
	}

	/** Blocking wait: show status overlay (live log). Esc cancels. Inner only by default. */
	async function withStatusWait<T>(
		ctx: ExtensionContext | ExtensionCommandContext | undefined,
		inst: SidecarInstance,
		work: () => Promise<T>,
	): Promise<T> {
		if (!ctx?.hasUI) return work();

		let settled: { ok: true; value: T } | { ok: false; error: unknown } | undefined;
		const workP = work().then(
			(value) => {
				settled = { ok: true, value };
			},
			(error) => {
				settled = { ok: false, error };
			},
		);

		await showSidecarStatusOverlay(ctx, statusSource(), {
			selectName: inst.name,
			until: workP,
			waitMode: true,
			// Esc closes the panel only; use Shift+S / /sidecar stop to kill work.
		});
		await workP;
		if (!settled) throw new HerdrError("sidecar wait settled without result");
		if (!settled.ok) throw settled.error;
		return settled.value;
	}

	/** Short spinner for quick boot (async start). Esc cancels via inst.abort. */
	async function withWaitingSpinner<T>(
		ctx: ExtensionContext | ExtensionCommandContext | undefined,
		message: string,
		inst: SidecarInstance,
		work: () => Promise<T>,
	): Promise<T> {
		if (!ctx?.hasUI) return work();

		const boxed = await ctx.ui.custom<{ ok: true; value: T } | { ok: false; error: unknown }>(
			(tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, message, { cancellable: true });
				loader.onAbort = () => {
					inst.abort.abort();
					done({ ok: false, error: new HerdrError("sidecar cancelled") });
				};
				void work()
					.then((value) => {
						loader.dispose();
						done({ ok: true, value });
					})
					.catch((error) => {
						loader.dispose();
						done({ ok: false, error });
					});
				return loader;
			},
		);

		if (!boxed.ok) throw boxed.error;
		return boxed.value;
	}

	async function cleanupInstance(inst: SidecarInstance, reason: string): Promise<void> {
		if (inst.status !== "error") inst.status = "stopped";
		appendStatus(inst, `[cleanup:${reason}]`);
		inst.abort.abort();
		if (inst.mode === "inner") {
			disposeInnerRuntime(inst);
		} else if (inst.closeOnStop && inst.tabId) {
			try {
				await tabClose(inst.tabId);
			} catch (err) {
				inst.lastError = err instanceof Error ? err.message : String(err);
			}
		}
		instances.delete(inst.name);
		disarmTools();
		notifyLive();
	}

	async function rollbackTab(tabId: string | undefined): Promise<void> {
		if (!tabId) return;
		try {
			await tabClose(tabId);
		} catch {
			// best-effort
		}
	}

	async function runRound(
		inst: SidecarInstance,
		promptText: string,
	): Promise<{ output: string; stopped: boolean }> {
		const cfg = loadGlobalConfig();
		inst.status = "waiting";
		appendStatus(inst, `[prompt] ${promptText.slice(0, 200)}${promptText.length > 200 ? "…" : ""}`);
		notifyLive();

		let output = "";
		if (inst.mode === "inner") {
			output = await runInnerRound(inst, promptText, cfg.prompt_timeout_ms);
		} else {
			const before = readLastAssistantFromSession(inst.sessionFile);
			// Poll TUI while --wait blocks, so /sidecar status can stream.
			let promptDone = false;
			const waitP = agentPrompt({
				target: inst.agentName,
				text: promptText,
				wait: true,
				timeoutMs: cfg.prompt_timeout_ms,
			}).finally(() => {
				promptDone = true;
			});

			while (!promptDone) {
				if (inst.abort.signal.aborted) {
					throw new HerdrError("sidecar aborted");
				}
				try {
					// Prefer session jsonl so status can use stock message renderers.
					refreshMessagesFromSession(inst);
				} catch {
					// session may not exist yet
				}
				await Promise.race([
					waitP.then(() => undefined).catch(() => undefined),
					new Promise<void>((r) => setTimeout(r, 500)),
				]);
			}
			await waitP;

			if (inst.abort.signal.aborted) {
				throw new HerdrError("sidecar aborted");
			}
			// herdr idle can race slightly ahead of session flush — brief retry
			for (let i = 0; i < 8; i++) {
				output = await readSidecarOutput(inst);
				if (output && output !== before) break;
				await new Promise((r) => setTimeout(r, 150));
			}
			if (!output) output = await readSidecarOutput(inst);
		}

		inst.lastOutput = output;
		const stopped = containsStopKeyword(output, inst.def.stop_keyword);
		inst.stoppedByKeyword = stopped;
		inst.status = stopped ? "stopped" : "running";
		refreshMessagesFromSession(inst);
		appendStatus(inst, `[round ${stopped ? "STOPPED" : "done"}]`);
		return { output, stopped };
	}

	async function bootRuntime(
		inst: SidecarInstance,
		ctx: ExtensionContext | ExtensionCommandContext,
	): Promise<void> {
		const def = inst.def;
		if (inst.mode === "inner") {
			const runtime = await createInnerRuntime(
				def,
				ctx,
				(messages) => setMessages(inst, messages),
				(line) => appendStatus(inst, line),
			);
			inst.inner = { session: runtime.session, unsubscribe: runtime.unsubscribe };
			if (runtime.sessionFile) inst.sessionFile = runtime.sessionFile;
			inst.status = "running";
			appendStatus(inst, `[running inner]`);
			armTools();
			return;
		}

		assertHerdrEnv();
		const agentName = inst.agentName;
		const label = def.tab?.label?.trim() || `sidecar:${def.name}`;
		await reclaimAgentName(agentName);
		const created = await tabCreate({
			workspace: currentWorkspaceId(),
			cwd: ctx.cwd,
			label,
			focus: def.tab?.focus === true,
		});
		inst.tabId = created.tabId;
		inst.paneId = created.paneId;
		await waitForAvailableShell(created.paneId);
		await agentStart({
			name: agentName,
			kind: def.agent?.kind || "pi",
			paneId: created.paneId,
			agentArgs: buildPiArgs(def, ctx, inst.sessionFile),
		});
		inst.status = "running";
		appendStatus(inst, `[running tab=${inst.tabId}]`);
		armTools();
	}

	async function startSidecar(
		def: SidecarDefinition,
		ctx: ExtensionContext | ExtensionCommandContext,
		extra?: string,
	): Promise<SidecarInstance> {
		const global = loadGlobalConfig();
		const mode: SidecarMode = def.mode ?? global.mode;
		if (mode === "herdr") assertHerdrEnv();

		if (instances.has(def.name)) {
			throw new HerdrError(`sidecar '${def.name}' is already running`);
		}

		const agentName = slugAgentName(def.agent?.name, def.name);
		const closeOnStop = def.close_on_stop !== false;
		const abort = new AbortController();
		const sessionFile = newSidecarSessionFile(def.name);

		const inst: SidecarInstance = {
			name: def.name,
			def,
			mode,
			agentName,
			tabId: "",
			paneId: "",
			sessionFile,
			status: "starting",
			closeOnStop,
			abort,
			createdAt: Date.now(),
			statusLines: [
				`[starting ${def.name}]`,
				`[mode ${mode}]`,
				`[agent ${agentName}]`,
				`[session ${sessionFile}]`,
			],
			messages: [],
		};
		instances.set(def.name, inst);
		notifyLive();

		try {
			send(MSG_INFO, `starting sidecar **${def.name}** (${mode}${def.blocking ? ", blocking" : ", async"})…`, {
				name: def.name,
				agentName,
				sessionFile,
				blocking: def.blocking,
				mode,
			});

			const firstPrompt = buildRoundPrompt(def.prompt, def, extra);

			if (def.blocking) {
				const { output, stopped } = await withBlockingWait(
					ctx,
					inst,
					`sidecar:${def.name} · starting & waiting…`,
					async () => {
						await bootRuntime(inst, ctx);
						return runRound(inst, firstPrompt);
					},
				);
				emitRoundResult(inst, output, stopped, /*kick*/ true);
				if (stopped) await cleanupInstance(inst, "keyword");
			} else {
				await withWaitingSpinner(ctx, `sidecar:${def.name} · starting…`, inst, async () => {
					await bootRuntime(inst, ctx);
				});

				send(MSG_INFO, `sidecar **${def.name}** running (async, ${mode})`, {
					name: def.name,
					agentName,
					tabId: inst.tabId,
					mode,
				});
				void (async () => {
					try {
						const { output, stopped } = await runRound(inst, firstPrompt);
						emitRoundResult(inst, output, stopped, /*kick*/ true);
						if (stopped) await cleanupInstance(inst, "keyword");
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						inst.status = "error";
						inst.lastError = message;
						send(MSG_RESULT, `sidecar ${def.name} error: ${message}`, {
							name: def.name,
							error: message,
						});
						await cleanupInstance(inst, "error");
					}
				})();
			}
			return inst;
		} catch (err) {
			if (inst.mode === "herdr") await rollbackTab(inst.tabId || undefined);
			else disposeInnerRuntime(inst);
			const message = err instanceof Error ? err.message : String(err);
			inst.status = "error";
			inst.lastError = message;
			appendStatus(inst, `[error] ${message}`);
			instances.delete(def.name);
			disarmTools();
			notifyLive();
			throw err;
		}
	}

	async function promptSidecar(
		name: string,
		prompt?: string,
		ctx?: ExtensionContext | ExtensionCommandContext,
	): Promise<string> {
		const inst = instances.get(name);
		if (!inst) throw new HerdrError(`sidecar '${name}' is not running`);
		if (inst.status === "waiting") throw new HerdrError(`sidecar '${name}' is already waiting`);
		const base = prompt?.trim() || inst.def.continue_prompt || "Continue.";
		const text = buildRoundPrompt(base, inst.def);
		const { output, stopped } = await withBlockingWait(
			ctx,
			inst,
			`sidecar:${name} · waiting…`,
			() => runRound(inst, text),
		);
		// tool path: agent already mid-turn — display only, no kick
		emitRoundResult(inst, output, stopped, /*kick*/ false);
		if (stopped) await cleanupInstance(inst, "keyword");
		return output;
	}

	function emitRoundResult(
		inst: SidecarInstance,
		output: string,
		stopped: boolean,
		kick: boolean,
	): void {
		send(
			MSG_RESULT,
			formatResult(inst.name, output, stopped),
			{
				name: inst.name,
				stopped,
				agentName: inst.agentName,
				tabId: inst.tabId,
				sessionFile: inst.sessionFile,
			},
			// only kick main agent when round needs follow-up work
			{ kick: kick && !stopped },
		);
	}

	async function stopSidecar(name?: string): Promise<string> {
		const target =
			name?.trim() ||
			[...instances.values()].find((i) => i.status !== "stopped")?.name;
		if (!target) return "no running sidecar";
		const inst = instances.get(target);
		if (inst) {
			await cleanupInstance(inst, "stop");
			send(MSG_INFO, `stopped sidecar ${target}`, { name: target });
			return `stopped ${target}`;
		}
		// after /reload memory is empty — still reclaim herdr tab by configured agent name
		const def = findSidecar(sessionCwd, target);
		const agentName = slugAgentName(def?.agent?.name, target);
		const reclaimed = await reclaimAgentName(agentName);
		if (reclaimed) {
			send(MSG_INFO, `stopped orphan sidecar ${target} (agent ${agentName})`, {
				name: target,
				agentName,
			});
			return `stopped orphan ${target}`;
		}
		return `sidecar '${target}' is not running`;
	}

	function formatResult(name: string, output: string, stopped: boolean): string {
		if (stopped) {
			return [`[sidecar:${name}] STOPPED`, "", output].join("\n");
		}
		return [
			`[sidecar:${name}] ROUND_DONE`,
			"",
			output,
			"",
			"---",
			`Fix the findings above if needed, then call tool sidecar_prompt with name="${name}" to re-review.`,
			`If there is nothing left to fix, call sidecar_stop with name="${name}".`,
		].join("\n");
	}

	function statusText(cwd: string): string {
		const global = loadGlobalConfig();
		const lines: string[] = [
			`**mode:** ${global.mode}`,
			`**prompt_timeout_ms:** ${global.prompt_timeout_ms}`,
			`**read_lines:** ${global.read_lines}`,
			`**instances:** ${instances.size}`,
		];
		if (!instances.size) {
			lines.push("- _(no running sidecars)_");
		} else {
			for (const inst of instances.values()) {
				lines.push(
					`- **${inst.name}** — status=${inst.status}, agent=${inst.agentName}, tab=${inst.tabId}, ${inst.def.blocking ? "blocking" : "async"}`,
				);
			}
		}
		const defs = discoverSidecars(cwd);
		lines.push("", `**definitions:** ${defs.length}`);
		for (const d of defs) lines.push(formatDefLine(d));
		return lines.join("\n");
	}

	// --- tools (registered always; active only while a sidecar runs) ---
	pi.registerTool({
		name: "sidecar_prompt",
		label: "Sidecar Prompt",
		description:
			"Send a follow-up prompt to a running sidecar agent and wait for its response (respects .sidecar blocking). Prefer this after /sidecar start for multi-round loops. Omit prompt to use continue_prompt.",
		promptSnippet: "Continue a running sidecar round",
		promptGuidelines: [
			"Only use sidecar_prompt when a sidecar is running (after /sidecar start).",
			"If the result is marked STOPPED, the sidecar finished (stop keyword); do not prompt again.",
		],
		parameters: Type.Object({
			name: Type.String({ description: "Sidecar definition name" }),
			prompt: Type.Optional(Type.String({ description: "Follow-up prompt text" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				const output = await promptSidecar(params.name, params.prompt, ctx);
				// cleanup removes stopped instances
				const stopped = !instances.has(params.name);
				return {
					content: [{ type: "text" as const, text: formatResult(params.name, output, stopped) }],
					details: { name: params.name, stopped },
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `sidecar_prompt failed: ${message}` }],
					details: { error: message },
				};
			}
		},
	});

	pi.registerTool({
		name: "sidecar_stop",
		label: "Sidecar Stop",
		description: "Force-stop a running sidecar and optionally close its herdr tab (per close_on_stop).",
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Sidecar name; default = the running one" })),
		}),
		async execute(_id, params) {
			const text = await stopSidecar(params.name);
			return {
				content: [{ type: "text" as const, text }],
				details: {},
			};
		},
	});

	function ensureToolsDisarmed(): void {
		pi.setActiveTools(activeNonToolNames());
		toolsArmed = false;
	}

	// tools registered above may be active by default — keep them out until start
	try {
		ensureToolsDisarmed();
	} catch {
		// session not ready yet
	}

	pi.on("session_start", (_event, ctx) => {
		sessionCwd = ctx.cwd || sessionCwd;
		ensureToolsDisarmed();
	});

	pi.on("session_shutdown", async () => {
		const running = [...instances.values()];
		for (const inst of running) {
			await cleanupInstance(inst, "session_shutdown");
		}
	});

	// --- commands ---
	pi.registerCommand("sidecar", {
		description: "Sidecar subagent: start|stop|list|status|mode",
		getArgumentCompletions: (prefix) => completeSidecarArgs(prefix),
		handler: async (args, ctx) => {
			sessionCwd = ctx.cwd || sessionCwd;
			const trimmed = args.trim();
			if (!trimmed) {
				send(
					MSG_INFO,
					[
						"Usage:",
						"",
						"- `/sidecar start <name> [extra…]`",
						"- `/sidecar stop [name]`",
						"- `/sidecar list`",
						"- `/sidecar status`",
						"- `/sidecar mode [herdr|inner]`",
					].join("\n"),
				);
				return;
			}

			const m = trimmed.match(/^(\S+)\s*([\s\S]*)$/);
			const sub = (m?.[1] ?? "").toLowerCase();
			const rest = (m?.[2] ?? "").trim();

			if (sub === "list") {
				const defs = discoverSidecars(ctx.cwd);
				if (!defs.length) {
					send(
						MSG_INFO,
						[
							"No `.sidecar` found.",
							"",
							"- `~/.pi/agent/sidecars/*.sidecar`",
							"- `<cwd>/.pi/sidecars/*.sidecar`",
						].join("\n"),
					);
					return;
				}
				send(MSG_INFO, defs.map(formatDefLine).join("\n"));
				return;
			}

			if (sub === "status") {
				if (ctx.hasUI) {
					await showSidecarStatusOverlay(ctx, statusSource());
					return;
				}
				send(MSG_INFO, statusText(ctx.cwd));
				return;
			}

			if (sub === "mode") {
				const token = rest.toLowerCase();
				if (!token) {
					const cfg = loadGlobalConfig();
					send(MSG_INFO, `mode: ${cfg.mode} (config: ~/.pi/agent/sidecars/config.json)`);
					return;
				}
				if (token !== "herdr" && token !== "inner") {
					send(MSG_INFO, "usage: /sidecar mode [herdr|inner]");
					return;
				}
				const cfg = setGlobalMode(token);
				send(MSG_INFO, `mode set to ${cfg.mode}`);
				return;
			}

			if (sub === "start") {
				if (!rest) {
					send(MSG_INFO, "usage: /sidecar start <name> [extra prompt…]");
					return;
				}
				const sm = rest.match(/^(\S+)\s*([\s\S]*)$/);
				const name = sm?.[1] ?? "";
				const extra = sm?.[2]?.trim() || undefined;
				const def = findSidecar(ctx.cwd, name);
				if (!def) {
					send(MSG_INFO, `unknown sidecar '${name}'. Try /sidecar list`);
					return;
				}
				try {
					await startSidecar(def, ctx, extra);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					send(MSG_RESULT, `sidecar start failed: ${message}`, { name, error: message });
				}
				return;
			}

			if (sub === "stop") {
				const text = await stopSidecar(rest || undefined);
				send(MSG_INFO, text);
				return;
			}

			send(MSG_INFO, `unknown subcommand '${sub}'. Try: start|stop|list|status|mode`);
		},
	});
}
