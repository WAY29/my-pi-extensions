import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
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
		renderResult() {
			return undefined;
		},
	};
}

async function loadBetterEditModule() {
	mock.module("@earendil-works/pi-coding-agent", () => ({
		createEditToolDefinition: () => createBaseEditDefinitionMock(),
		getAgentDir: () => "/tmp/pi-agent",
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
});
