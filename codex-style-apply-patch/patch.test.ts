import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DiffError, executePatch, parsePatchActions } from "./patch.ts";

describe("parsePatchActions", () => {
	test("allows repeated update sections for the same path", () => {
		const actions = parsePatchActions({
			text: [
				"*** Begin Patch",
				"*** Update File: sample.txt",
				"@@",
				" a",
				"-b",
				"+B",
				" c",
				"*** Update File: sample.txt",
				"@@",
				" a",
				" B",
				" c",
				"-d",
				"+D",
				"*** End Patch",
			].join("\n"),
		});

		expect(actions).toHaveLength(2);
		expect(actions.every((action) => action.type === "update" && action.path === "sample.txt")).toBe(true);
	});

	test("still rejects mixed duplicate actions for the same path", () => {
		expect(() =>
			parsePatchActions({
				text: [
					"*** Begin Patch",
					"*** Add File: sample.txt",
					"+hello",
					"*** Update File: sample.txt",
					"@@",
					"-hello",
					"+world",
					"*** End Patch",
				].join("\n"),
			}),
		).toThrow(DiffError);
	});
});

describe("executePatch", () => {
	test("applies repeated updates against the same original file", () => {
		const workspace = mkdtempSync(join(tmpdir(), "codex-style-apply-patch-"));
		try {
			const target = join(workspace, "sample.txt");
			writeFileSync(target, ["one", "alpha", "two", "beta", "three", ""].join("\n"), "utf8");

			const result = executePatch({
				cwd: workspace,
				patchText: [
					"*** Begin Patch",
					"*** Update File: sample.txt",
					"@@",
					" one",
					"-alpha",
					"+ALPHA",
					" two",
					"*** Update File: sample.txt",
					"@@",
					" one",
					" alpha",
					" two",
					"-beta",
					"+BETA",
					" three",
					"*** End Patch",
				].join("\n"),
			});

			expect(result.changedFiles).toEqual(["sample.txt"]);
			expect(readFileSync(target, "utf8")).toBe(["one", "ALPHA", "two", "BETA", "three", ""].join("\n"));
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
