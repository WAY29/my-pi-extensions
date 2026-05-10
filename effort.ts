import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type EffortAction = ThinkingLevel | "next" | "prev" | "status";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

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

function isThinkingLevel(value: string): value is ThinkingLevel {
	return (LEVELS as readonly string[]).includes(value);
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

function usage(): string {
	return "Usage: /effort [off|minimal|low|medium|high|xhigh|next|prev|status]";
}

function setLevel(pi: ExtensionAPI, ctx: ExtensionCommandContext, requested: ThinkingLevel) {
	const before = pi.getThinkingLevel();
	pi.setThinkingLevel(requested);
	const after = pi.getThinkingLevel();

	if (after !== requested) {
		notify(ctx, `Thinking level requested: ${requested}; effective: ${after} (clamped by current model).`, "warning");
		return;
	}

	if (before === after) {
		notify(ctx, `Thinking level already ${after}.`, "info");
		return;
	}

	notify(ctx, `Thinking level: ${before} → ${after}.`, "info");
}

async function selectLevel(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	const current = pi.getThinkingLevel();
	const options = LEVELS.map((level) => (level === current ? `${level} (current)` : level));
	const selected = await ctx.ui.select("Thinking level", options);
	if (!selected) return;

	const level = selected.split(" ", 1)[0];
	if (!isThinkingLevel(level)) return;
	setLevel(pi, ctx, level);
}

export default function effortExtension(pi: ExtensionAPI) {
	pi.registerCommand("effort", {
		description: "Switch thinking level",
		getArgumentCompletions: (prefix) => {
			const normalized = prefix.trim().toLowerCase();
			const values = [...LEVELS, "next", "prev", "status"];
			const matches = values.filter((value) => value.startsWith(normalized));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			if (!trimmed) {
				await selectLevel(pi, ctx);
				return;
			}

			const parts = trimmed.split(/\s+/);
			if (parts.length !== 1) {
				notify(ctx, usage(), "warning");
				return;
			}

			const action = parseAction(parts[0]!);
			if (!action) {
				notify(ctx, `Unknown effort "${parts[0]}". ${usage()}`, "warning");
				return;
			}

			if (action === "status") {
				notify(ctx, `Thinking level: ${pi.getThinkingLevel()}.`, "info");
				return;
			}

			if (action === "next") {
				setLevel(pi, ctx, adjacentLevel(pi.getThinkingLevel(), 1));
				return;
			}

			if (action === "prev") {
				setLevel(pi, ctx, adjacentLevel(pi.getThinkingLevel(), -1));
				return;
			}

			setLevel(pi, ctx, action);
		},
	});
}