import { existsSync, readFileSync } from "node:fs";
import type { GlancePalette, GlanceThemeName, HostThemeRef, IconMode, IconSet, Rgb, SegmentId } from "./types.js";

export const FIXED_THEMES = ["light", "dark", "catppuccin-latte", "catppuccin-mocha"] as const satisfies readonly Exclude<GlanceThemeName, "follow">[];

export const PALETTES: Record<Exclude<GlanceThemeName, "follow">, GlancePalette> = {
	light: {
		name: "light",
		text: { r: 15, g: 23, b: 42 },
		dim: { r: 148, g: 163, b: 184 },
		warn: { r: 217, g: 119, b: 6 },
		error: { r: 225, g: 29, b: 72 },
		separator: { r: 148, g: 163, b: 184 },
		border: { r: 72, g: 94, b: 84 },
		title: { r: 47, g: 104, b: 74 },
		segments: {
			git: { fg: { r: 35, g: 118, b: 85 } },
			plan: { fg: { r: 217, g: 119, b: 6 } },
			sandbox: { fg: { r: 217, g: 119, b: 6 } },
			model: { fg: { r: 15, g: 23, b: 42 } },
			context: { fg: { r: 5, g: 150, b: 105 } },
			tokens: { fg: { r: 100, g: 116, b: 139 } },
			cost: { fg: { r: 154, g: 104, b: 20 } },
		},
	},
	dark: {
		name: "dark",
		text: { r: 229, g: 231, b: 235 },
		dim: { r: 107, g: 114, b: 128 },
		warn: { r: 251, g: 191, b: 36 },
		error: { r: 251, g: 113, b: 133 },
		separator: { r: 75, g: 85, b: 99 },
		border: { r: 104, g: 132, b: 119 },
		title: { r: 104, g: 152, b: 129 },
		segments: {
			git: { fg: { r: 94, g: 188, b: 145 } },
			plan: { fg: { r: 251, g: 191, b: 36 } },
			sandbox: { fg: { r: 251, g: 191, b: 36 } },
			model: { fg: { r: 229, g: 231, b: 235 } },
			context: { fg: { r: 52, g: 211, b: 153 } },
			tokens: { fg: { r: 156, g: 163, b: 175 } },
			cost: { fg: { r: 251, g: 191, b: 36 } },
		},
	},
	"catppuccin-latte": {
		name: "catppuccin-latte",
		text: { r: 76, g: 79, b: 105 },
		dim: { r: 156, g: 160, b: 176 },
		warn: { r: 223, g: 142, b: 29 },
		error: { r: 210, g: 15, b: 57 },
		separator: { r: 156, g: 160, b: 176 },
		border: { r: 204, g: 208, b: 218 },
		title: { r: 30, g: 102, b: 245 },
		segments: {
			git: { fg: { r: 64, g: 160, b: 43 } },
			plan: { fg: { r: 223, g: 142, b: 29 } },
			sandbox: { fg: { r: 223, g: 142, b: 29 } },
			model: { fg: { r: 114, g: 135, b: 253 } },
			context: { fg: { r: 23, g: 146, b: 153 } },
			tokens: { fg: { r: 140, g: 143, b: 161 } },
			cost: { fg: { r: 254, g: 100, b: 11 } },
		},
	},
	"catppuccin-mocha": {
		name: "catppuccin-mocha",
		text: { r: 205, g: 214, b: 244 },
		dim: { r: 108, g: 112, b: 134 },
		warn: { r: 249, g: 226, b: 175 },
		error: { r: 243, g: 139, b: 168 },
		separator: { r: 108, g: 112, b: 134 },
		border: { r: 49, g: 50, b: 68 },
		title: { r: 137, g: 180, b: 250 },
		segments: {
			git: { fg: { r: 166, g: 227, b: 161 } },
			plan: { fg: { r: 249, g: 226, b: 175 } },
			sandbox: { fg: { r: 249, g: 226, b: 175 } },
			model: { fg: { r: 180, g: 190, b: 254 } },
			context: { fg: { r: 148, g: 226, b: 213 } },
			tokens: { fg: { r: 127, g: 132, b: 156 } },
			cost: { fg: { r: 250, g: 179, b: 135 } },
		},
	},
};

export const ICONS: Record<IconMode, IconSet> = {
	nerd: {
		git: "",
		plan: "󰈙",
		sandbox: "",
		model: "󰚩",
		context: "󰔟",
		tokens: "󰄨",
		cost: "󰈸",
	},
	plain: {
		git: "git",
		plan: "plan",
		sandbox: "sbx",
		model: "ai",
		context: "ctx",
		tokens: "tok",
		cost: "$",
	},
};

function rgbToFg(color: Rgb): string {
	return `\x1b[38;2;${color.r};${color.g};${color.b}m`;
}

export function fg(color: Rgb, text: string): string {
	return `${rgbToFg(color)}${text}\x1b[39m`;
}

function hexToRgb(hex: string): Rgb | undefined {
	const cleaned = hex.trim().replace(/^#/, "");
	if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return undefined;
	return {
		r: Number.parseInt(cleaned.slice(0, 2), 16),
		g: Number.parseInt(cleaned.slice(2, 4), 16),
		b: Number.parseInt(cleaned.slice(4, 6), 16),
	};
}

function resolveThemeVar(value: unknown, vars: Record<string, unknown>, seen = new Set<string>()): string | undefined {
	if (typeof value === "number") return undefined;
	if (typeof value !== "string") return undefined;
	if (value === "") return undefined;
	if (value.startsWith("#")) return value;
	if (seen.has(value)) return undefined;
	seen.add(value);
	if (!(value in vars)) return undefined;
	return resolveThemeVar(vars[value], vars, seen);
}

/** Load resolved hex colors from a pi theme JSON path. */
export function loadHostThemeColors(themePath: string | undefined): Record<string, string> | undefined {
	if (!themePath || !existsSync(themePath)) return undefined;
	try {
		const json = JSON.parse(readFileSync(themePath, "utf8")) as {
			vars?: Record<string, unknown>;
			colors?: Record<string, unknown>;
		};
		const vars = json.vars ?? {};
		const colors = json.colors ?? {};
		const resolved: Record<string, string> = {};
		for (const [key, value] of Object.entries(colors)) {
			const hex = resolveThemeVar(value, vars);
			if (hex) resolved[key] = hex;
		}
		return Object.keys(resolved).length > 0 ? resolved : undefined;
	} catch {
		return undefined;
	}
}

function pickRgb(colors: Record<string, string>, keys: string[], fallback: Rgb): Rgb {
	for (const key of keys) {
		const hex = colors[key];
		if (!hex) continue;
		const rgb = hexToRgb(hex);
		if (rgb) return rgb;
	}
	return fallback;
}

function segment(fg: Rgb): { fg: Rgb } {
	return { fg };
}

/** Build a glance palette from host theme color tokens. */
export function paletteFromHostColors(hostName: string, colors: Record<string, string>): GlancePalette {
	const fallback = PALETTES.dark;
	const text = pickRgb(colors, ["text", "userMessageText"], fallback.text);
	const dim = pickRgb(colors, ["dim", "muted"], fallback.dim);
	const warn = pickRgb(colors, ["warning"], fallback.warn);
	const error = pickRgb(colors, ["error"], fallback.error);
	const border = pickRgb(colors, ["border", "borderMuted", "borderAccent"], fallback.border);
	const title = pickRgb(colors, ["accent", "borderAccent"], fallback.title);
	const success = pickRgb(colors, ["success", "syntaxString"], fallback.segments.git.fg);
	const model = pickRgb(colors, ["accent", "toolTitle", "syntaxFunction"], fallback.segments.model.fg);
	const context = pickRgb(colors, ["success", "syntaxType", "accent"], fallback.segments.context.fg);
	const tokens = pickRgb(colors, ["muted", "dim", "toolOutput"], fallback.segments.tokens.fg);
	const cost = pickRgb(colors, ["warning", "syntaxNumber"], fallback.segments.cost.fg);

	const segments: Record<SegmentId, { fg: Rgb }> = {
		git: segment(success),
		plan: segment(warn),
		sandbox: segment(warn),
		model: segment(model),
		context: segment(context),
		tokens: segment(tokens),
		cost: segment(cost),
	};

	return {
		name: hostName || "follow",
		text,
		dim,
		warn,
		error,
		separator: dim,
		border,
		title,
		segments,
	};
}

/** Resolve glance palette: fixed id or host-follow. */
export function resolvePalette(theme: GlanceThemeName, host: HostThemeRef | null | undefined): GlancePalette {
	if (theme !== "follow") {
		return PALETTES[theme] ?? PALETTES.dark;
	}
	const colors = loadHostThemeColors(host?.path);
	if (!colors) return PALETTES.dark;
	return paletteFromHostColors(host?.name ?? "follow", colors);
}
