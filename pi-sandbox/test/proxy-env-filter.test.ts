import test from "node:test";

import assert from "node:assert/strict";

import { omitNoProxyEnvVars } from "../src/proxy-env-filter.ts";

test("omits sandbox-injected NO_PROXY variables while preserving proxy settings", () => {
  assert.deepEqual(
    omitNoProxyEnvVars([
      "SANDBOX_RUNTIME=1",
      "NO_PROXY=localhost,10.0.0.0/8",
      "HTTP_PROXY=http://localhost:1234",
      "no_proxy=localhost,10.0.0.0/8",
      "ALL_PROXY=socks5h://localhost:5678",
    ]),
    ["SANDBOX_RUNTIME=1", "HTTP_PROXY=http://localhost:1234", "ALL_PROXY=socks5h://localhost:5678"],
  );
});
