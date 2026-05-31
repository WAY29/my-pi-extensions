import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackQuery, maxTokensToResultCount, trimApproxTokens } from "../.tmp-test-dist/code-search.js";

test("buildFallbackQuery appends code/documentation hints when absent", () => {
  const result = buildFallbackQuery("react suspense patterns");
  assert.match(result, /code examples documentation GitHub Stack Overflow official docs/);
});

test("buildFallbackQuery leaves code-centric queries unchanged", () => {
  const query = "react useEffect API docs";
  assert.equal(buildFallbackQuery(query), query);
});

test("maxTokensToResultCount clamps reasonably", () => {
  assert.equal(maxTokensToResultCount(1000), 5);
  assert.equal(maxTokensToResultCount(5000), 5);
  assert.equal(maxTokensToResultCount(12000), 12);
  assert.equal(maxTokensToResultCount(50000), 20);
});

test("trimApproxTokens truncates long output", () => {
  const text = "x".repeat(9000);
  const trimmed = trimApproxTokens(text, 1000);
  assert.match(trimmed, /Truncated by code_search/);
  assert.ok(trimmed.length < text.length);
});
