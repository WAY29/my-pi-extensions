import test from "node:test";
import assert from "node:assert/strict";
import { clearResults, storeResult, getResult } from "../.tmp-test-dist/storage.js";

test("stored fetch/search payloads can support multi-index retrieval inputs", () => {
  clearResults();
  storeResult("search-multi", {
    id: "search-multi",
    type: "search",
    timestamp: Date.now(),
    queries: [
      { query: "q1", answer: "a1", results: [{ title: "t1", url: "https://1", snippet: "s1" }], error: null },
      { query: "q2", answer: "a2", results: [{ title: "t2", url: "https://2", snippet: "s2" }], error: null },
    ],
  });
  storeResult("fetch-multi", {
    id: "fetch-multi",
    type: "fetch",
    timestamp: Date.now(),
    urls: [
      { url: "https://1", title: "one", content: "c1", error: null },
      { url: "https://2", title: "two", content: "c2", error: null },
    ],
  });

  const searchData = getResult("search-multi");
  const fetchData = getResult("fetch-multi");
  assert.equal(searchData?.queries?.[1]?.query, "q2");
  assert.equal(fetchData?.urls?.[1]?.title, "two");
});
