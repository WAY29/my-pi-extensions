import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const COMMAND = "builtin-tools";
const DEFAULT_ACTIVE_TOOLS = ["read", "bash", "edit", "write"] as const;
const TOOL_NAMES = ["grep", "find", "ls"] as const;
const CONFIG_PATH = join(getAgentDir(), "builtin-tools", "config.json");
const CONFIG_VERSION = 1 as const;

type ManagedToolName = (typeof TOOL_NAMES)[number];
type ToggleAction = "on" | "off" | "toggle" | "status";
const ACTIONS = ["on", "off", "toggle", "status"] as const;

interface BuiltinToolsConfig {
	version: typeof CONFIG_VERSION;
	grep: boolean;
	find: boolean;
	ls: boolean;
}

interface ParsedCommandArgs {
	action: ToggleAction;
	target?: ManagedToolName;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagedToolName(value: string): value is ManagedToolName {
	return (TOOL_NAMES as readonly string[]).includes(value);
}

function defaultConfig(): BuiltinToolsConfig {
	return {
		version: CONFIG_VERSION,
		grep: false,
		find: false,
		ls: false,
	};
}

function normalizeConfig(raw: unknown): BuiltinToolsConfig {
	if (!isPlainObject(raw)) return defaultConfig();
	return {
		version: CONFIG_VERSION,
		grep: typeof raw.grep === "boolean" ? raw.grep : false,
		find: typeof raw.find === "boolean" ? raw.find : false,
		ls: typeof raw.ls === "boolean" ? raw.ls : false,
	};
}

async function loadConfig(): Promise<BuiltinToolsConfig> {
	try {
		return normalizeConfig(JSON.parse(await readFile(CONFIG_PATH, "utf8")));
	} catch {
		return defaultConfig();
	}
}

async function saveConfig(config: BuiltinToolsConfig): Promise<void> {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(normalizeConfig(config), null, "\t")}\n`, "utf8");
}

function parseAction(raw: string): ToggleAction | undefined {
	const normalized = raw.trim().toLowerCase();
	if (normalized === "on" || normalized === "off" || normalized === "toggle" || normalized === "status") {
		return normalized;
	}
	return undefined;
}

function parseCommandArgs(raw: string): ParsedCommandArgs | undefined {
	const parts = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { action: "toggle" };
	if (parts.length === 1) {
		const [first] = parts;
		if (!first) return { action: "toggle" };
		if (isManagedToolName(first)) return { target: first, action: "toggle" };
		const action = parseAction(first);
		return action ? { action } : undefined;
	}
	if (parts.length === 2) {
		const [first, second] = parts;
		if (!first || !second || !isManagedToolName(first)) return undefined;
		const action = parseAction(second);
		return action ? { target: first, action } : undefined;
	}
	return undefined;
}

function getArgumentCompletions(prefix: string): Array<{ value: string; label: string }> | null {
	const raw = prefix.toLowerCase();
	const hasTrailingSpace = /\s$/.test(prefix);
	const parts = raw.trim().split(/\s+/).filter(Boolean);

	if (parts.length === 0) {
		return [
			...TOOL_NAMES.map((toolName) => ({ value: toolName, label: `${toolName} tool` })),
			...ACTIONS.map((action) => ({ value: action, label: `${action} all managed tools` })),
		];
	}

	if (parts.length === 1) {
		const [first] = parts;
		if (!first) return null;
		if (hasTrailingSpace && isManagedToolName(first)) {
			return ACTIONS.map((action) => ({ value: `${first} ${action}`, label: `${action} ${first}` }));
		}
		const toolMatches = TOOL_NAMES.filter((toolName) => toolName.startsWith(first)).map((toolName) => ({
			value: toolName,
			label: `${toolName} tool`,
		}));
		const actionMatches = ACTIONS.filter((action) => action.startsWith(first)).map((action) => ({
			value: action,
			label: `${action} all managed tools`,
		}));
		const combined = [...toolMatches, ...actionMatches];
		return combined.length > 0 ? combined : null;
	}

	if (parts.length === 2) {
		const [first, second] = parts;
		if (!first || !second || !isManagedToolName(first)) return null;
		const matches = ACTIONS.filter((action) => action.startsWith(second)).map((action) => ({
			value: `${first} ${action}`,
			label: `${action} ${first}`,
		}));
		return matches.length > 0 ? matches : null;
	}

	return null;
}

function formatOnOff(value: boolean): string {
	return value ? "on" : "off";
}

function sameToolList(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}

function shouldAutoApply(activeTools: string[]): boolean {
	const activeSet = new Set(activeTools);
	if (TOOL_NAMES.some((toolName) => activeSet.has(toolName))) return false;
	return DEFAULT_ACTIVE_TOOLS.every((toolName) => activeSet.has(toolName));
}

function isGroupFullyEnabled(config: BuiltinToolsConfig): boolean {
	return TOOL_NAMES.every((toolName) => config[toolName]);
}

export default async function builtinTools(pi: ExtensionAPI): Promise<void> {
	let config = await loadConfig();

	function getTargetTools(target?: ManagedToolName): ManagedToolName[] {
		return target ? [target] : [...TOOL_NAMES];
	}

	function getAvailableManagedTools(targetTools: readonly ManagedToolName[]): ManagedToolName[] {
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		return targetTools.filter((toolName) => available.has(toolName));
	}

	function applyConfigToActiveTools(activeTools: string[], targetTools: readonly ManagedToolName[]): string[] {
		const availableTargetTools = getAvailableManagedTools(targetTools);
		if (availableTargetTools.length === 0) return activeTools;

		const activeSet = new Set(activeTools);
		for (const toolName of availableTargetTools) {
			if (config[toolName]) activeSet.add(toolName);
			else activeSet.delete(toolName);
		}

		const nextActiveTools = activeTools.filter((toolName) => activeSet.has(toolName));
		for (const toolName of availableTargetTools) {
			if (config[toolName] && !nextActiveTools.includes(toolName)) nextActiveTools.push(toolName);
		}
		return nextActiveTools;
	}

	function applyNow(targetTools: readonly ManagedToolName[]): void {
		const activeTools = pi.getActiveTools();
		const nextActiveTools = applyConfigToActiveTools(activeTools, targetTools);
		if (!sameToolList(activeTools, nextActiveTools)) {
			pi.setActiveTools(nextActiveTools);
		}
	}

	function maybeAutoApply(): void {
		const activeTools = pi.getActiveTools();
		if (!shouldAutoApply(activeTools)) return;
		const nextActiveTools = applyConfigToActiveTools(activeTools, TOOL_NAMES);
		if (!sameToolList(activeTools, nextActiveTools)) {
			pi.setActiveTools(nextActiveTools);
		}
	}

	function currentState(): Record<ManagedToolName, boolean> {
		const activeSet = new Set(pi.getActiveTools());
		return {
			grep: activeSet.has("grep"),
			find: activeSet.has("find"),
			ls: activeSet.has("ls"),
		};
	}

	function buildStatusSummary(target?: ManagedToolName): string {
		const current = currentState();
		const tools = getTargetTools(target);
		const details = tools.map((toolName) => `${toolName} pref=${formatOnOff(config[toolName])} current=${formatOnOff(current[toolName])}`);
		return target
			? `builtin tool ${target}: ${details[0] ?? `${target} pref=${formatOnOff(config[target])} current=${formatOnOff(current[target])}`}`
			: `builtin tools: ${details.join(", ")}`;
	}

	async function updateConfig(nextConfig: BuiltinToolsConfig): Promise<void> {
		config = normalizeConfig(nextConfig);
		await saveConfig(config);
	}

	pi.registerCommand(COMMAND, {
		description: "Enable or disable built-in grep/find/ls globally: /builtin-tools [on|off|toggle|status] or /builtin-tools <grep|find|ls> [on|off|toggle|status]",
		getArgumentCompletions,
		handler: async (args, ctx) => {
			const parsed = parseCommandArgs(args);
			if (!parsed) {
				ctx.ui.notify(
					"Usage: /builtin-tools [on|off|toggle|status] or /builtin-tools <grep|find|ls> [on|off|toggle|status]",
					"warning",
				);
				return;
			}

			if (parsed.action === "status") {
				ctx.ui.notify(`${buildStatusSummary(parsed.target)} (global)`, "info");
				return;
			}

			const nextConfig: BuiltinToolsConfig = { ...config };
			const targetTools = getTargetTools(parsed.target);

			if (parsed.target) {
				const currentValue = config[parsed.target];
				nextConfig[parsed.target] = parsed.action === "toggle" ? !currentValue : parsed.action === "on";
			} else {
				const nextValue = parsed.action === "toggle" ? !isGroupFullyEnabled(config) : parsed.action === "on";
				for (const toolName of targetTools) {
					nextConfig[toolName] = nextValue;
				}
			}

			try {
				await updateConfig(nextConfig);
				applyNow(targetTools);
				ctx.ui.notify(`${buildStatusSummary(parsed.target)} (global updated)`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to update builtin tools global switch: ${message}`, "error");
			}
		},
	});

	pi.on("session_start", () => {
		maybeAutoApply();
	});

	pi.on("session_tree", () => {
		maybeAutoApply();
	});
}
