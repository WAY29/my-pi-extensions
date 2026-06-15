import { mkdirSync } from "node:fs";

import { generateProxyEnvVars } from "@carderne/sandbox-runtime/dist/sandbox/sandbox-utils.js";

import { omitNoProxyEnvVars } from "./proxy-env-filter.ts";

export const DEFAULT_PI_SANDBOX_TMPDIR = "/tmp/pi-sandbox";

export function getSandboxTmpdir(): string {
  return process.env.PI_SANDBOX_TMPDIR || DEFAULT_PI_SANDBOX_TMPDIR;
}

function ensureSandboxTmpdir(): string {
  const tmpdir = getSandboxTmpdir();
  mkdirSync(tmpdir, { recursive: true, mode: 0o700 });
  return tmpdir;
}

export function generateSandboxProxyEnvVars(
  httpProxyPort?: number,
  socksProxyPort?: number,
): string[] {
  const tmpdir = ensureSandboxTmpdir();
  let sawTmpdir = false;
  const envVars = omitNoProxyEnvVars(generateProxyEnvVars(httpProxyPort, socksProxyPort)).map(
    (envVar) => {
      if (!envVar.startsWith("TMPDIR=")) return envVar;
      sawTmpdir = true;
      return `TMPDIR=${tmpdir}`;
    },
  );

  if (!sawTmpdir) envVars.splice(1, 0, `TMPDIR=${tmpdir}`);
  return envVars;
}
