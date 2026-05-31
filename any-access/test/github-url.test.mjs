import test from "node:test";
import assert from "node:assert/strict";
import { parseGitHubUrl } from "../.tmp-test-dist/github-extract.js";

test("parseGitHubUrl handles root repositories", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/owner/repo"), {
    owner: "owner",
    repo: "repo",
    refIsFullSha: false,
    type: "root",
  });
});

test("parseGitHubUrl handles blob paths", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/owner/repo/blob/main/src/index.ts"), {
    owner: "owner",
    repo: "repo",
    ref: "main",
    refIsFullSha: false,
    path: "src/index.ts",
    type: "blob",
  });
});

test("parseGitHubUrl ignores non-code GitHub pages", () => {
  assert.equal(parseGitHubUrl("https://github.com/owner/repo/issues/1"), null);
});
