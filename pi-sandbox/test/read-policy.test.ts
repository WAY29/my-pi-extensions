import test from "node:test";

import assert from "node:assert/strict";

import { getReadBlockReason } from "../src/read-policy.ts";

function matchesPattern(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => path === pattern || path.startsWith(pattern + "/"));
}

test("allows reads outside denyRead even when allowRead is configured", () => {
  assert.equal(
    getReadBlockReason(
      "/Users/lang/project/README.md",
      ["/Users/lang/.ssh"],
      ["/Users/lang/.ssh/known_hosts"],
      [],
      matchesPattern,
    ),
    null,
  );
});

test("allows allowRead exceptions inside denied read paths", () => {
  assert.equal(
    getReadBlockReason(
      "/Users/lang/.ssh/known_hosts",
      ["/Users/lang/.ssh"],
      ["/Users/lang/.ssh/known_hosts"],
      [],
      matchesPattern,
    ),
    null,
  );
});

test("blocks denied read paths that are not covered by allowRead", () => {
  assert.equal(
    getReadBlockReason(
      "/Users/lang/.ssh/id_ed25519",
      ["/Users/lang/.ssh"],
      ["/Users/lang/.ssh/known_hosts"],
      [],
      matchesPattern,
    ),
    "denyRead",
  );
});
