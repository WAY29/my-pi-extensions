import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ProgressMode = "off" | "on";

const STATUS_KEY = "progress-checkpoints";

const CHECKPOINT_INSTRUCTIONS = `
Progress checkpoint policy:
- For multi-step or tool-heavy work, briefly explain the current work or public reasoning at natural boundaries in normal conversational language.
- Before the first tool call, if the next action is not obvious, briefly say what you are going to inspect, run, or change and why.
- After tool results, if more work is needed, briefly summarize what was learned and what you will do next before calling more tools.
- After a long-running or failed command returns, briefly summarize the observed result or failure before deciding the next tool call.
- Keep each checkpoint under 80 Chinese characters when possible.
- Base checkpoints on observable facts, tool results, and intended next actions; do not speculate.
- Skip checkpoints for trivial one-shot answers, purely conversational replies, or when the user asks for quiet/no progress updates.
- Never put checkpoint prose inside tool arguments.
`;

function parseMode(args: string): ProgressMode | "status" | undefined {
	const normalized = args.trim().toLowerCase();
	if (!normalized) return "status";
	if (["on", "enable", "enabled", "yes", "1"].includes(normalized)) return "on";
	if (["off", "disable", "disabled", "no", "0"].includes(normalized)) return "off";
	if (["status", "state", "show"].includes(normalized)) return "status";
	return undefined;
}

function statusText(ctx: ExtensionContext | ExtensionCommandContext, enabled: boolean): string {
	const label = enabled ? "progress:on" : "progress:off";
	return enabled ? ctx.ui.theme.fg("dim", label) : ctx.ui.theme.fg("muted", label);
}

function applyStatus(ctx: ExtensionContext | ExtensionCommandContext, enabled: boolean) {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, statusText(ctx, enabled));
}

export default function progressCheckpointsExtension(pi: ExtensionAPI) {
	let enabled = true;

	pi.on("session_start", async (_event, ctx) => {
		applyStatus(ctx, enabled);
	});

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${CHECKPOINT_INSTRUCTIONS.trim()}`,
		};
	});

	pi.registerCommand("progress-checkpoints", {
		description: "Toggle public progress checkpoint instructions for long/tool-heavy tasks",
		getArgumentCompletions: (prefix) => {
			const values = ["on", "off", "status"];
			const normalized = prefix.trim().toLowerCase();
			const matches = values.filter((value) => value.startsWith(normalized));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const mode = parseMode(args);
			if (!mode) {
				ctx.ui.notify("Usage: /progress-checkpoints [on|off|status]", "warning");
				return;
			}

			if (mode === "status") {
				applyStatus(ctx, enabled);
				ctx.ui.notify(`Progress checkpoints are ${enabled ? "on" : "off"}.`, "info");
				return;
			}

			enabled = mode === "on";
			applyStatus(ctx, enabled);
			ctx.ui.notify(`Progress checkpoints ${enabled ? "enabled" : "disabled"}.`, "info");
		},
	});

	pi.registerCommand("progress", {
		description: "Alias for /progress-checkpoints",
		getArgumentCompletions: (prefix) => {
			const values = ["on", "off", "status"];
			const normalized = prefix.trim().toLowerCase();
			const matches = values.filter((value) => value.startsWith(normalized));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const mode = parseMode(args);
			if (!mode) {
				ctx.ui.notify("Usage: /progress [on|off|status]", "warning");
				return;
			}

			if (mode === "status") {
				applyStatus(ctx, enabled);
				ctx.ui.notify(`Progress checkpoints are ${enabled ? "on" : "off"}.`, "info");
				return;
			}

			enabled = mode === "on";
			applyStatus(ctx, enabled);
			ctx.ui.notify(`Progress checkpoints ${enabled ? "enabled" : "disabled"}.`, "info");
		},
	});
}