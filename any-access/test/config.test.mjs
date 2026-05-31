import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  normalizeProviderPriority,
  parseConfigText,
  resolveConfig,
} from "../.tmp-test-dist/config.js";

test("normalizeProviderPriority keeps order, uniqueness, and appends fallback providers", () => {
  assert.deepEqual(normalizeProviderPriority(["exa", "exa"]), ["exa", "tinyfish"]);
  assert.deepEqual(normalizeProviderPriority(["tinyfish"]), ["tinyfish", "exa"]);
  assert.deepEqual(normalizeProviderPriority([]), ["tinyfish", "exa"]);
});

test("resolveConfig applies defaults and normalizes locale casing", () => {
  const config = resolveConfig({
    searchLocation: "us",
    searchLanguage: "EN",
  });

  assert.equal(config.searchLocation, "US");
  assert.equal(config.searchLanguage, "en");
  assert.deepEqual(config.providerPriority, DEFAULT_CONFIG.providerPriority);
});

test("parseConfigText throws with source path context on invalid json", () => {
  assert.throws(
    () => parseConfigText("{", "/tmp/any-access.json"),
    /Failed to parse \/tmp\/any-access\.json/,
  );
});
