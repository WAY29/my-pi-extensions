import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class HerdrError extends Error {
	constructor(message: string, readonly detail?: string) {
		super(message);
		this.name = "HerdrError";
	}
}

export function assertHerdrEnv(): void {
	if (process.env.HERDR_ENV !== "1") {
		throw new HerdrError("herdr mode requires HERDR_ENV=1 (run inside a Herdr-managed pane)");
	}
	if (!process.env.HERDR_WORKSPACE_ID) {
		throw new HerdrError("HERDR_WORKSPACE_ID is missing");
	}
	if (!process.env.HERDR_SOCKET_PATH) {
		throw new HerdrError("HERDR_SOCKET_PATH is missing");
	}
}

export function currentWorkspaceId(): string {
	assertHerdrEnv();
	return process.env.HERDR_WORKSPACE_ID!;
}

async function herdr(args: string[], timeoutMs = 120_000): Promise<{ stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileAsync("herdr", args, {
			timeout: timeoutMs,
			maxBuffer: 8 * 1024 * 1024,
			env: process.env,
		});
		return { stdout: stdout ?? "", stderr: stderr ?? "" };
	} catch (err: any) {
		const stderr = String(err?.stderr ?? "");
		const stdout = String(err?.stdout ?? "");
		const msg = stderr || stdout || err?.message || "herdr command failed";
		throw new HerdrError(`herdr ${args.join(" ")} failed: ${msg}`, stderr || stdout);
	}
}

function parseJson(stdout: string): any {
	const text = stdout.trim();
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		// some commands may return raw text
		return { raw: text };
	}
}

export async function tabCreate(opts: {
	workspace: string;
	cwd: string;
	label: string;
	focus?: boolean;
}): Promise<{ tabId: string; paneId: string }> {
	const args = [
		"tab",
		"create",
		"--workspace",
		opts.workspace,
		"--cwd",
		opts.cwd,
		"--label",
		opts.label,
		opts.focus ? "--focus" : "--no-focus",
	];
	const { stdout } = await herdr(args);
	const json = parseJson(stdout);
	const tabId = json?.result?.tab?.tab_id;
	const paneId = json?.result?.root_pane?.pane_id;
	if (!tabId || !paneId) {
		throw new HerdrError(`tab create returned no ids: ${stdout}`);
	}
	return { tabId, paneId };
}

export async function tabClose(tabId: string): Promise<void> {
	await herdr(["tab", "close", tabId], 30_000);
}

export async function paneProcessInfo(paneId: string): Promise<any> {
	const { stdout } = await herdr(["pane", "process-info", "--pane", paneId], 15_000);
	return parseJson(stdout);
}

function isShellName(name: string): boolean {
	const n = name.toLowerCase();
	return /^(zsh|bash|fish|sh|dash|ksh)(\b|$)/.test(n) || n.endsWith("/zsh") || n.endsWith("/bash");
}

/** Wait until pane foreground is an interactive shell (agent start precondition). */
export async function waitForAvailableShell(
	paneId: string,
	timeoutMs = 15_000,
): Promise<void> {
	const start = Date.now();
	let lastDetail = "";
	while (Date.now() - start < timeoutMs) {
		try {
			const info = await paneProcessInfo(paneId);
			const procs: Array<{ name?: string; argv0?: string; cmdline?: string }> =
				info?.result?.process_info?.foreground_processes ??
				info?.process_info?.foreground_processes ??
				[];
			lastDetail = JSON.stringify(procs.map((p) => p.name || p.argv0 || p.cmdline));
			if (
				procs.length === 1 &&
				isShellName(String(procs[0]?.name || procs[0]?.argv0 || procs[0]?.cmdline || ""))
			) {
				return;
			}
			// empty list can mean shell still spawning
			if (procs.length === 0) {
				// keep waiting
			} 
		} catch (err) {
			lastDetail = err instanceof Error ? err.message : String(err);
		}
		await new Promise((r) => setTimeout(r, 150));
	}
	throw new HerdrError(
		`pane ${paneId} did not become an available shell within ${timeoutMs}ms (last=${lastDetail})`,
	);
}

export type HerdrAgentSummary = {
	name?: string;
	paneId?: string;
	tabId?: string;
	status?: string;
};

export async function agentList(): Promise<HerdrAgentSummary[]> {
	const { stdout } = await herdr(["agent", "list"], 15_000);
	const json = parseJson(stdout);
	const agents = json?.result?.agents ?? [];
	if (!Array.isArray(agents)) return [];
	return agents.map((a: any) => ({
		name: a?.name,
		paneId: a?.pane_id,
		tabId: a?.tab_id,
		status: a?.agent_status,
	}));
}

/** If name is already live, close its tab (orphan after /reload). */
export async function reclaimAgentName(name: string): Promise<boolean> {
	const live = (await agentList()).find((a) => a.name === name);
	if (!live) return false;
	if (live.tabId) {
		try {
			await tabClose(live.tabId);
		} catch {
			// best-effort; start may still fail with name_taken
		}
		// brief wait for herdr to drop the name
		for (let i = 0; i < 20; i++) {
			const still = (await agentList()).some((a) => a.name === name);
			if (!still) return true;
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	return true;
}

export async function agentStart(opts: {
	name: string;
	kind: string;
	paneId: string;
	agentArgs?: string[];
	timeoutMs?: number;
}): Promise<void> {
	const args = [
		"agent",
		"start",
		opts.name,
		"--kind",
		opts.kind,
		"--pane",
		opts.paneId,
		"--timeout",
		String(opts.timeoutMs ?? 60_000),
	];
	if (opts.agentArgs?.length) {
		args.push("--", ...opts.agentArgs);
	}
	const attempts = 4;
	let lastErr: unknown;
	for (let i = 0; i < attempts; i++) {
		try {
			if (i > 0) {
				await waitForAvailableShell(opts.paneId, 10_000);
			}
			await herdr(args, (opts.timeoutMs ?? 60_000) + 5_000);
			return;
		} catch (err) {
			lastErr = err;
			const msg = err instanceof Error ? err.message : String(err);
			const busy = msg.includes("agent_pane_busy") || msg.includes("not an available shell");
			if (!busy || i === attempts - 1) throw err;
			await new Promise((r) => setTimeout(r, 250 * (i + 1)));
		}
	}
	throw lastErr;
}

export async function agentPrompt(opts: {
	target: string;
	text: string;
	wait?: boolean;
	timeoutMs?: number;
}): Promise<void> {
	const args = ["agent", "prompt", opts.target, opts.text];
	if (opts.wait) {
		args.push("--wait");
		if (opts.timeoutMs != null) {
			args.push("--timeout", String(opts.timeoutMs));
		}
	}
	const timeout = (opts.timeoutMs ?? 600_000) + 10_000;
	await herdr(args, timeout);
}

export async function agentRead(opts: {
	target: string;
	lines: number;
}): Promise<string> {
	const { stdout } = await herdr(
		[
			"agent",
			"read",
			opts.target,
			"--source",
			"recent-unwrapped",
			"--lines",
			String(opts.lines),
			"--format",
			"text",
		],
		30_000,
	);
	const json = parseJson(stdout);
	if (typeof json?.result?.text === "string") return json.result.text;
	if (typeof json?.result?.content === "string") return json.result.content;
	if (typeof json?.raw === "string") return json.raw;
	// plain text body
	return stdout;
}

export async function agentGet(target: string): Promise<any> {
	const { stdout } = await herdr(["agent", "get", target], 15_000);
	return parseJson(stdout);
}
