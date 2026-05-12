import { describe, expect, test } from "bun:test";
import {
	buildPlanExecutionMessage,
	extractTodoItems,
	formatPlainTodoItem,
	getVisibleTodoWindow,
	markCompletedSteps,
	type TodoItem,
} from "./utils.ts";

function todos(count: number): TodoItem[] {
	return Array.from({ length: count }, (_, index) => ({
		step: index + 1,
		text: `Step ${index + 1}`,
		completed: false,
	}));
}

function visibleSteps(items: TodoItem[]): number[] {
	return getVisibleTodoWindow(items).items.map((item) => item.step);
}

describe("getVisibleTodoWindow", () => {
	test("shows all todos when fewer than three", () => {
		expect(visibleSteps(todos(2))).toEqual([1, 2]);
	});

	test("shows all todos when exactly three", () => {
		expect(visibleSteps(todos(3))).toEqual([1, 2, 3]);
	});

	test("shows the first three todos before progress starts", () => {
		expect(visibleSteps(todos(10))).toEqual([1, 2, 3]);
	});

	test("keeps one completed item visible with two upcoming items when possible", () => {
		const items = todos(5);
		markCompletedSteps("[DONE:1]", items);
		expect(visibleSteps(items)).toEqual([1, 2, 3]);

		markCompletedSteps("[DONE:2]", items);
		expect(visibleSteps(items)).toEqual([2, 3, 4]);

		markCompletedSteps("[DONE:3]", items);
		expect(visibleSteps(items)).toEqual([3, 4, 5]);
	});

	test("handles the tail boundary", () => {
		const items = todos(10);
		markCompletedSteps("[DONE:1,2,3,4,5,6,7,8,9]", items);
		expect(visibleSteps(items)).toEqual([8, 9, 10]);

		markCompletedSteps("[DONE:10]", items);
		expect(visibleSteps(items)).toEqual([8, 9, 10]);
	});
});

describe("todo formatting and extraction", () => {
	test("preserves multiline todo text while counting it as one visible item", () => {
		const items = extractTodoItems(`Plan:\n1. Update parser\n   keep continuation details\n2. Run tests`);
		expect(items).toHaveLength(2);
		expect(items[0]?.text).toBe("Parser\nkeep continuation details");
		expect(formatPlainTodoItem(items[0]!, "☐")).toBe("1. ☐ Parser\n   keep continuation details");
		expect(visibleSteps(items)).toEqual([1, 2]);
	});
});

describe("buildPlanExecutionMessage", () => {
	test("builds normal execution kickoff without fresh-context handoff", () => {
		const message = buildPlanExecutionMessage(todos(2), false);
		expect(message).toContain("Begin with step 1: Step 1");
		expect(message).toContain("plan_complete_step");
		expect(message).toContain("Do not print raw progress markers");
		expect(message).not.toContain("[DONE:n]");
		expect(message).not.toContain("fresh context");
		expect(message).not.toContain("Plan:\n1. Step 1");
	});

	test("builds clear-context kickoff with full plan handoff", () => {
		const message = buildPlanExecutionMessage(todos(2), true);
		expect(message).toContain("fresh context");
		expect(message).toContain("Treat the plan as the source of user intent");
		expect(message).toContain("Plan:\n1. Step 1\n2. Step 2");
		expect(message).toContain("Begin with step 1: Step 1");
		expect(message).toContain("plan_complete_step");
		expect(message).toContain("Do not print raw progress markers");
		expect(message).not.toContain("[DONE:n]");
	});
});
