import test from "node:test";

import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  DEFAULT_PI_SANDBOX_TMPDIR,
  generateSandboxProxyEnvVars,
  getSandboxTmpdir,
} from "../src/proxy-env.ts";

test("uses /tmp/pi-sandbox as the default sandbox TMPDIR", () => {
  const previousTmpdir = process.env.PI_SANDBOX_TMPDIR;
  delete process.env.PI_SANDBOX_TMPDIR;

  try {
    assert.equal(getSandboxTmpdir(), DEFAULT_PI_SANDBOX_TMPDIR);
    assert.ok(generateSandboxProxyEnvVars().includes(`TMPDIR=${DEFAULT_PI_SANDBOX_TMPDIR}`));
  } finally {
    if (previousTmpdir === undefined) delete process.env.PI_SANDBOX_TMPDIR;
    else process.env.PI_SANDBOX_TMPDIR = previousTmpdir;
  }
});

test("uses PI_SANDBOX_TMPDIR and creates the directory before injection", () => {
  const previousTmpdir = process.env.PI_SANDBOX_TMPDIR;
  const sandboxTmpdir = join(tmpdir(), `pi-sandbox-test-${process.pid}`);
  rmSync(sandboxTmpdir, { recursive: true, force: true });
  process.env.PI_SANDBOX_TMPDIR = sandboxTmpdir;

  try {
    assert.deepEqual(
      generateSandboxProxyEnvVars().filter((envVar) => envVar.startsWith("TMPDIR=")),
      [`TMPDIR=${sandboxTmpdir}`],
    );
    assert.ok(existsSync(sandboxTmpdir));
  } finally {
    rmSync(sandboxTmpdir, { recursive: true, force: true });
    if (previousTmpdir === undefined) delete process.env.PI_SANDBOX_TMPDIR;
    else process.env.PI_SANDBOX_TMPDIR = previousTmpdir;
  }
});
