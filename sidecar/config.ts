import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { SidecarDefinition, SidecarGlobalConfig, SidecarMode } from "./types.js";

export const USER_SIDECARS_DIR = join(homedir(), ".pi", "agent", "sidecars");
export const GLOBAL_CONFIG_PATH = join(USER_SIDECARS_DIR, "config.json");
export const PROJECT_SIDECARS_DIR = join(".pi", "sidecars");

const DEFAULT_GLOBAL: SidecarGlobalConfig = {
	mode: "herdr",
	read_lines: 200,
	prompt_timeout_ms: 600_000,
};

/**
 * Appended every round. Must NOT teach the model to always emit the keyword at end-of-reply.
 * Keyword = multi-round protocol done (no follow-up round), not "I finished this message".
 */
const DEFAULT_STOP_INSTRUCTION = [
	"Multi-round stop protocol:",
	`- Output a final line that is exactly {{stop_keyword}} ONLY when no follow-up round is needed (task criteria fully satisfied; nothing left for the caller to fix/re-check).`,
	`- If you reported remaining work, findings, issues, or next steps — do NOT output {{stop_keyword}}.`,
	`- Finishing this reply is not enough; {{stop_keyword}} means the whole multi-round task is done.`,
].join("\n");

export function loadGlobalConfig(): SidecarGlobalConfig {
	try {
		if (!existsSync(GLOBAL_CONFIG_PATH)) return { ...DEFAULT_GLOBAL };
		const raw = JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, "utf8")) as Partial<SidecarGlobalConfig>;
		return {
			mode: raw.mode === "inner" ? "inner" : "herdr",
			read_lines: typeof raw.read_lines === "number" && raw.read_lines > 0 ? raw.read_lines : DEFAULT_GLOBAL.read_lines,
			prompt_timeout_ms:
				typeof raw.prompt_timeout_ms === "number" && raw.prompt_timeout_ms > 0
					? raw.prompt_timeout_ms
					: DEFAULT_GLOBAL.prompt_timeout_ms,
		};
	} catch {
		return { ...DEFAULT_GLOBAL };
	}
}

export function saveGlobalConfig(patch: Partial<SidecarGlobalConfig>): SidecarGlobalConfig {
	const next = { ...loadGlobalConfig(), ...patch };
	mkdirSync(USER_SIDECARS_DIR, { recursive: true });
	writeFileSync(GLOBAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}

export function setGlobalMode(mode: SidecarMode): SidecarGlobalConfig {
	return saveGlobalConfig({ mode });
}

function parseDefinition(path: string, source: "user" | "project"): SidecarDefinition | null {
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SidecarDefinition>;
		if (typeof raw.name !== "string" || !raw.name.trim()) return null;
		if (typeof raw.prompt !== "string" || !raw.prompt.trim()) return null;
		if (typeof raw.stop_keyword !== "string" || !raw.stop_keyword.trim()) return null;
		if (typeof raw.blocking !== "boolean") return null;
		return {
			...raw,
			name: raw.name.trim(),
			prompt: raw.prompt,
			stop_keyword: raw.stop_keyword.trim(),
			blocking: raw.blocking,
			source,
			path,
		} as SidecarDefinition;
	} catch {
		return null;
	}
}

function loadDir(dir: string, source: "user" | "project"): Map<string, SidecarDefinition> {
	const out = new Map<string, SidecarDefinition>();
	if (!existsSync(dir)) return out;
	for (const ent of readdirSync(dir, { withFileTypes: true })) {
		if (!ent.isFile()) continue;
		if (!ent.name.endsWith(".sidecar") && !ent.name.endsWith(".json")) continue;
		if (ent.name === "config.json") continue;
		const def = parseDefinition(join(dir, ent.name), source);
		if (def) out.set(def.name, def);
	}
	return out;
}

/** Project overrides user on same name. */
export function discoverSidecars(cwd: string): SidecarDefinition[] {
	const user = loadDir(USER_SIDECARS_DIR, "user");
	const project = loadDir(resolve(cwd, PROJECT_SIDECARS_DIR), "project");
	const merged = new Map(user);
	for (const [name, def] of project) merged.set(name, def);
	return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findSidecar(cwd: string, name: string): SidecarDefinition | undefined {
	return discoverSidecars(cwd).find((d) => d.name === name);
}

export function buildStopSuffix(def: SidecarDefinition): string {
	const template = (def.stop_instruction?.trim() || DEFAULT_STOP_INSTRUCTION).replaceAll(
		"{{stop_keyword}}",
		def.stop_keyword,
	);
	return template;
}

export function buildRoundPrompt(base: string, def: SidecarDefinition, extra?: string): string {
	const parts = [base.trim()];
	if (extra?.trim()) parts.push(extra.trim());
	parts.push(buildStopSuffix(def));
	return parts.filter(Boolean).join("\n\n");
}

export function containsStopKeyword(output: string, keyword: string): boolean {
	// Whole-line match only (not a mid-sentence substring).
	const lines = output.split(/\r?\n/).map((l) => l.trim());
	return lines.some((l) => l === keyword);
}

/** herdr agent names: [a-z][a-z0-9_-]{0,31} */
export function slugAgentName(preferred: string | undefined, sidecarName: string): string {
	const raw = (preferred?.trim() || `sidecar-${sidecarName}`).toLowerCase();
	let slug = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	if (!/^[a-z]/.test(slug)) slug = `s${slug}`;
	slug = slug.slice(0, 32);
	if (!slug || !/^[a-z][a-z0-9_-]{0,31}$/.test(slug)) {
		slug = `sidecar-${sidecarName.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 20) || "x"}`;
	}
	return slug;
}

export function resolvePackageRoot(nameOrPath: string): string | undefined {
	if (nameOrPath.includes("/") || nameOrPath.startsWith(".")) {
		const abs = resolve(nameOrPath);
		return existsSync(abs) ? abs : undefined;
	}
	const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
	let packages: string[] = [];
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
		packages = settings.packages ?? [];
	} catch {
		packages = [];
	}
	const agentHome = join(homedir(), ".pi", "agent");
	for (const spec of packages) {
		const root = packageSpecToPath(agentHome, spec);
		if (!root || !existsSync(root)) continue;
		try {
			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
				name?: string;
			};
			const base = basename(root);
			if (pkg.name === nameOrPath || pkg.name?.endsWith(`/${nameOrPath}`) || base === nameOrPath) {
				return root;
			}
		} catch {
			// continue
		}
	}
	const npmPath = join(agentHome, "npm", "node_modules", nameOrPath);
	if (existsSync(npmPath)) return npmPath;
	return undefined;
}

function packageSpecToPath(agentHome: string, spec: string): string | undefined {
	if (spec.startsWith("git:")) {
		// git:github.com/org/repo or git:github.com/org/repo@ref
		const rest = spec.slice(4).replace(/@[^/]+$/, "");
		return join(agentHome, "git", ...rest.split("/"));
	}
	if (spec.startsWith("npm:")) {
		const bare = spec.slice(4);
		const m = bare.match(/^(@[^/]+\/[^@]+|[^@]+)(?:@.+)?$/);
		if (!m) return undefined;
		return join(agentHome, "npm", "node_modules", ...m[1].split("/"));
	}
	return undefined;
}

export function resolveExtensionPaths(entries: string[] | undefined): string[] {
	if (!entries?.length) return [];
	const out: string[] = [];
	for (const entry of entries) {
		if (entry.endsWith(".ts") || entry.endsWith(".js") || entry.endsWith(".mjs")) {
			const abs = resolve(entry);
			if (existsSync(abs)) out.push(abs);
			continue;
		}
		const root = resolvePackageRoot(entry);
		if (!root) continue;
		try {
			const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
				pi?: { extensions?: string[] };
			};
			const list = pkg.pi?.extensions ?? [];
			for (const rel of list) {
				const abs = resolve(root, rel);
				if (existsSync(abs)) out.push(abs);
			}
		} catch {
			// skip
		}
	}
	return out;
}

export function resolveSkillPaths(entries: string[] | undefined): string[] {
	if (!entries?.length) return [];
	const out: string[] = [];
	const agentHome = join(homedir(), ".pi", "agent");
	const agentSkills = join(agentHome, "skills");

	let packageRoots: string[] = [];
	try {
		const settings = JSON.parse(readFileSync(join(agentHome, "settings.json"), "utf8")) as {
			packages?: string[];
		};
		packageRoots = (settings.packages ?? [])
			.map((spec) => packageSpecToPath(agentHome, spec))
			.filter((p): p is string => !!p && existsSync(p));
	} catch {
		packageRoots = [];
	}

	for (const entry of entries) {
		if (entry.includes("/") || entry.startsWith(".")) {
			const abs = resolve(entry);
			if (existsSync(abs)) out.push(abs);
			continue;
		}

		const localDir = join(agentSkills, entry);
		if (existsSync(join(localDir, "SKILL.md")) || existsSync(localDir)) {
			out.push(localDir);
			continue;
		}

		for (const root of packageRoots) {
			const skillDir = join(root, "skills", entry);
			if (existsSync(join(skillDir, "SKILL.md")) || existsSync(skillDir)) {
				out.push(skillDir);
				break;
			}
		}
	}
	return [...new Set(out)];
}

// minimal self-check
export function _selfCheck(): void {
	const def: SidecarDefinition = {
		name: "demo",
		blocking: true,
		prompt: "review please",
		stop_keyword: "SIDECAR_DONE",
	};
	const prompt = buildRoundPrompt(def.prompt, def, "focus on auth");
	if (!prompt.includes("SIDECAR_DONE")) throw new Error("stop suffix missing");
	if (!containsStopKeyword("all good\nSIDECAR_DONE\n", "SIDECAR_DONE")) throw new Error("keyword detect failed");
	if (slugAgentName("Review Bot!", "x") !== "review-bot") {
		// Review Bot! -> review-bot
		const s = slugAgentName("Review Bot!", "x");
		if (!/^[a-z][a-z0-9_-]{0,31}$/.test(s)) throw new Error(`bad slug ${s}`);
	}
}
