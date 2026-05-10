import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStoredTitle, saveStoredTitle } from "../title-store.js";

const dir = await mkdtemp(join(tmpdir(), "pi-glance-title-"));
const storePath = join(dir, "title.json");

assert.equal(await loadStoredTitle("session:/missing", storePath), undefined, "missing store should not have a title");

await saveStoredTitle(
	"session:/a.jsonl",
	{ text: "  Refactor auth flow  ", source: "llm", prompt: "please refactor auth", model: "openai/gpt-4o-mini" },
	storePath,
);

const stored = await loadStoredTitle("session:/a.jsonl", storePath);
assert.equal(stored?.text, "Refactor auth flow", "stored title should be trimmed and reloadable");
assert.equal(stored?.source, "llm", "stored title source should round-trip");
assert.equal(stored?.model, "openai/gpt-4o-mini", "stored title model should round-trip");

const raw = JSON.parse(await readFile(storePath, "utf8")) as { version?: number; sessions?: Record<string, unknown> };
assert.equal(raw.version, 1, "title store should include a schema version");
assert.ok(raw.sessions?.["session:/a.jsonl"], "title store should key titles by session");

await writeFile(
	storePath,
	JSON.stringify({
		version: 1,
		sessions: {
			bad: { text: 123 },
			good: { text: "Keep this", source: "invalid" },
		},
	}),
	"utf8",
);

assert.equal(await loadStoredTitle("bad", storePath), undefined, "invalid title entries should be ignored");
assert.deepEqual(await loadStoredTitle("good", storePath), { text: "Keep this" }, "valid fields should be normalized");

console.log("✓ title store checks passed");