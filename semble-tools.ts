import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getToolOutputMode } from "./tool-output-mode-state";

const CONTENT_TYPES = ["code", "docs", "config", "all"] as const;
type ContentType = (typeof CONTENT_TYPES)[number];
type SembleToggleAction = "on" | "off" | "toggle" | "status";

type SembleSearchResult = {
	file_path?: string;
	start_line?: number;
	end_line?: number;
	content?: string;
	score?: number;
};

type SembleResponse = {
	query?: string;
	error?: string;
	results?: SembleSearchResult[];
};

type CompactResult = {
	file_path: string;
	line: number;
	end_line?: number;
	location: string;
	score?: number;
	snippet: string;
};

type SembleRenderDetails = {
	query?: string;
	target?: string;
	results?: CompactResult[];
	rawCount?: number;
	content?: string;
	error?: string;
};

const DEFAULT_TOP_K = 3;
const MAX_TOP_K = 10;
const MAX_SNIPPET_CHARS = 900;
const SEMBLE_TIMEOUT_MS = 45_000;
const SEMBLE_CHECK_TIMEOUT_MS = 5_000;
const GIT_TOPLEVEL_TIMEOUT_MS = 5_000;
const SEMBLE_COMMAND = "semble";
const SEMBLE_TOOL_NAMES = ["semble_search", "semble_find_related"] as const;
const SEMBLE_CONFIG_PATH = join(getAgentDir(), "semble-tools", "config.json");
const SEMBLE_CONFIG_VERSION = 1 as const;
const GIT_URL_SCHEMES = ["https://", "http://", "ssh://", "git://", "git+ssh://", "file://"] as const;
const SCP_GIT_URL_RE = /^[\w.-]+@[\w.-]+:(?!\/)/;

interface SembleGlobalConfig {
	version: typeof SEMBLE_CONFIG_VERSION;
	enabled: boolean;
}

const SearchParams = Type.Object({
	query: Type.String({ description: "Natural-language or code query." }),
	repo: Type.Optional(Type.String({ description: "Local repository path or https:// git URL. Defaults to the current Git repo root when inside Git, otherwise the current working directory." })),
	top_k: Type.Optional(Type.Number({ description: `Number of results to return. Default: ${DEFAULT_TOP_K}.`, minimum: 1, maximum: MAX_TOP_K })),
	content: Type.Optional(Type.String({ description: "Content type: code, docs, config, or all." })),
});

const FindRelatedParams = Type.Object({
	file_path: Type.String({ description: "Path returned by semble_search." }),
	line: Type.Number({ description: "Line number from a semble_search result. Use the result's start line by default.", minimum: 1 }),
	repo: Type.Optional(Type.String({ description: "Local repository path or https:// git URL. Defaults to the current Git repo root when inside Git, otherwise the current working directory." })),
	top_k: Type.Optional(Type.Number({ description: `Number of related results to return. Default: ${DEFAULT_TOP_K}.`, minimum: 1, maximum: MAX_TOP_K })),
	content: Type.Optional(Type.String({ description: "Content type: code, docs, config, or all." })),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultSembleConfig(): SembleGlobalConfig {
	return {
		version: SEMBLE_CONFIG_VERSION,
		enabled: false,
	};
}

function normalizeSembleConfig(raw: unknown): SembleGlobalConfig {
	if (!isPlainObject(raw)) return defaultSembleConfig();
	return {
		version: SEMBLE_CONFIG_VERSION,
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : false,
	};
}

async function loadSembleConfig(): Promise<SembleGlobalConfig> {
	try {
		return normalizeSembleConfig(JSON.parse(await readFile(SEMBLE_CONFIG_PATH, "utf8")));
	} catch {
		return defaultSembleConfig();
	}
}

async function saveSembleConfig(config: SembleGlobalConfig): Promise<void> {
	await mkdir(dirname(SEMBLE_CONFIG_PATH), { recursive: true });
	await writeFile(SEMBLE_CONFIG_PATH, `${JSON.stringify(normalizeSembleConfig(config), null, "\t")}\n`, "utf8");
}

function normalizePathLike(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

function normalizeTopK(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const rounded = Math.trunc(value);
	if (rounded < 1) return 1;
	if (rounded > MAX_TOP_K) return MAX_TOP_K;
	return rounded;
}

function normalizeContent(value: unknown): ContentType | undefined {
	if (typeof value !== "string") return undefined;
	return (CONTENT_TYPES as readonly string[]).includes(value) ? (value as ContentType) : undefined;
}

function isGitUrlLike(value: string): boolean {
	return GIT_URL_SCHEMES.some((prefix) => value.startsWith(prefix)) || SCP_GIT_URL_RE.test(value);
}

function trimSnippet(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= MAX_SNIPPET_CHARS) return trimmed;
	return `${trimmed.slice(0, MAX_SNIPPET_CHARS).trimEnd()}\n…`;
}

function roundScore(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.round(value * 1000) / 1000;
}

function compactResults(results: SembleSearchResult[] | undefined): CompactResult[] {
	if (!Array.isArray(results)) return [];
	return results.flatMap((result) => {
		if (typeof result.file_path !== "string" || typeof result.start_line !== "number") return [];
		const endLine = typeof result.end_line === "number" ? result.end_line : undefined;
		return [
			{
				file_path: result.file_path,
				line: result.start_line,
				end_line: endLine,
				location: `${result.file_path}:${result.start_line}${endLine ? `-${endLine}` : ""}`,
				score: roundScore(result.score),
				snippet: trimSnippet(typeof result.content === "string" ? result.content : ""),
			},
		];
	});
}

function formatCompactResults(label: string, queryOrTarget: string, results: CompactResult[]): string {
	if (results.length === 0) return `${label}: ${queryOrTarget}\nNo results found.`;
	const blocks = results.map((result, index) => {
		const headerParts = [`${index + 1}. ${result.location}`];
		if (typeof result.score === "number") headerParts.push(`score=${result.score}`);
		return `${headerParts.join(" ")}\n${result.snippet}`.trimEnd();
	});
	return `${label}: ${queryOrTarget}\n\n${blocks.join("\n\n")}`;
}

function getTextContent(result: { content?: Array<{ type: string; text?: string }> }): string {
	return result.content?.find((item) => item.type === "text")?.text ?? "";
}

function countSnippetLines(results: CompactResult[]): number {
	return results.reduce((sum, result) => {
		const lines = result.snippet.split("\n").filter((line) => line.trim()).length;
		return sum + Math.max(lines, 1);
	}, 0);
}

function shortenInline(text: string, maxChars = 120): string {
	const inline = text.replace(/\s+/g, " ").trim();
	if (inline.length <= maxChars) return inline;
	return `${inline.slice(0, maxChars - 1).trimEnd()}…`;
}

function getSembleSubject(kind: "search" | "find_related", details: SembleRenderDetails | undefined): string {
	return kind === "search" ? (details?.query ?? "") : (details?.target ?? "");
}

function renderSembleCall(
	kind: "search" | "find_related",
	args: Record<string, unknown>,
	theme: {
		fg(color: string, text: string): string;
	},
): Text {
	const title = kind === "search" ? "semble_search" : "semble_find_related";
	const subject = kind === "search"
		? (typeof args.query === "string" ? args.query : "")
		: (() => {
			const filePath = typeof args.file_path === "string" ? args.file_path : "";
			const line = typeof args.line === "number" && Number.isFinite(args.line) ? Math.trunc(args.line) : undefined;
			return filePath ? `${filePath}${line ? `:${line}` : ""}` : "";
		})();
	let text = theme.fg("toolTitle", title);
	if (subject) {
		text += ` ${theme.fg("accent", shortenInline(subject))}`;
	}
	return new Text(text, 0, 0);
}

function renderSembleResult(
	kind: "search" | "find_related",
	result: {
		content?: Array<{ type: string; text?: string }>;
		details?: SembleRenderDetails;
	},
	options: { expanded?: boolean; isPartial?: boolean },
	theme: {
		fg(color: string, text: string): string;
	},
): Text | Container {
	const outputMode = getToolOutputMode();
	if (!outputMode) {
		const text = getTextContent(result).trim();
		return new Text(text ? `\n${theme.fg("toolOutput", text)}` : "", 0, 0);
	}

	const details = result.details;
	const text = getTextContent(result).trim();
	const errorText = typeof details?.error === "string" && details.error.trim()
		? details.error.trim()
		: text.startsWith("Error")
			? text
			: undefined;
	if (outputMode === "hidden") {
		if (options.isPartial) return new Container();
		if (errorText) return new Text(theme.fg("error", shortenInline(errorText, 160)), 0, 0);
		const results = Array.isArray(details?.results) ? details.results : [];
		const rawCount = typeof details?.rawCount === "number" ? details.rawCount : results.length;
		const summaryLabel = kind === "search" ? "results" : "related results";
		let summary = theme.fg("success", `${rawCount} ${summaryLabel}`);
		if (typeof details?.rawCount === "number" && details.rawCount > results.length) {
			summary += theme.fg("muted", ` (${results.length} shown)`);
		}
		return new Text(summary, 0, 0);
	}
	if (options.isPartial) {
		const loadingText = kind === "search" ? "Searching..." : "Finding related code...";
		return new Text(theme.fg("warning", loadingText), 0, 0);
	}

	if (errorText) {
		if (outputMode === "compact" && !options.expanded) {
			return new Text(theme.fg("error", errorText), 0, 0);
		}
		const header = theme.fg("error", kind === "search" ? "Semble search failed" : "Semble related lookup failed");
		const body = text.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n");
		return new Text(body ? `${header}\n${body}` : header, 0, 0);
	}

	const results = Array.isArray(details?.results) ? details.results : [];
	const subject = getSembleSubject(kind, details);
	const summaryLabel = kind === "search" ? "results" : "related results";
	const count = results.length;
	const snippetLines = countSnippetLines(results);
	let header = theme.fg("success", `${count} ${summaryLabel}`);
	if (subject) {
		header += theme.fg("dim", ` for ${subject}`);
	}
	if (details?.content) {
		header += theme.fg("muted", ` [${details.content}]`);
	}
	if (typeof details?.rawCount === "number" && details.rawCount > count) {
		header += theme.fg("muted", ` (${details.rawCount} raw)`);
	}
	if (count > 0) {
		header += theme.fg("dim", ` • ${snippetLines} lines`);
	}

	if (outputMode === "compact" && !options.expanded) {
		return new Text(header, 0, 0);
	}

	if (!text) return new Text(header, 0, 0);
	const body = text.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n");
	return new Text(`${header}\n${body}`, 0, 0);
}

async function runSemble(pi: ExtensionAPI, args: string[], cwd: string, signal?: AbortSignal): Promise<SembleResponse> {
	try {
		const result = await pi.exec(SEMBLE_COMMAND, args, {
			cwd,
			signal,
			timeout: SEMBLE_TIMEOUT_MS,
		});
		const stdout = result.stdout.trim();
		const stderr = result.stderr.trim();

		if (result.code !== 0) {
			throw new Error(stderr || stdout || `semble exited with code ${result.code}`);
		}
		if (!stdout) {
			throw new Error("Semble returned empty output.");
		}

		return JSON.parse(stdout) as SembleResponse;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("spawn semble") || message.includes("ENOENT")) {
			throw new Error("Semble CLI is not available on PATH.");
		}
		if (message.includes("Unexpected token") || message.includes("JSON")) {
			throw new Error(`Semble returned invalid JSON: ${message}`);
		}
		throw error instanceof Error ? error : new Error(message);
	}
}

async function hasSembleCli(pi: ExtensionAPI): Promise<boolean> {
	try {
		const result = await pi.exec("bash", ["-lc", `command -v ${SEMBLE_COMMAND} >/dev/null 2>&1`], {
			timeout: SEMBLE_CHECK_TIMEOUT_MS,
		});
		return result.code === 0;
	} catch {
		return false;
	}
}

async function resolveGitTopLevel(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
	try {
		const resolvedCwd = resolvePath(cwd);
		const result = await pi.exec("git", ["-C", resolvedCwd, "rev-parse", "--show-toplevel"], {
			cwd: resolvedCwd,
			timeout: GIT_TOPLEVEL_TIMEOUT_MS,
		});
		const gitRoot = result.code === 0 ? result.stdout.trim() : "";
		return gitRoot || undefined;
	} catch {
		return undefined;
	}
}

async function resolveSembleRepo(pi: ExtensionAPI, repo: string | undefined, cwd: string): Promise<string> {
	if (repo) {
		return isGitUrlLike(repo) ? repo : resolvePath(cwd, repo);
	}

	return (await resolveGitTopLevel(pi, cwd)) ?? resolvePath(cwd);
}

function prepareSearchArguments(args: unknown): unknown {
	if (!args || typeof args !== "object") return args;
	const input = args as Record<string, unknown>;
	return {
		...input,
		repo: normalizePathLike(input.repo) ?? normalizePathLike(input.path),
		top_k: normalizeTopK(input.top_k) ?? normalizeTopK(input.topK),
		content: normalizeContent(input.content),
	};
}

function prepareFindRelatedArguments(args: unknown): unknown {
	if (!args || typeof args !== "object") return args;
	const input = args as Record<string, unknown>;
	return {
		...input,
		file_path: normalizePathLike(input.file_path) ?? normalizePathLike(input.filePath),
		repo: normalizePathLike(input.repo) ?? normalizePathLike(input.path),
		top_k: normalizeTopK(input.top_k) ?? normalizeTopK(input.topK),
		content: normalizeContent(input.content),
	};
}

function parseToggleAction(value: string): SembleToggleAction | undefined {
	const normalized = value.trim().toLowerCase();
	if (!normalized) return "toggle";
	if (normalized === "on" || normalized === "off" || normalized === "toggle" || normalized === "status") {
		return normalized;
	}
	return undefined;
}

export default async function sembleTools(pi: ExtensionAPI): Promise<void> {
	if (!(await hasSembleCli(pi))) {
		return;
	}

	const globalConfig = await loadSembleConfig();
	let toolsRegistered = false;
	let enabled = globalConfig.enabled;

	function registerSembleTools(): void {
		if (toolsRegistered) return;
		toolsRegistered = true;

		pi.registerTool({
			name: "semble_search",
			label: "Semble Search",
			description: "Search a repository semantically with the Semble CLI. Returns a compact result set with file_path, line, end_line, score, and snippet fields to reduce tokens.",
			promptSnippet: "Semantic repository search via Semble CLI with compact results for low-token code exploration",
			promptGuidelines: [
				"Use semble_search for exploratory repository search when the exact file is unknown; prefer it over bash rg/find for behavior, intent, or symbol-driven discovery.",
				"Use semble_search repeatedly while the task is still exploratory instead of doing only one Semble query and then switching to bash rg/find.",
				"Use semble_find_related after a strong semble_search hit to expand to similar implementations before falling back to bash rg/find.",
			],
			parameters: SearchParams,
			prepareArguments: prepareSearchArguments,
			renderCall(args, theme) {
				return renderSembleCall("search", args as Record<string, unknown>, theme);
			},
			renderResult(result, options, theme) {
				return renderSembleResult("search", result as any, options, theme);
			},
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				onUpdate?.({
					content: [{ type: "text", text: `Searching with Semble: ${params.query}` }],
					details: { phase: "searching" },
				});

				const effectiveRepo = await resolveSembleRepo(pi, params.repo, ctx.cwd);
				const args = ["search", params.query, effectiveRepo];
				if (params.top_k) args.push("--top-k", String(params.top_k));
				if (params.content) args.push("--content", params.content);

				const raw = await runSemble(pi, args, ctx.cwd, signal);
				const results = compactResults(raw.results);
				const summary = raw.error
					? `Query: ${params.query}\n${raw.error}`
					: formatCompactResults("Query", raw.query ?? params.query, results);

				return {
					content: [{ type: "text", text: summary }],
					details: {
						query: raw.query ?? params.query,
						repo: effectiveRepo,
						content: params.content ?? "code",
						results,
						rawCount: Array.isArray(raw.results) ? raw.results.length : 0,
						error: raw.error,
					},
				};
			},
		});

		pi.registerTool({
			name: "semble_find_related",
			label: "Semble Find Related",
			description: "Find code related to a known file and line using the Semble CLI. Returns a compact result set with file_path, line, end_line, score, and snippet fields to reduce tokens.",
			promptSnippet: "Find code related to a known file and line using Semble CLI with compact results",
			promptGuidelines: [
				"Use semble_find_related after a good semble_search hit when you want similar implementations, parallel handlers, or nearby patterns.",
				"Use the exact file_path from semble_search and the hit's start line when calling semble_find_related.",
			],
			parameters: FindRelatedParams,
			prepareArguments: prepareFindRelatedArguments,
			renderCall(args, theme) {
				return renderSembleCall("find_related", args as Record<string, unknown>, theme);
			},
			renderResult(result, options, theme) {
				return renderSembleResult("find_related", result as any, options, theme);
			},
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				onUpdate?.({
					content: [{ type: "text", text: `Finding related code for ${params.file_path}:${params.line}` }],
					details: { phase: "finding_related" },
				});

				const effectiveRepo = await resolveSembleRepo(pi, params.repo, ctx.cwd);
				const args = ["find-related", params.file_path, String(params.line), effectiveRepo];
				if (params.top_k) args.push("--top-k", String(params.top_k));
				if (params.content) args.push("--content", params.content);

				const raw = await runSemble(pi, args, ctx.cwd, signal);
				const results = compactResults(raw.results);
				const target = `${params.file_path}:${params.line}`;
				const summary = raw.error ? `Target: ${target}\n${raw.error}` : formatCompactResults("Target", target, results);

				return {
					content: [{ type: "text", text: summary }],
					details: {
						target,
						repo: effectiveRepo,
						content: params.content ?? "code",
						results,
						rawCount: Array.isArray(raw.results) ? raw.results.length : 0,
						error: raw.error,
					},
				};
			},
		});
	}

	function applyEnabledState(nextEnabled: boolean): void {
		if (nextEnabled) registerSembleTools();
		enabled = nextEnabled;

		const activeTools = pi.getActiveTools();
		const activeSet = new Set(activeTools);
		for (const toolName of SEMBLE_TOOL_NAMES) {
			if (enabled) activeSet.add(toolName);
			else activeSet.delete(toolName);
		}

		const nextActiveTools = activeTools.filter((toolName) => activeSet.has(toolName));
		if (enabled) {
			for (const toolName of SEMBLE_TOOL_NAMES) {
				if (!nextActiveTools.includes(toolName)) nextActiveTools.push(toolName);
			}
		}

		pi.setActiveTools(nextActiveTools);
	}

	async function setGlobalEnabled(nextEnabled: boolean): Promise<void> {
		await saveSembleConfig({
			version: SEMBLE_CONFIG_VERSION,
			enabled: nextEnabled,
		});
		applyEnabledState(nextEnabled);
	}

	pi.registerCommand(SEMBLE_COMMAND, {
		description: "Enable or disable Semble tools globally: /semble [on|off|toggle|status]",
		handler: async (args, ctx) => {
			const action = parseToggleAction(args);
			if (!action) {
				ctx.ui.notify("Usage: /semble [on|off|toggle|status]", "warning");
				return;
			}

			if (action === "status") {
				ctx.ui.notify(`Semble tools: ${enabled ? "enabled" : "disabled"} (global)`, "info");
				return;
			}

			const nextEnabled = action === "toggle" ? !enabled : action === "on";
			try {
				await setGlobalEnabled(nextEnabled);
				ctx.ui.notify(`Semble tools ${nextEnabled ? "enabled" : "disabled"} globally`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to update Semble global switch: ${message}`, "error");
			}
		},
	});

	pi.on("session_start", () => {
		applyEnabledState(enabled);
	});

	pi.on("session_tree", () => {
		applyEnabledState(enabled);
	});
}
