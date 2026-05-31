import test from "node:test";
import assert from "node:assert/strict";
import {
  clearResults,
  deleteResult,
  generateId,
  getAllResults,
  getResult,
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
