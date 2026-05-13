import { generateProxyEnvVars } from "@carderne/sandbox-runtime/dist/sandbox/sandbox-utils.js";

import { omitNoProxyEnvVars } from "./proxy-env-filter";

export function generateSandboxProxyEnvVars(
  httpProxyPort?: number,
  socksProxyPort?: number,
): string[] {
  return omitNoProxyEnvVars(generateProxyEnvVars(httpProxyPort, socksProxyPort));
}
