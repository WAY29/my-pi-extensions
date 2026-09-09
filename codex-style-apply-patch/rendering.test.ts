import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, mock, test } from "bun:test";

mock.module("@earendil-works/pi-coding-agent", () => ({
	renderDiff: (text: string) => text,
}));

const { getApplyPatchPreviewSections } = await import("./rendering.ts");

function withWorkspace(run: (cwd: string) => void): void {
	const cwd = mkdtempSync(join(tmpdir(), "codex-style-apply-patch-preview-"));
	try {
		run(cwd);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

describe("getApplyPatchPreviewSections", () => {
	test("inserts ellipsis between disjoint hunks", () => {
		withWorkspace((cwd) => {
			writeFileSync(
				join(cwd, "sample.txt"),
				`${Array.from({ length: 30 }, (_, index) => `line-${index + 1}`).join("\n")}\n`,
				"utf8",
			);

			const [section] = getApplyPatchPreviewSections(
				[
					"*** Begin Patch",
					"*** Update File: sample.txt",
					"@@",
					" line-1",
					"-line-2",
					"+LINE-2",
					" line-3",
					"@@",
					" line-20",
					"-line-21",
					"+LINE-21",
					" line-22",
					"*** End Patch",
				].join("\n"),
				cwd,
				{ maxPreviewLinesPerFile: 100 },
			);

			const lines = (section?.diffText ?? "").split("\n");
			const gap = lines.findIndex((line) => line.includes("..."));
			expect(gap).toBeGreaterThan(0);
			expect(lines[gap - 1]).toContain("line-3");
			expect(lines[gap + 1]).toContain("line-20");
			expect(lines.filter((line) => line.includes("...")).length).toBe(1);
		});
	});

	test("does not insert ellipsis between adjacent hunks", () => {
		withWorkspace((cwd) => {
			writeFileSync(join(cwd, "sample.txt"), "a\nb\nc\nd\ne\n", "utf8");

			const [section] = getApplyPatchPreviewSections(
				[
					"*** Begin Patch",
					"*** Update File: sample.txt",
					"@@",
					" a",
					"-b",
					"+B",
					" c",
					"@@",
					" c",
					"-d",
					"+D",
					" e",
					"*** End Patch",
				].join("\n"),
				cwd,
				{ maxPreviewLinesPerFile: 100 },
			);

			expect(section?.diffText ?? "").not.toContain("...");
		});
	});
});
