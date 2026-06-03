import test from "node:test";
import assert from "node:assert/strict";
import {
  clearResults,
  deleteResult,
  generateId,
  getAllResults,
  getResult,
  resolveStoredFetchContent,
  storeResult,
} from "../.tmp-test-dist/storage.js";

test("storage round-trip works", () => {
  clearResults();
  const id = generateId();
  const payload = {
    id,
    type: "search",
    timestamp: Date.now(),
    queries: [{ query: "q", answer: "a", results: [], error: null }],
  };

  storeResult(id, payload);
  assert.deepEqual(getResult(id), payload);
  assert.equal(getAllResults().length, 1);
  assert.equal(deleteResult(id), true);
  assert.equal(getResult(id), null);
});

test("resolveStoredFetchContent prefers cached fetch results and keeps URL order", () => {
  clearResults();
  storeResult("older", {
    id: "older",
    type: "fetch",
    timestamp: 1,
    urls: [
      { url: "https://a.example", title: "A old", content: "old-a", error: null },
      { url: "https://b.example", title: "B", content: "b", error: null },
    ],
  });
  storeResult("newer", {
    id: "newer",
    type: "fetch",
    timestamp: 2,
    urls: [
      { url: "https://a.example", title: "A new", content: "new-a", error: null },
      { url: "https://c.example", title: "C", content: "c", error: null },
      { url: "https://d.example", title: "D", content: "", error: "failed" },
    ],
  });

  const resolved = resolveStoredFetchContent([
    "https://b.example",
    "https://a.example",
    "https://d.example",
    "https://missing.example",
  ]);

  assert.deepEqual(
    resolved.cached.map((item) => [item.url, item.content]),
    [
      ["https://b.example", "b"],
      ["https://a.example", "new-a"],
    ],
  );
  assert.deepEqual(resolved.missingUrls, ["https://d.example", "https://missing.example"]);
});
