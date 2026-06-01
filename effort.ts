import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type EffortAction = ThinkingLevel | "next" | "prev" | "status";
type EffortScope = "session" | "global";

type GlobalDefaultSnapshot = {
	hadKey: boolean;
	rawValue: unknown;
	value: ThinkingLevel | undefined;
};

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const GLOBAL_SETTINGS_PATH = join(getAgentDir(), "settings.json");

const ALIASES: Record<string, EffortAction> = {
	"0": "off",
	"1": "minimal",
	"2": "low",
	"3": "medium",
	"4": "high",
	"5": "xhigh",
	none: "off",
	min: "minimal",
	med: "medium",
	max: "xhigh",
	x: "xhigh",
	n: "next",
	next: "next",
	"+": "next",
	p: "prev",
	prev: "prev",
	previous: "prev",
	"-": "prev",
	current: "status",
	status: "status",
};

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAction(raw: string): EffortAction | undefined {
	const normalized = raw.trim().toLowerCase();
	if (isThinkingLevel(normalized)) return normalized;
	return ALIASES[normalized];
}

function adjacentLevel(current: ThinkingLevel, direction: 1 | -1): ThinkingLevel {
	const currentIndex = LEVELS.indexOf(current);
	const nextIndex = (currentIndex + direction + LEVELS.length) % LEVELS.length;
	return LEVELS[nextIndex]!;
}

function notify(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error" = "info") {
	ctx.ui.notify(message, type);
}

function commandName(scope: EffortScope): string {
	return scope === "session" ? "/effort" : "/effort:global";
}

function commandDescription(scope: EffortScope): string {
	return scope === "session"
		? "Switch thinking level for the current session"
		: "Set the global default thinking level for new sessions";
}

function settingLabel(scope: EffortScope): string {
	return scope === "session" ? "Thinking level" : "Global default thinking level";
}

function usage(scope: EffortScope): string {
	return `${commandName(scope)} [off|minimal|low|medium|high|xhigh|next|prev|status]`;
}

function readGlobalSettings(): Record<string, unknown> {
	if (!existsSync(GLOBAL_SETTINGS_PATH)) return {};

	const raw = readFileSync(GLOBAL_SETTINGS_PATH, "utf-8").trim();
	if (!raw) return {};

	const parsed: unknown = JSON.parse(raw);
	if (!isPlainObject(parsed)) {
		throw new Error(`Global settings file is not a JSON object: ${GLOBAL_SETTINGS_PATH}`);
	}

	return parsed;
}

function getGlobalDefaultSnapshotFromSettings(settings: Record<string, unknown>): GlobalDefaultSnapshot {
	const hadKey = Object.prototype.hasOwnProperty.call(settings, "defaultThinkingLevel");
	const rawValue = hadKey ? settings.defaultThinkingLevel : undefined;
	return {
		hadKey,
		rawValue,
		value: isThinkingLevel(rawValue) ? rawValue : undefined,
	};
}

function getGlobalDefaultSnapshot(): GlobalDefaultSnapshot {
	return getGlobalDefaultSnapshotFromSettings(readGlobalSettings());
}

function writeGlobalSettings(settings: Record<string, unknown>) {
	mkdirSync(dirname(GLOBAL_SETTINGS_PATH), { recursive: true });
	writeFileSync(GLOBAL_SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}

function restoreGlobalDefault(snapshot: GlobalDefaultSnapshot) {
	const settings = readGlobalSettings();
	if (snapshot.hadKey) {
		settings.defaultThinkingLevel = snapshot.rawValue;
	} else {
		delete settings.defaultThinkingLevel;
	}
	writeGlobalSettings(settings);
}

function setGlobalDefaultThinkingLevel(level: ThinkingLevel): GlobalDefaultSnapshot {
	const settings = readGlobalSettings();
	const before = getGlobalDefaultSnapshotFromSettings(settings);
	settings.defaultThinkingLevel = level;
	writeGlobalSettings(settings);
	return before;
}

function formatGlobalDefault(snapshot: GlobalDefaultSnapshot): string {
	if (!snapshot.hadKey) return "unset";
	if (snapshot.value) return snapshot.value;
	return "invalid";
}

function shouldRestoreGlobalDefault(snapshot: GlobalDefaultSnapshot, nextLevel: ThinkingLevel): boolean {
	return !snapshot.hadKey || snapshot.rawValue !== nextLevel;
}

async function waitForGlobalDefault(level: ThinkingLevel, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		try {
			const settings = readGlobalSettings();
			if (settings.defaultThinkingLevel === level) return;
		} catch {
			// Keep waiting; caller will surface a later restore/read error if needed.
		}

		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	throw new Error(`Timed out waiting for Pi to persist defaultThinkingLevel=${level}`);
}

function getCurrentLevel(scope: EffortScope, pi: ExtensionAPI): ThinkingLevel | undefined {
	if (scope === "session") return pi.getThinkingLevel();
	return getGlobalDefaultSnapshot().value;
}

async function setSessionLevel(pi: ExtensionAPI, ctx: ExtensionCommandContext, requested: ThinkingLevel) {
	let restoreError: string | undefined;
	let globalBefore: GlobalDefaultSnapshot | undefined;

	try {
		globalBefore = getGlobalDefaultSnapshot();
	} catch (error) {
		restoreError = error instanceof Error ? error.message : String(error);
	}

	const before = pi.getThinkingLevel();
	pi.setThinkingLevel(requested);
	const after = pi.getThinkingLevel();

	if (after !== before && globalBefore && shouldRestoreGlobalDefault(globalBefore, after)) {
		try {
			await waitForGlobalDefault(after);
			restoreGlobalDefault(globalBefore);
		} catch (error) {
			restoreError = error instanceof Error ? error.message : String(error);
		}
	}

	if (after !== requested) {
		const suffix = restoreError
			? ` Global default restore failed: ${restoreError}. New sessions may still be affected.`
			: "";
		notify(ctx, `Thinking level requested: ${requested}; effective: ${after} (clamped by current model).${suffix}`, restoreError ? "error" : "warning");
		return;
	}

	if (before === after) {
		notify(ctx, `Thinking level already ${after}.`, "info");
		return;
	}

	const suffix = restoreError
		? ` Global default restore failed: ${restoreError}. New sessions may still be affected.`
		: " Session only; global default unchanged.";
	notify(ctx, `Thinking level: ${before} → ${after}.${suffix}`, restoreError ? "error" : "info");
}

function setGlobalLevel(pi: ExtensionAPI, ctx: ExtensionCommandContext, requested: ThinkingLevel) {
	const before = pi.getThinkingLevel();
	pi.setThinkingLevel(requested);
	const after = pi.getThinkingLevel();

	let globalBefore: GlobalDefaultSnapshot | undefined;
	let globalError: string | undefined;
	try {
		globalBefore = setGlobalDefaultThinkingLevel(after);
	} catch (error) {
		globalError = error instanceof Error ? error.message : String(error);
	}

	const globalSuffix = globalError
		? ` Global default update failed: ${globalError}.`
		: globalBefore
			? ` Global default thinking level: ${formatGlobalDefault(globalBefore)} → ${after}. New sessions will use this default (subject to model clamping).`
			: "";

	if (after !== requested) {
		notify(
			ctx,
			`Thinking level requested: ${requested}; effective: ${after} (clamped by current model).${globalSuffix}`,
			globalError ? "error" : "warning",
		);
		return;
	}

	if (before === after) {
		if (!globalError && globalBefore?.value === after) {
			notify(ctx, `Thinking level already ${after}; global default already ${after}.`, "info");
			return;
		}

		notify(ctx, `Thinking level already ${after}.${globalSuffix}`, globalError ? "error" : "info");
		return;
	}

	notify(ctx, `Thinking level: ${before} → ${after}.${globalSuffix}`, globalError ? "error" : "info");
}

async function setLevel(scope: EffortScope, pi: ExtensionAPI, ctx: ExtensionCommandContext, requested: ThinkingLevel) {
	if (scope === "session") {
		await setSessionLevel(pi, ctx, requested);
		return;
	}

	setGlobalLevel(pi, ctx, requested);
}

async function selectLevel(scope: EffortScope, pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	let current: ThinkingLevel | undefined;
	try {
		current = getCurrentLevel(scope, pi);
	} catch (error) {
		notify(ctx, `Failed to read ${settingLabel(scope).toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	}

	const options = LEVELS.map((level) => (level === current ? `${level} (current)` : level));
	const selected = await ctx.ui.select(settingLabel(scope), options);
	if (!selected) return;

	const level = selected.split(" ", 1)[0];
	if (!level || !isThinkingLevel(level)) return;
	await setLevel(scope, pi, ctx, level);
}

async function handleCommand(scope: EffortScope, pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const trimmed = args.trim();

	if (!trimmed) {
		await selectLevel(scope, pi, ctx);
		return;
	}

	const parts = trimmed.split(/\s+/);
	if (parts.length !== 1) {
		notify(ctx, `Usage: ${usage(scope)}`, "warning");
		return;
	}

	const action = parseAction(parts[0]!);
	if (!action) {
		notify(ctx, `Unknown effort "${parts[0]}". Usage: ${usage(scope)}`, "warning");
		return;
	}

	if (action === "status") {
		if (scope === "session") {
			notify(ctx, `Thinking level: ${pi.getThinkingLevel()}.`, "info");
			return;
		}

		try {
			notify(ctx, `Global default thinking level: ${formatGlobalDefault(getGlobalDefaultSnapshot())}.`, "info");
		} catch (error) {
			notify(ctx, `Failed to read global default thinking level: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
		return;
	}

	let current: ThinkingLevel | undefined;
	try {
		current = getCurrentLevel(scope, pi);
	} catch (error) {
		notify(ctx, `Failed to read ${settingLabel(scope).toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	}

	if (!current && (action === "next" || action === "prev")) {
		notify(
			ctx,
			scope === "session"
				? "Current thinking level is unavailable."
				: "Global default thinking level is unset or invalid. Use an explicit level or run /effort:global with no args.",
			"warning",
		);
		return;
	}

	if (action === "next") {
		await setLevel(scope, pi, ctx, adjacentLevel(current!, 1));
		return;
	}

	if (action === "prev") {
		await setLevel(scope, pi, ctx, adjacentLevel(current!, -1));
		return;
	}

	await setLevel(scope, pi, ctx, action);
}

function registerEffortCommand(pi: ExtensionAPI, name: string, scope: EffortScope) {
	pi.registerCommand(name, {
		description: commandDescription(scope),
		getArgumentCompletions: (prefix) => {
			const normalized = prefix.trim().toLowerCase();
			const values = [...LEVELS, "next", "prev", "status"];
			const matches = values.filter((value) => value.startsWith(normalized));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			await handleCommand(scope, pi, args, ctx);
		},
	});
}

export default function effortExtension(pi: ExtensionAPI) {
	registerEffortCommand(pi, "effort", "session");
	registerEffortCommand(pi, "effort:global", "global");
}
