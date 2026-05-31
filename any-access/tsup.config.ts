import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node18",
  outDir: "dist",
  clean: true,
  dts: true,
  sourcemap: false,
  bundle: true,
  splitting: false,
  treeshake: true,
  skipNodeModulesBundle: false,
  noExternal: [/.*/],
  external: [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "typebox",
  ],
});
