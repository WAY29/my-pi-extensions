import test from "node:test";
import assert from "node:assert/strict";
import { resolveSearchProviderOrder } from "../.tmp-test-dist/search.js";

const config = {
  tinyfishApiKey: "tf-demo",
  exaApiKey: undefined,
  providerPriority: ["exa", "tinyfish"],
  searchLocation: "US",
  searchLanguage: "en",
};

test("resolveSearchProviderOrder respects explicit providers", () => {
  assert.deepEqual(
    resolveSearchProviderOrder("tinyfish", { tinyfish: true, exa: true }, config),
    ["tinyfish"],
  );
  assert.deepEqual(
    resolveSearchProviderOrder("exa", { tinyfish: true, exa: true }, config),
    ["exa"],
  );
});

test("resolveSearchProviderOrder follows config priority for auto", () => {
  assert.deepEqual(
    resolveSearchProviderOrder("auto", { tinyfish: true, exa: true }, config),
    ["exa", "tinyfish"],
  );
});

test("resolveSearchProviderOrder filters unavailable providers", () => {
  assert.deepEqual(
    resolveSearchProviderOrder("auto", { tinyfish: false, exa: true }, config),
    ["exa"],
  );
});
