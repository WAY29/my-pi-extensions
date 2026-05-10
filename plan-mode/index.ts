/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, pi-sandbox is used for read-only enforcement if available.
 * Without pi-sandbox, falls back to a small read-only tool allowlist.
 *
 * Features:
 * - /plan command or Shift+Tab to toggle
 * - Sandbox read-only lock when pi-sandbox is available
 * - Bash restricted to allowlisted read-only commands only in fallback mode
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

// Fallback tools used only when pi-sandbox cannot provide a read-only write lock.
const FALLBACK_PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "AskUserQuestion"];

interface SandboxReadOnlyLockResponse {
	accepted: boolean;
	active: boolean;
	reason?: string;
}

interface SandboxReadOnlyLockRequest {
	owner: string;
	enabled: boolean;
	reason: string;
	cwd: string;
	respond?: (response: SandboxReadOnlyLockResponse | Promise<SandboxReadOnlyLockResponse>) => void;
}

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let previousActiveTools: string[] | null = null;
	let usingSandboxReadOnly = false;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function emitState(): void {
		pi.events.emit("plan-mode:state", {
			enabled: planModeEnabled,
			executing: executionMode,
			completed: todoItems.filter((t) => t.completed).length,
			total: todoItems.length,
		});
	}

	pi.events.on("plan-mode:request-state", () => emitState());

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}

		emitState();
	}

	async function requestSandboxReadOnlyLock(enabled: boolean, ctx: ExtensionContext): Promise<boolean> {
		const responses: Array<Promise<SandboxReadOnlyLockResponse>> = [];
		const request: SandboxReadOnlyLockRequest = {
			owner: "plan-mode",
			enabled,
			reason: enabled ? "Plan mode active" : "Plan mode inactive",
			cwd: ctx.cwd,
			respond(response) {
				responses.push(Promise.resolve(response));
			},
		};

		pi.events.emit("pi-sandbox:set-read-only-lock", request);
		if (responses.length === 0) return false;

		const settled = await Promise.allSettled(responses);
		return settled.some(
			(result) => result.status === "fulfilled" && result.value.accepted && result.value.active === enabled,
		);
	}

	async function applyPlanModeRestrictions(ctx: ExtensionContext): Promise<void> {
		usingSandboxReadOnly = await requestSandboxReadOnlyLock(true, ctx);
		if (usingSandboxReadOnly) {
			restoreActiveTools();
			return;
		}

		previousActiveTools ??= [...pi.getActiveTools()];
		pi.setActiveTools(FALLBACK_PLAN_MODE_TOOLS);
	}

	async function releasePlanModeRestrictions(ctx: ExtensionContext): Promise<void> {
		if (usingSandboxReadOnly) {
			await requestSandboxReadOnlyLock(false, ctx);
			usingSandboxReadOnly = false;
		}
		restoreActiveTools();
	}

	async function togglePlanMode(ctx: ExtensionContext): Promise<void> {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];

		if (planModeEnabled) {
			await applyPlanModeRestrictions(ctx);
			if (usingSandboxReadOnly) {
				ctx.ui.notify("Plan mode enabled. Sandbox read-only lock active; all current tools remain available.");
			} else {
				ctx.ui.notify(
					`Plan mode enabled. Sandbox read-only lock unavailable; fallback tools: ${FALLBACK_PLAN_MODE_TOOLS.join(", ")}`,
				);
			}
		} else {
			await releasePlanModeRestrictions(ctx);
			ctx.ui.notify("Plan mode disabled. Read-only restrictions removed.");
		}
		updateStatus(ctx);
		persistState();
	}

	function restoreActiveTools(): void {
		if (previousActiveTools !== null) {
			pi.setActiveTools(previousActiveTools);
			previousActiveTools = null;
		}
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			previousActiveTools,
			usingSandboxReadOnly,
		});
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => {
			await togglePlanMode(ctx);
		},
	});

	pi.registerCommand("plan-todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.shift("tab"), {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			await togglePlanMode(ctx);
		},
	});

	// In fallback mode, block destructive bash commands because no OS sandbox is enforcing read-only writes.
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || usingSandboxReadOnly || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			const restrictions = usingSandboxReadOnly
				? `- pi-sandbox read-only lock is active; all current tools remain available for investigation.
- File modifications are disabled by sandbox policy. Do not attempt any file writes.`
				: `- You can only use: ${FALLBACK_PLAN_MODE_TOOLS.join(", ")}
- You CANNOT use file modification tools
- Bash is restricted to an allowlist of read-only commands`;

			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
${restrictions}

Ask clarifying questions using the AskUserQuestion tool.
Use brave-search skill via bash for web research.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Plan-mode read-only restrictions lifted]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				await releasePlanModeRestrictions(ctx);
				updateStatus(ctx);
				persistState(); // Save cleared state so resume doesn't restore old execution mode
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		// Show plan steps and prompt for next action
		if (todoItems.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-todo-list",
					content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}
		persistState();

		const choice = await ctx.ui.select("Plan mode - what next?", [
			todoItems.length > 0 ? "Execute the plan (track progress)" : "Execute the plan",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			planModeEnabled = false;
			executionMode = todoItems.length > 0;
			await releasePlanModeRestrictions(ctx);
			updateStatus(ctx);
			persistState();

			const execMessage =
				todoItems.length > 0
					? `Execute the plan. Start with: ${todoItems[0].text}`
					: "Execute the plan you just created.";
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendUserMessage(refinement.trim());
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean; previousActiveTools?: string[] | null; usingSandboxReadOnly?: boolean } } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			previousActiveTools = planModeEntry.data.previousActiveTools ?? previousActiveTools;
			usingSandboxReadOnly = false;
		}

		// On resume: re-scan messages to rebuild completion state
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			// Find the index of the last plan-mode-execute entry (marks when current execution started)
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			// Only scan messages after the execute marker
			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			await applyPlanModeRestrictions(ctx);
		}
		updateStatus(ctx);
	});
}
