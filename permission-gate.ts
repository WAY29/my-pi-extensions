/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns checked: rm -rf, chmod/chown 777
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureBashToolRegistered, registerBashToolPlugin, releaseBashToolOwner } from "./bash-tool-coordinator";
import { withNotifyHookAttention } from "./notify-hook/attention";

type PermissionGateStateRequest = {
	respond?: (response: PermissionGateStateResponse | Promise<PermissionGateStateResponse>) => void;
};

type PermissionGateSetRequest = {
	enabled?: boolean;
	respond?: (response: PermissionGateSetResponse | Promise<PermissionGateSetResponse>) => void;
};

type PermissionGateStateResponse = {
	available: true;
	enabled: boolean;
};

type PermissionGateSetResponse = {
	accepted: boolean;
	enabled: boolean;
	reason?: string;
};

async function selectWithStableScroll(
	ctx: ExtensionContext,
	title: string,
	options: string[],
): Promise<string | undefined> {
	// Pause spinner redraws so the user can scroll the command preview.
	ctx.ui.setWorkingVisible(false);
	try {
		return await ctx.ui.select(title, options);
	} finally {
		ctx.ui.setWorkingVisible(true);
	}
}

export default function (pi: ExtensionAPI) {
	const dangerousPattern = /(?<!-)\brm\b|\b(?:chmod|chown)\b.*777/gi;
	let enabled = true;

	registerBashToolPlugin(pi, {
		id: "permission-gate",
		wrapRenderCall: (next) => (args, theme, context) => {
			if (!enabled || typeof args.command !== "string") return next(args, theme, context);
			const command = args.command.replace(dangerousPattern, (match) =>
				`${theme.fg("error", match)}${theme.getFgAnsi("toolTitle")}`,
			);
			return next({ ...args, command }, theme, context);
		},
	});
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") ensureBashToolRegistered(pi, ctx.cwd);
	});
	pi.on("session_shutdown", () => releaseBashToolOwner(pi));

	pi.events.on("permission-gate:request-state", (data: unknown) => {
		const request = data && typeof data === "object" ? (data as PermissionGateStateRequest) : {};
		request.respond?.({ available: true, enabled });
	});

	pi.events.on("permission-gate:set-enabled", (data: unknown) => {
		const request = data && typeof data === "object" ? (data as PermissionGateSetRequest) : {};
		if (typeof request.enabled !== "boolean") {
			request.respond?.({ accepted: false, enabled, reason: "Missing boolean enabled value" });
			return;
		}

		enabled = request.enabled;
		request.respond?.({ accepted: true, enabled });
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!enabled) return undefined;
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		if (command.search(dangerousPattern) !== -1) {
			if (!ctx.hasUI) {
				// In non-interactive mode, block by default
				return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
			}

			// The TUI already renders the full tool call above the editor.
			const title = ctx.mode === "tui" ? "Run the dangerous command above?" : `⚠️ Dangerous command:\n\n${command}\n\nAllow?`;
			const choice = await withNotifyHookAttention(
				pi,
				"permission-gate",
				() => selectWithStableScroll(ctx, title, ["Yes", "No"]),
				undefined,
				"permission",
			);

			if (choice !== "Yes") {
				return { block: true, reason: "Blocked by user" };
			}
		}

		return undefined;
	});
}
