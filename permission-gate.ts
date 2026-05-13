/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns checked: rm -rf, chmod/chown 777
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type MatchRange = { start: number; end: number };

const RED = "\x1b[31m";

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

function getDangerousMatches(command: string, patterns: RegExp[]): MatchRange[] {
	const ranges: MatchRange[] = [];

	for (const pattern of patterns) {
		const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}g`);
		let match: RegExpExecArray | null;

		while ((match = globalPattern.exec(command)) !== null) {
			if (match[0].length === 0) {
				globalPattern.lastIndex++;
				continue;
			}

			ranges.push({ start: match.index, end: match.index + match[0].length });
		}
	}

	return mergeRanges(ranges);
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
	const merged: MatchRange[] = [];

	for (const range of sorted) {
		const previous = merged[merged.length - 1];
		if (previous && range.start <= previous.end) {
			previous.end = Math.max(previous.end, range.end);
			continue;
		}

		merged.push({ ...range });
	}

	return merged;
}

function highlightRanges(command: string, ranges: MatchRange[], restoreColor: string): string {
	let highlighted = "";
	let lastIndex = 0;

	for (const { start, end } of ranges) {
		highlighted += command.slice(lastIndex, start);
		highlighted += `${RED}${command.slice(start, end)}${restoreColor}`;
		lastIndex = end;
	}

	return highlighted + command.slice(lastIndex);
}

async function selectWithStableScroll(
	ctx: ExtensionContext,
	title: string,
	options: string[],
): Promise<string | undefined> {
	// The working spinner redraws every ~80ms while a tool call is pending. For long
	// select titles, those redraws fight the terminal's normal scrollback wheel and
	// snap the viewport around. Pause it while the confirmation prompt is open.
	ctx.ui.setWorkingVisible(false);
	try {
		return await ctx.ui.select(title, options);
	} finally {
		ctx.ui.setWorkingVisible(true);
	}
}

export default function (pi: ExtensionAPI) {
	const dangerousPatterns = [/(?<!-)\brm\b/i, /\b(chmod|chown)\b.*777/i];
	let enabled = true;

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
		const dangerousMatches = getDangerousMatches(command, dangerousPatterns);

		if (dangerousMatches.length > 0) {
			if (!ctx.hasUI) {
				// In non-interactive mode, block by default
				return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
			}

			const highlightedCommand = highlightRanges(command, dangerousMatches, ctx.ui.theme.getFgAnsi("accent"));
			const choice = await selectWithStableScroll(ctx, `⚠️ Dangerous command:\n\n  ${highlightedCommand}\n\nAllow?`, ["Yes", "No"]);

			if (choice !== "Yes") {
				return { block: true, reason: "Blocked by user" };
			}
		}

		return undefined;
	});
}
