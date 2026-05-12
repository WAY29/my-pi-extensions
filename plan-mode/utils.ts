/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

export const MIN_TODO_ITEMS = 1;
export const MAX_TODO_ITEMS = 10;
export const VISIBLE_TODO_ITEMS = 3;

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

export interface TodoWindow {
	items: TodoItem[];
	start: number;
	end: number;
	total: number;
}

export function getVisibleTodoWindow(items: TodoItem[], limit = VISIBLE_TODO_ITEMS): TodoWindow {
	const total = items.length;
	if (total === 0 || limit <= 0) return { items: [], start: 0, end: 0, total };

	const maxStart = Math.max(0, total - limit);
	const firstIncompleteIndex = items.findIndex((item) => !item.completed);
	const start =
		firstIncompleteIndex === -1 ? maxStart : Math.min(maxStart, Math.max(0, firstIncompleteIndex - 1));
	const end = Math.min(total, start + limit);
	return { items: items.slice(start, end), start, end, total };
}

export function splitTodoText(text: string): string[] {
	const lines = text.split(/\r?\n/);
	return lines.length > 0 ? lines : [""];
}

export function formatPlainTodoItem(item: TodoItem, marker: string): string {
	const [firstLine = "", ...rest] = splitTodoText(item.text);
	const markerText = marker ? `${marker} ` : "";
	const continuation = rest.map((line) => `   ${line}`);
	return [`${item.step}. ${markerText}${firstLine}`, ...continuation].join("\n");
}

export function formatPlanList(items: TodoItem[]): string {
	return items.map((item) => formatPlainTodoItem(item, "")).join("\n");
}

export function buildPlanExecutionMessage(items: TodoItem[], clearContext: boolean): string {
	if (items.length === 0) return "Execute the plan you just created from start to finish.";

	const first = (items.find((item) => !item.completed) ?? items[0])!;
	const baseInstruction = `Execute the entire plan from start to finish. Begin with step ${first.step}: ${first.text}. After completing each step, mark it done and continue to the next step until the full plan is complete.`;
	const progressInstruction = `\n\nProgress tracking:\n- As soon as step n is complete, call plan_complete_step with that step number.\n- Do not print raw progress markers in user-facing text; the tool updates progress.\n- After marking a step complete, immediately continue with the next remaining step.\n- Only provide a final summary after all plan steps are complete.`;
	const executionInstruction = `${baseInstruction}${progressInstruction}`;

	if (!clearContext) return executionInstruction;

	return `A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.\n\nPlan:\n${formatPlanList(items)}\n\n${executionInstruction}`;
}

export function cleanStepText(text: string): string {
	const cleanedLines = text
		.split(/\r?\n/)
		.map((line) =>
			line
				.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
				.replace(/`([^`]+)`/g, "$1") // Remove code
				.replace(
					/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
					"",
				)
				.replace(/[ \t]+/g, " ")
				.trim(),
		)
		.filter((line) => line.length > 0);

	let cleaned = cleanedLines.join("\n").trim();
	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	let currentLines: string[] = [];

	function flushCurrent(): void {
		if (items.length >= MAX_TODO_ITEMS || currentLines.length === 0) {
			currentLines = [];
			return;
		}

		const text = currentLines
			.join("\n")
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		currentLines = [];

		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}

	for (const line of planSection.split(/\r?\n/)) {
		if (items.length >= MAX_TODO_ITEMS) break;

		const numbered = line.match(/^\s*(\d+)[.)]\s+\*{0,2}(.+)$/);
		if (numbered) {
			flushCurrent();
			currentLines = [numbered[2].trim()];
			continue;
		}

		if (currentLines.length === 0) continue;
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			flushCurrent();
			continue;
		}

		currentLines.push(trimmed);
	}

	flushCurrent();
	return items;
}

export function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE\s*(?:[:：]|\s)\s*([0-9][0-9\s,，]*)\]/gi)) {
		const numbers = match[1].match(/\d+/g) ?? [];
		for (const numberText of numbers) {
			const step = Number(numberText);
			if (Number.isInteger(step) && step > 0) steps.push(step);
		}
	}
	return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	let newlyCompleted = 0;
	const seenSteps = new Set<number>();
	for (const step of extractDoneSteps(text)) {
		if (seenSteps.has(step)) continue;
		seenSteps.add(step);

		const item = items.find((t) => t.step === step);
		if (item && !item.completed) {
			item.completed = true;
			newlyCompleted += 1;
		}
	}
	return newlyCompleted;
}
