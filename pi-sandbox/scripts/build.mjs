import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/index.js",
  external: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "@earendil-works/pi-ai",
  ],
  legalComments: "none",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

await mkdir("dist/vendor", { recursive: true });

for (const source of [
  join("node_modules", "@carderne", "sandbox-runtime", "vendor"),
  join("node_modules", "@carderne", "sandbox-runtime", "dist", "vendor"),
]) {
  await cp(source, "dist/vendor", { recursive: true, force: true }).catch(() => {});
}