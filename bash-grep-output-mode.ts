import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition, createGrepToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Key } from "@earendil-works/pi-tui";

type OutputMode = "hidden" | "compact" | "full";

const STATUS_KEY = "bash-grep-output-mode";
const COMMAND = "bash-grep-output";
const SHORTCUTS = [
	Key.ctrlShift("o"),
	// Fallback: many terminals collapse Ctrl+Shift+O to Ctrl+O, so the shifted
	// shortcut never reaches pi distinctly unless Kitty/CSI-u keys are enabled.
	Key.alt("o"),
] as const;
let outputMode: OutputMode = "hidden";

function nextMode(mode: OutputMode): OutputMode {
	if (mode === "hidden") return "compact";
	if (mode === "compact") return "full";
	return "hidden";
}

function setStatus(ctx: { ui: { setStatus(key: string, text: string | undefined): void } }): void {
	ctx.ui.setStatus(STATUS_KEY, `bash/grep: ${outputMode}`);
}

function refreshToolRows(ctx: {
	ui: {
		getToolsExpanded(): boolean;
		setToolsExpanded(expanded: boolean): void;
	};
}): void {
	// Re-apply the existing global expansion state so pi asks existing tool rows to rebuild.
	// This extension's renderers read outputMode from closure and decide hidden/compact/full themselves.
	ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
}

function applyOutputMode(
	ctx: {
		ui: {
			setStatus(key: string, text: string | undefined): void;
			notify(message: string, type?: "info" | "warning" | "error"): void;
			getToolsExpanded(): boolean;
			setToolsExpanded(expanded: boolean): void;
		};
	},
	mode: OutputMode,
): void {
	const previousMode = outputMode;
	outputMode = mode;
	setStatus(ctx);
	refreshToolRows(ctx);
	ctx.ui.notify(`bash/grep output: ${previousMode} → ${outputMode}`, "info");
}

function parseMode(value: string): OutputMode | undefined {
	const normalized = value.trim().toLowerCase();
	if (normalized === "hidden" || normalized === "compact" || normalized === "full") return normalized;
	return undefined;
}

export default function (pi: ExtensionAPI) {
	for (const shortcut of SHORTCUTS) {
		pi.registerShortcut(shortcut, {
			description: "Cycle bash/grep output: hidden → compact → full",
			handler(ctx) {
				applyOutputMode(ctx, nextMode(outputMode));
			},
		});
	}

	pi.registerCommand(COMMAND, {
		description: "Cycle or set bash/grep output mode: hidden, compact, full",
		handler(args, ctx) {
			const requestedMode = args.trim() ? parseMode(args) : nextMode(outputMode);
			if (!requestedMode) {
				ctx.ui.notify(`Usage: /${COMMAND} [hidden|compact|full]`, "warning");
				return;
			}

			applyOutputMode(ctx, requestedMode);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		setStatus(ctx);

		const bash = createBashToolDefinition(ctx.cwd);
		const grep = createGrepToolDefinition(ctx.cwd);

		pi.registerTool({
			...bash,
			renderResult(result, options, theme, context) {
				if (!bash.renderResult) return new Container();

				if (outputMode === "hidden") {
					return bash.renderResult(
						{ ...result, content: [] },
						{ ...options, expanded: false },
						theme,
						context,
					);
				}

				return bash.renderResult(
					result,
					{ ...options, expanded: outputMode === "full" },
					theme,
					context,
				);
			},
		});

		pi.registerTool({
			...grep,
			renderResult(result, options, theme, context) {
				if (outputMode === "hidden") {
					return new Container();
				}

				return grep.renderResult?.(
					result,
					{ ...options, expanded: outputMode === "full" },
					theme,
					context,
				) ?? new Container();
			},
		});
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
