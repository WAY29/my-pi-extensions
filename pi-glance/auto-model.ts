import { rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "./title-model.js";

const GLOBAL_SETTINGS_PATH = join(getAgentDir(), "settings.json");

export interface WorkspaceModelRule {
	directory: string;
	model: string;
}

export interface GlobalSettingsSnapshot {
	existed: boolean;
	text?: string;
}

export interface DefaultModelReference {
	provider: string;
	modelId: string;
	thinkingLevel?: ThinkingLevel;
}

function expandHomePath(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}

export function normalizeWorkspaceDirectory(directory: string, baseDir?: string): string {
	const trimmed = directory.trim();
	if (!trimmed) return "";
	const expanded = expandHomePath(trimmed);
	const resolved = resolve(baseDir ?? process.cwd(), expanded);
	const root = parse(resolved).root;
	return resolved.length > root.length ? resolved.replace(/[\\/]+$/, "") : resolved;
}

export function normalizeWorkspaceModelRules(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object") return {};
	const normalized: Record<string, string> = {};
	for (const [directory, modelSpec] of Object.entries(value as Record<string, unknown>)) {
		if (typeof modelSpec !== "string") continue;
		const normalizedDirectory = normalizeWorkspaceDirectory(directory);
		const normalizedModelSpec = modelSpec.trim();
		if (!normalizedDirectory || !normalizedModelSpec) continue;
		normalized[normalizedDirectory] = normalizedModelSpec;
	}
	return normalized;
}

export function listWorkspaceModelRules(workspaceModels: Record<string, string>): WorkspaceModelRule[] {
	return Object.entries(workspaceModels)
		.map(([directory, model]) => ({ directory, model }))
		.sort((a, b) => a.directory.localeCompare(b.directory));
}

export function formatWorkspaceModelRule(rule: WorkspaceModelRule): string {
	return `${rule.directory} => ${rule.model}`;
}

export function parseWorkspaceModelRuleEntry(text: string, baseDir?: string): WorkspaceModelRule | undefined {
	const separator = text.indexOf("=>");
	if (separator < 0) return undefined;
	const directory = normalizeWorkspaceDirectory(text.slice(0, separator), baseDir);
	const model = text.slice(separator + 2).trim();
	if (!directory || !model) return undefined;
	return { directory, model };
}

export function getWorkspaceAutoModelSpec(workspaceModels: Record<string, string>, cwd: string): string | undefined {
	const normalizedCwd = normalizeWorkspaceDirectory(cwd);
	return normalizedCwd ? workspaceModels[normalizedCwd] : undefined;
}

export async function captureGlobalSettingsSnapshot(path = GLOBAL_SETTINGS_PATH): Promise<GlobalSettingsSnapshot> {
	try {
		return { existed: true, text: await readFile(path, "utf8") };
	} catch {
		return { existed: false };
	}
}

export async function restoreGlobalSettingsSnapshot(snapshot: GlobalSettingsSnapshot, path = GLOBAL_SETTINGS_PATH): Promise<void> {
	if (!snapshot.existed) {
		await rm(path, { force: true });
		return;
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, snapshot.text ?? "", "utf8");
}

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

export async function loadGlobalDefaultModelReference(path = GLOBAL_SETTINGS_PATH): Promise<DefaultModelReference | undefined> {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
		const provider = typeof parsed.defaultProvider === "string" ? parsed.defaultProvider.trim() : "";
		const modelId = typeof parsed.defaultModel === "string" ? parsed.defaultModel.trim() : "";
		const rawThinkingLevel = typeof parsed.defaultThinkingLevel === "string" ? parsed.defaultThinkingLevel.trim() : "";
		const thinkingLevel = THINKING_LEVELS.has(rawThinkingLevel as ThinkingLevel) ? (rawThinkingLevel as ThinkingLevel) : undefined;
		return provider && modelId ? { provider, modelId, thinkingLevel } : undefined;
	} catch {
		return undefined;
	}
}

export function formatAutoModelNotice(model: { provider: string; modelId: string; thinkingLevel?: ThinkingLevel } | { provider: string; id: string }, thinkingLevel?: ThinkingLevel): string {
	const modelId = "modelId" in model ? model.modelId : model.id;
	const level = thinkingLevel ?? ("thinkingLevel" in model ? model.thinkingLevel : undefined);
	const suffix = level ? `:${level}` : "";
	return `AutoModel switched to ${model.provider}/${modelId}${suffix}`;
}
