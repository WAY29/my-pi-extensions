import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
	prepareAdvisedEditArgumentsWithWarnings,
	prepareAdvisedEditArguments,
	validateAdvisedEditInput,
} from "./diagnostics.ts";

function createBaseEditDefinitionMock() {
	return {
		label: "edit",
		description: "mock edit",
		promptSnippet: "mock prompt",
		promptGuidelines: ["mock guideline"],
		renderShell: "self" as const,
		async execute(_toolCallId: string, input: { path: string; edits: Array<{ oldText: string; newText: string }> }) {
			const { path, edits } = input;
			const content = await Bun.file(path).text().catch(async () => Bun.file(join(process.cwd(), path)).text());
			const target = edits[0];
			if (!target) throw new Error(`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`);
			const occurrences = content.split(target.oldText).length - 1;
			if (occurrences > 1) {
				throw new Error(`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`);
			}
			if (occurrences === 0) {
				throw new Error(`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`);
			}
			return {
				content: [{ type: "text", text: `Successfully replaced ${edits.length} block(s) in ${path}.` }],
				details: { diff: "", patch: "" },
			};
		},
		renderCall() {
			return undefined;
		},
		renderResult(result: { content?: Array<{ type: string; text?: string }> }) {
			return result;
		},
	};
}

async function loadBetterEditModule(options?: { failMutationQueue?: boolean }) {
	mock.module("@earendil-works/pi-coding-agent", () => ({
		createEditToolDefinition: () => createBaseEditDefinitionMock(),
		getAgentDir: () => "/tmp/pi-agent",
		withFileMutationQueue: async (_path: string, fn: () => Promise<unknown>) => {
			if (options?.failMutationQueue) throw new Error("queue failed");
			return await fn();
		},
	}));
	mock.module("typebox", () => ({
		Type: {
			Object: (value: unknown) => value,
			Optional: (value: unknown) => value,
			String: (value: unknown) => value,
			Array: (value: unknown) => value,
		},
	}));
	return import("./index.ts");
}

beforeEach(() => {
	mock.restore();
	if (existsSync("/tmp/pi-agent/logs/better-edit-errors.ndjson")) {
		unlinkSync("/tmp/pi-agent/logs/better-edit-errors.ndjson");
	}
});

describe("prepareAdvisedEditArguments", () => {
	test("normalizes legacy fields, aliases, and extra keys", () => {
		const prepared = prepareAdvisedEditArguments({
			file_path: "sample.ts",
			edits: JSON.stringify({ search: "before", replace: "after", ignored: true }),
			oldText: "legacy old",
			newText: "legacy new",
			extra: "ignored",
		});

		expect(prepared).toEqual({
			path: "sample.ts",
			edits: [
				{ oldText: "before", newText: "after" },
				{ oldText: "legacy old", newText: "legacy new" },
			],
		});
	});

	test("drops extra keys inside edits items while preserving oldText and newText", () => {
		const prepared = prepareAdvisedEditArguments({
			path: "sample.ts",
			edits: [
				{
					oldText: "before",
					newText: "after",
					foo: "bar",
					nested: { ignored: true },
				},
			],
		});

		expect(prepared).toEqual({
			path: "sample.ts",
			edits: [{ oldText: "before", newText: "after" }],
		});
	});

	test("collects hidden warnings for compatibility aliases and ignored extras", () => {
		const prepared = prepareAdvisedEditArgumentsWithWarnings({
			file_path: "sample.ts",
			edits: [{ search: "before", replace: "after", foo: "bar" }],
			extraTopLevel: true,
		});

		expect(prepared.prepared).toEqual({
			path: "sample.ts",
			edits: [{ oldText: "before", newText: "after" }],
		});
		expect(prepared.warnings).toEqual([
			expect.stringContaining("canonical top-level shape"),
			expect.stringContaining("Ignored extra top-level keys: extraTopLevel"),
			expect.stringContaining("edits[0].oldText"),
			expect.stringContaining("Ignored extra keys in edits[0]: foo"),
		]);
	});
});

describe("validateAdvisedEditInput", () => {
	test("returns advised validation errors", () => {
		expect(() =>
			validateAdvisedEditInput({
				path: "sample.ts",
				edits: [{ oldText: "before" }],
			}),
		).toThrow(/Advice:/);
		expect(() =>
			validateAdvisedEditInput({
				path: "sample.ts",
				edits: [{ oldText: "before" }],
			}),
		).toThrow(/edits\[0\]\.newText is missing/);
	});

	test("accepts sanitized edits that originally had extra keys", () => {
		const prepared = prepareAdvisedEditArguments({
			path: "sample.ts",
			edits: [{ oldText: "before", newText: "after", extra: "ignored" }],
		});

		expect(validateAdvisedEditInput(prepared)).toEqual({
			path: "sample.ts",
			edits: [{ oldText: "before", newText: "after" }],
		});
	});
});

describe("parseCommandMode", () => {
	test("parses on off toggle and status aliases", async () => {
		const { parseCommandMode } = await loadBetterEditModule();
		expect(parseCommandMode("")).toBe("status");
		expect(parseCommandMode("enable")).toBe("on");
		expect(parseCommandMode("disabled")).toBe("off");
		expect(parseCommandMode("switch")).toBe("toggle");
		expect(parseCommandMode("show")).toBe("status");
		expect(parseCommandMode("wat")).toBeUndefined();
	});
});

describe("createBetterEditToolDefinition", () => {
	test("reports duplicate matches with line guidance and retry advice", async () => {
			const { createBetterEditToolDefinition } = await loadBetterEditModule();
		const workspace = mkdtempSync(join(tmpdir(), "better-edit-"));
		try {
			writeFileSync(join(workspace, "sample.ts"), ["const value = 1;", "const value = 2;", ""].join("\n"), "utf8");
			const tool = createBetterEditToolDefinition(workspace);

			await expect(
				tool.execute(
					"call-1",
					{ path: "sample.ts", edits: [{ oldText: "const value =", newText: "const total =" }] },
					undefined,
					undefined,
					{ cwd: workspace } as never,
				),
			).rejects.toThrow(/lines 1-2/);

			await expect(
				tool.execute(
					"call-1",
					{ path: "sample.ts", edits: [{ oldText: "const value =", newText: "const total =" }] },
					undefined,
					undefined,
					{ cwd: workspace } as never,
				),
			).rejects.toThrow(/do not fall back to write/);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	test("reports likely indentation mismatches with candidate lines", async () => {
			const { createBetterEditToolDefinition } = await loadBetterEditModule();
		const workspace = mkdtempSync(join(tmpdir(), "better-edit-"));
		try {
			writeFileSync(join(workspace, "sample.ts"), ["alpha(", "  beta,", ")", ""].join("\n"), "utf8");
			const tool = createBetterEditToolDefinition(workspace);

			await expect(
				tool.execute(
					"call-2",
					{ path: "sample.ts", edits: [{ oldText: "alpha(\nbeta,\n)\n", newText: "alpha(\nBETA,\n)\n" }] },
					undefined,
					undefined,
					{ cwd: workspace } as never,
				),
			).rejects.toThrow(/leading indentation/);

			await expect(
				tool.execute(
					"call-2",
					{ path: "sample.ts", edits: [{ oldText: "alpha(\nbeta,\n)\n", newText: "alpha(\nBETA,\n)\n" }] },
					undefined,
					undefined,
					{ cwd: workspace } as never,
				),
			).rejects.toThrow(/lines 1-3/);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	test("returns hidden input warnings in tool result content without changing visible render payload", async () => {
		const { createBetterEditToolDefinition } = await loadBetterEditModule();
		const workspace = mkdtempSync(join(tmpdir(), "better-edit-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(workspace);
			writeFileSync(join(workspace, "sample.ts"), ["const value = 1;", ""].join("\n"), "utf8");
			const tool = createBetterEditToolDefinition(workspace);

			const prepared = tool.prepareArguments?.({
				file_path: "sample.ts",
				edits: [{ oldText: "const value = 1;", newText: "const total = 1;", extra: true }],
			});
			const result = await tool.execute(
				"call-3",
				prepared,
				undefined,
				undefined,
				{ cwd: workspace } as never,
			);

			const text = result.content.find((item) => item.type === "text")?.text ?? "";
			expect(text).toContain("Input advisory for future edit calls:");
			expect(text).toContain("Ignored extra keys in edits[0]: extra");

			const renderedResult = tool.renderResult?.(result as never, {} as never, {} as never, { cwd: workspace } as never) as
				| { content?: Array<{ type: string; text?: string }> }
				| undefined;
			const renderedText = renderedResult?.content?.find((item) => item.type === "text")?.text ?? "";
			expect(renderedText).not.toContain("Input advisory for future edit calls:");
		} finally {
			process.chdir(previousCwd);
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	test("logs real execution errors to the pi agent log directory", async () => {
		const { createBetterEditToolDefinition } = await loadBetterEditModule();
		const workspace = mkdtempSync(join(tmpdir(), "better-edit-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(workspace);
			writeFileSync(join(workspace, "sample.ts"), ["const value = 1;", "const value = 2;", ""].join("\n"), "utf8");
			const tool = createBetterEditToolDefinition(workspace);

			await expect(
				tool.execute(
					"call-log",
					{ path: "sample.ts", edits: [{ oldText: "const value =", newText: "const total =" }] },
					undefined,
					undefined,
					{ cwd: workspace } as never,
				),
			).rejects.toThrow(/do not fall back to write/);

			const logPath = "/tmp/pi-agent/logs/better-edit-errors.ndjson";
			expect(existsSync(logPath)).toBe(true);
			const lines = readFileSync(logPath, "utf8").trim().split("\n");
			expect(lines.length).toBeGreaterThan(0);
			const lastEntry = JSON.parse(lines.at(-1) ?? "{}");
			expect(lastEntry.toolCallId).toBe("call-log");
			expect(lastEntry.path).toBe("sample.ts");
			expect(lastEntry.error.message).toContain("Found 2 occurrences");
		} finally {
			process.chdir(previousCwd);
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	test("logging failure does not block successful edit calls", async () => {
		const { createBetterEditToolDefinition } = await loadBetterEditModule({ failMutationQueue: true });
		const workspace = mkdtempSync(join(tmpdir(), "better-edit-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(workspace);
			writeFileSync(join(workspace, "sample.ts"), ["const value = 1;", ""].join("\n"), "utf8");
			const tool = createBetterEditToolDefinition(workspace);

			const prepared = tool.prepareArguments?.({
				file_path: "sample.ts",
				edits: [{ oldText: "const value = 1;", newText: "const total = 1;", extra: true }],
			});
			const result = await tool.execute(
				"call-ok",
				prepared,
				undefined,
				undefined,
				{ cwd: workspace } as never,
			);

			const text = result.content.find((item) => item.type === "text")?.text ?? "";
			expect(text).toContain("Successfully replaced 1 block(s) in sample.ts.");
		} finally {
			process.chdir(previousCwd);
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	test("logging failure does not replace the advised edit error", async () => {
		const { createBetterEditToolDefinition } = await loadBetterEditModule({ failMutationQueue: true });
		const workspace = mkdtempSync(join(tmpdir(), "better-edit-"));
		try {
			writeFileSync(join(workspace, "sample.ts"), ["const value = 1;", "const value = 2;", ""].join("\n"), "utf8");
			const tool = createBetterEditToolDefinition(workspace);

			await expect(
				tool.execute(
					"call-fail",
					{ path: "sample.ts", edits: [{ oldText: "const value =", newText: "const total =" }] },
					undefined,
					undefined,
					{ cwd: workspace } as never,
				),
			).rejects.toThrow(/do not fall back to write/);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
