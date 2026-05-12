import test from "node:test";

import assert from "node:assert/strict";

import { parseSandboxFilesystemViolationLine } from "../src/sandbox-violation-parser.ts";

test("parses standard file-read violations emitted by ln source checks", () => {
  assert.deepEqual(
    parseSandboxFilesystemViolationLine(
      "ln(84186) deny(1) file-read-metadata /private/tmp/pi-ln-src-read-84183",
    ),
    {
      access: "read",
      path: "/private/tmp/pi-ln-src-read-84183",
    },
  );
});

test("parses hard-link write violations emitted for the source path", () => {
  assert.deepEqual(
    parseSandboxFilesystemViolationLine(
      "ln(75926) deny(1) forbidden-link-priv<file-write*> /private/tmp/pi-ln-src3-75919 /private/tmp/pi-ln-dst3-75919",
    ),
    {
      access: "write",
      path: "/private/tmp/pi-ln-src3-75919",
    },
  );
});

test("keeps parsing ordinary write-create violations for ln destinations", () => {
  assert.deepEqual(
    parseSandboxFilesystemViolationLine(
      "ln(76470) deny(1) file-write-create /private/tmp/pi-ln-dst4-76451",
    ),
    {
      access: "write",
      path: "/private/tmp/pi-ln-dst4-76451",
    },
  );
});
