import test from "node:test";
import assert from "node:assert/strict";
import { resolveFetchProvider } from "../.tmp-test-dist/fetch-provider.js";

test("resolveFetchProvider defaults to local", () => {
  assert.equal(resolveFetchProvider(undefined), "local");
  assert.equal(resolveFetchProvider("anything-else"), "local");
});

test("resolveFetchProvider allows tinyfish explicitly", () => {
  assert.equal(resolveFetchProvider("tinyfish"), "tinyfish");
});
