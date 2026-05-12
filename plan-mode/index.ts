/**
 * Plan Mode Extension
 *
 * Exploration mode for safe code analysis.
 * When enabled, pi-sandbox is used to block writes under the current cwd if available.
 * Without pi-sandbox, falls back to a small read-only tool allowlist.
 *
 * Features:
 * - /plan command or Shift+Tab to toggle
 * - Sandbox cwd write lock when pi-sandbox is available
 * - Bash restricted to allowlisted read-only commands only in fallback mode
 * - Extracts 1-10 numbered plan steps from "Plan:" sections
 * - plan_complete_step tool and [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	buildPlanExecutionMessage,
	extractTodoItems,
	formatPlainTodoItem,
	getVisibleTodoWindow,
	isSafeCommand,
	markCompletedSteps,
	MAX_TODO_ITEMS,
	MIN_TODO_ITEMS,
	splitTodoText,
	type TodoItem,
} from "./utils.js";

// Fallback tools used only when pi-sandbox cannot provide a cwd-scoped write lock.
const FALLBACK_PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "AskUserQuestion"];
const PLAN_MODE_STATE_ENTRY = "plan-mode";
const PLAN_MODE_EXECUTE_ENTRY = "plan-mode-execute";
const CLEAR_CONTEXT_EXECUTE_CHOICE = "Clear context and execute the plan";
const OLD_VISIBLE_DONE_TAG_INSTRUCTION =
	"- Also include the exact visible tag [DONE:n] in text, for example [DONE:1], so progress can be rebuilt from the transcript.";
const FALLBACK_DONE_TAG_INSTRUCTIONS =
	"- Do not print raw [DONE:n] tags in normal user-facing text after a successful plan_complete_step call.\n- Only if plan_complete_step is unavailable or fails, include a single fallback marker like [DONE:1] so progress can still be reconstructed.";

const PlanCompleteStepParams = Type.Object({
	steps: Type.Array(Type.Number({ description: "1-based plan step number to mark completed" }), {
		minItems: 1,
		maxItems: MAX_TODO_ITEMS,
		description: "One or more completed plan step numbers",
	}),
});

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
	scope: "cwd";
	respond?: (response: SandboxReadOnlyLockResponse | Promise<SandboxReadOnlyLockResponse>) => void;
}

interface PersistedPlanModeState {
	enabled?: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	previousActiveTools?: string[] | null;
	usingSandboxReadOnly?: boolean;
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

function getAssistantMessagesText(messages: AgentMessage[]): string {
	return messages.filter(isAssistantMessage).map(getTextContent).join("\n");
}

function filterStalePlanModeContext(messages: AgentMessage[]): AgentMessage[] {
	return messages.filter((m) => {
		const msg = m as AgentMessage & { customType?: string };
		if (msg.customType === "plan-mode-context") return false;
		if (msg.role !== "user") return true;

		const content = msg.content;
		if (typeof content === "string") {
			return !content.includes("[PLAN MODE ACTIVE]");
		}
		if (Array.isArray(content)) {
			return !content.some((c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"));
		}
		return true;
	});
}

function sanitizeVisibleDoneTagInstructions(messages: AgentMessage[]): boolean {
	let changed = false;
	for (const message of messages) {
		const msg = message as AgentMessage & { content?: unknown };
		if (typeof msg.content === "string") {
			const next = msg.content.replace(OLD_VISIBLE_DONE_TAG_INSTRUCTION, FALLBACK_DONE_TAG_INSTRUCTIONS);
			if (next !== msg.content) {
				msg.content = next;
				changed = true;
			}
			continue;
		}

		if (!Array.isArray(msg.content)) continue;
		for (const block of msg.content) {
			if (block.type !== "text") continue;
			const next = block.text.replace(OLD_VISIBLE_DONE_TAG_INSTRUCTION, FALLBACK_DONE_TAG_INSTRUCTIONS);
			if (next !== block.text) {
				block.text = next;
				changed = true;
			}
		}
	}
	return changed;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let lastCommandContext: ExtensionCommandContext | null = null;
	let previousActiveTools: string[] | null = null;
	let usingSandboxReadOnly = false;

	function cloneTodoItems(items: TodoItem[]): TodoItem[] {
		return items.map((item) => ({ ...item }));
	}

	function currentPersistedState(): PersistedPlanModeState {
		return {
			enabled: planModeEnabled,
			todos: cloneTodoItems(todoItems),
			executing: executionMode,
			previousActiveTools,
			usingSandboxReadOnly,
		};
	}

	function restorePersistedState(
		entries: Array<{ type: string; customType?: string; data?: unknown }>,
		resetSandboxReadOnly: boolean,
	): boolean {
		const planModeEntry = entries
			.filter((e) => e.type === "custom" && e.customType === PLAN_MODE_STATE_ENTRY)
			.pop() as { data?: PersistedPlanModeState } | undefined;

		if (!planModeEntry?.data) return false;

		planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
		todoItems = (planModeEntry.data.todos ?? todoItems).slice(0, MAX_TODO_ITEMS);
		executionMode = planModeEntry.data.executing ?? executionMode;
		previousActiveTools = planModeEntry.data.previousActiveTools ?? previousActiveTools;
		if (resetSandboxReadOnly) usingSandboxReadOnly = false;
		return true;
	}

	pi.registerFlag("plan", {
		description: "Start in plan mode (protect cwd from writes)",
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
		const completed = todoItems.filter((t) => t.completed).length;

		// Footer status
		if (executionMode && todoItems.length > 0) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing the current todo window
		if (executionMode && todoItems.length > 0) {
			const window = getVisibleTodoWindow(todoItems);
			const range = window.total > window.items.length ? ` · showing ${window.start + 1}-${window.end}` : "";
			const lines = [ctx.ui.theme.fg("muted", `Plan ${completed}/${todoItems.length}${range}`)];
			for (const item of window.items) {
				const [firstLine = "", ...rest] = splitTodoText(item.text);
				if (item.completed) {
					lines.push(
						ctx.ui.theme.fg("success", `☑ ${item.step}. `) +
							ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(firstLine)),
					);
					for (const line of rest) {
						lines.push(ctx.ui.theme.fg("muted", `   ${ctx.ui.theme.strikethrough(line)}`));
					}
				} else {
					lines.push(`${ctx.ui.theme.fg("muted", `☐ ${item.step}. `)}${firstLine}`);
					for (const line of rest) {
						lines.push(`${ctx.ui.theme.fg("muted", "   ")}${line}`);
					}
				}
			}
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
			reason: enabled ? "Plan mode active; protect cwd from writes" : "Plan mode inactive",
			cwd: ctx.cwd,
			scope: "cwd",
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
		// Always ask pi-sandbox to drop this owner lock. The local
		// usingSandboxReadOnly flag can be stale after compaction/reload/session
		// replacement, while pi-sandbox may still hold the process-level lock.
		await requestSandboxReadOnlyLock(false, ctx);
		usingSandboxReadOnly = false;
		restoreActiveTools();
	}

	async function togglePlanMode(ctx: ExtensionContext): Promise<void> {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];

		if (planModeEnabled) {
			await applyPlanModeRestrictions(ctx);
			if (usingSandboxReadOnly) {
				ctx.ui.notify("Plan mode enabled. Sandbox cwd write lock active; all current tools remain available.");
			} else {
				ctx.ui.notify(
					`Plan mode enabled. Sandbox read-only lock unavailable; fallback tools: ${FALLBACK_PLAN_MODE_TOOLS.join(", ")}`,
				);
			}
		} else {
			await releasePlanModeRestrictions(ctx);
			ctx.ui.notify("Plan mode disabled. Write restrictions removed.");
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
		pi.appendEntry(PLAN_MODE_STATE_ENTRY, currentPersistedState());
	}

	async function executePlanWithClearedContext(ctx: ExtensionCommandContext): Promise<void> {
		if (todoItems.length === 0) {
			ctx.ui.notify("No approved plan available to execute in a fresh context.", "warning");
			return;
		}

		const plan = cloneTodoItems(todoItems);
		const execMessage = buildPlanExecutionMessage(plan, /*clearContext*/ true);
		const parentSession = ctx.sessionManager.getSessionFile();
		const previousState = currentPersistedState();

		planModeEnabled = false;
		executionMode = false;
		await releasePlanModeRestrictions(ctx);
		updateStatus(ctx);
		persistState();

		const result = await ctx.newSession({
			parentSession,
			setup: async (sessionManager) => {
				sessionManager.appendCustomEntry(PLAN_MODE_STATE_ENTRY, {
					enabled: false,
					todos: plan,
					executing: true,
					previousActiveTools: null,
					usingSandboxReadOnly: false,
				} satisfies PersistedPlanModeState);
				sessionManager.appendCustomEntry(PLAN_MODE_EXECUTE_ENTRY, {
					clearContext: true,
					total: plan.length,
				});
			},
			withSession: async (freshCtx) => {
				await freshCtx.sendUserMessage(execMessage);
			},
		});

		if (result.cancelled) {
			planModeEnabled = previousState.enabled ?? false;
			todoItems = cloneTodoItems(previousState.todos ?? []);
			executionMode = previousState.executing ?? false;
			previousActiveTools = previousState.previousActiveTools ?? null;
			usingSandboxReadOnly = false;
			if (planModeEnabled) await applyPlanModeRestrictions(ctx);
			updateStatus(ctx);
			persistState();
			ctx.ui.notify("Clear-context execution cancelled.", "warning");
		}
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (protect cwd from writes)",
		handler: async (_args, ctx) => {
			lastCommandContext = ctx;
			await togglePlanMode(ctx);
		},
	});

	pi.registerCommand("plan-todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			lastCommandContext = ctx;
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const window = executionMode
				? getVisibleTodoWindow(todoItems)
				: { items: todoItems, start: 0, end: todoItems.length, total: todoItems.length };
			const list = window.items
				.map((item) => formatPlainTodoItem(item, item.completed ? "✓" : "○"))
				.join("\n");
			const range = window.total > window.items.length ? ` (showing ${window.start + 1}-${window.end} of ${window.total})` : "";
			ctx.ui.notify(`Plan Progress${range}:\n${list}`, "info");
		},
	});

	pi.registerCommand("plan-execute-clear-context", {
		description: "Clear context and execute the current plan-mode plan",
		handler: async (_args, ctx) => {
			lastCommandContext = ctx;
			await executePlanWithClearedContext(ctx);
		},
	});

	pi.registerShortcut(Key.shift("tab"), {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			await togglePlanMode(ctx);
		},
	});

	pi.registerTool({
		name: "plan_complete_step",
		label: "Plan step done",
		description: "Mark one or more current plan-mode execution steps as completed. After marking a step, continue with the next remaining step unless the whole plan is complete or blocked.",
		parameters: PlanCompleteStepParams,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!executionMode || todoItems.length === 0) {
				return {
					content: [{ type: "text", text: "No active plan execution." }],
					details: { completed: [], invalid: params.steps, total: 0, completedCount: 0 },
				};
			}

			const newlyCompleted: number[] = [];
			const invalid: number[] = [];
			const seen = new Set<number>();

			for (const step of params.steps) {
				if (!Number.isInteger(step)) {
					invalid.push(step);
					continue;
				}
				if (seen.has(step)) continue;
				seen.add(step);

				const item = todoItems.find((t) => t.step === step);
				if (!item) {
					invalid.push(step);
					continue;
				}
				if (!item.completed) {
					item.completed = true;
					newlyCompleted.push(step);
				}
			}

			updateStatus(ctx);
			persistState();

			const completedCount = todoItems.filter((t) => t.completed).length;
			const completedText =
				newlyCompleted.length > 0
					? `✓ Step${newlyCompleted.length === 1 ? "" : "s"} ${newlyCompleted.join(", ")} complete`
					: "No new plan steps marked complete";
			const invalidText = invalid.length > 0 ? `\nIgnored invalid step${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}` : "";
			const next = todoItems.find((t) => !t.completed);
			const nextText = next
				? `\nNext: step ${next.step} — ${next.text}`
				: "\nAll plan steps are complete. Provide the final concise summary.";

			return {
				content: [
					{ type: "text", text: `${completedText} · Plan progress ${completedCount}/${todoItems.length}${invalidText}${nextText}` },
				],
				details: { completed: newlyCompleted, invalid, total: todoItems.length, completedCount, nextStep: next?.step },
			};
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

	// Filter out stale plan mode context when not in plan mode.
	pi.on("context", async (event) => {
		const sanitized = sanitizeVisibleDoneTagInstructions(event.messages);
		if (planModeEnabled) return sanitized ? { messages: event.messages } : undefined;

		const messages = filterStalePlanModeContext(event.messages);
		if (!sanitized && messages.length === event.messages.length) return;
		return { messages };
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async (_event, ctx) => {
		if (!planModeEnabled && !executionMode) {
			restorePersistedState(ctx.sessionManager.getEntries(), /*resetSandboxReadOnly*/ false);
		}

		if (planModeEnabled) {
			const restrictions = usingSandboxReadOnly
				? `- pi-sandbox cwd write lock is active; all current tools remain available for investigation.
- File modifications under the current working directory are disabled by sandbox policy. Do not write under ${ctx.cwd}.`
				: `- You can only use: ${FALLBACK_PLAN_MODE_TOOLS.join(", ")}
- You CANNOT use file modification tools
- Bash is restricted to an allowlist of read-only commands`;

			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in Plan Mode until the plan-mode extension explicitly exits it. User requests to "execute", "implement", or "continue" while this context is active are requests to plan that execution, not to perform it.

Mode rules:
- Explore first using non-mutating actions that improve the plan: read files, search code, inspect configs, run safe dry-run checks, and gather repo facts.
- Do not mutate repo-tracked state, edit files, run code generation, run formatters that rewrite files, or otherwise do the implementation work.
- Ask with AskUserQuestion only for high-impact ambiguity or preferences that cannot be discovered from the repo.
- The UI will ask the user whether to execute after you provide a plan, including an option to clear context first. Do not ask "should I proceed?" in your final plan.

Restrictions:
${restrictions}

Final plan format:
- Output a decision-complete numbered plan under a "Plan:" header.
- Use ${MIN_TODO_ITEMS}-${MAX_TODO_ITEMS} steps. If the task is small, use 1 step.
- Do not include step ${MAX_TODO_ITEMS + 1} or beyond.
- Make each step concrete enough that another agent can execute it without making product or implementation decisions.

Plan:
1. First step description
2. Second step description
...`,
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
					content: `[EXECUTING APPROVED PLAN - Plan-mode write restrictions lifted]
You are now in execution mode. The plan below is approved; execute it end-to-end and report concise progress.

Remaining steps:
${todoList}

Execution rules:
- Execute the entire remaining plan, not only the first step.
- Make reasonable assumptions when minor details are missing; ask the user only if blocked or if continuing would be risky.
- Continue autonomously from one step to the next until every remaining step is complete.
- Do not stop, summarize, or hand control back after completing a single step when more steps remain.

Progress tracking:
- As soon as step n is complete, call the plan_complete_step tool with that step number.
- After marking a step complete, immediately continue with the next remaining step.
${FALLBACK_DONE_TAG_INSTRUCTIONS}
- If multiple steps complete in one response, mark every completed step.
- Only provide a final summary after all remaining steps have been completed.`,
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
			const newlyCompleted = markCompletedSteps(getAssistantMessagesText(event.messages), todoItems);
			if (newlyCompleted > 0) {
				updateStatus(ctx);
				persistState();
			}

			if (todoItems.every((t) => t.completed)) {
				pi.sendMessage(
					{
						customType: "plan-complete",
						content: `**Plan Complete!** ✓\n\n${todoItems.length}/${todoItems.length} steps completed.`,
						display: true,
					},
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

		// Show every plan step before execution; the 3-item window is only for execution progress.
		if (todoItems.length > 0) {
			const todoListText = todoItems.map((item) => formatPlainTodoItem(item, "☐")).join("\n");
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

		const choices = [
			todoItems.length > 0 ? "Execute the plan (track progress)" : "Execute the plan",
			...(todoItems.length > 0 ? [CLEAR_CONTEXT_EXECUTE_CHOICE] : []),
			"Stay in plan mode",
			"Refine the plan",
		];
		const choice = await ctx.ui.select("Plan mode - what next?", choices);

		if (choice === CLEAR_CONTEXT_EXECUTE_CHOICE) {
			if (lastCommandContext) {
				const commandCtx = lastCommandContext;
				setTimeout(() => {
					void executePlanWithClearedContext(commandCtx).catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						try {
							commandCtx.ui.notify(`Clear-context execution failed: ${message}`, "error");
						} catch {
							// The command context may be stale if session replacement partially completed.
						}
					});
				}, 0);
			} else {
				ctx.ui.setEditorText("/plan-execute-clear-context");
				ctx.ui.notify(
					"Clear-context execution must create a new session. Press Enter to run /plan-execute-clear-context.",
					"warning",
				);
			}
		} else if (choice?.startsWith("Execute")) {
			planModeEnabled = false;
			executionMode = todoItems.length > 0;
			await releasePlanModeRestrictions(ctx);
			updateStatus(ctx);
			persistState();

			const execMessage = buildPlanExecutionMessage(todoItems, /*clearContext*/ false);
			pi.sendMessage(
				{
					customType: "plan-execution-start",
					content: `**Executing approved plan**\n\n${todoItems.length} step${todoItems.length === 1 ? "" : "s"} approved. Progress will be tracked below.`,
					display: true,
				},
				{ triggerTurn: false },
			);
			pi.sendMessage(
				{ customType: PLAN_MODE_EXECUTE_ENTRY, content: execMessage, display: false, details: { clearContext: false } },
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
		const restored = restorePersistedState(entries, /*resetSandboxReadOnly*/ true);

		// On resume: re-scan messages to rebuild completion state
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
		const isResume = restored;
		if (isResume && executionMode && todoItems.length > 0) {
			// Find the index of the last plan-mode-execute entry (marks when current execution started)
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === PLAN_MODE_EXECUTE_ENTRY) {
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
