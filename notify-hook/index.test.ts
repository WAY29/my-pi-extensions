import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "bun:test";

const dir = dirname(fileURLToPath(import.meta.url));

test("notify-hook core does not import adapter modules", () => {
	const src = readFileSync(join(dir, "index.ts"), "utf8");
	expect(src).not.toContain("adapters/herdr");
	expect(src).not.toContain("adapters/kitty");
	expect(src).not.toMatch(/from\s+["']\.\/adapters\/(?!types)/);
});
