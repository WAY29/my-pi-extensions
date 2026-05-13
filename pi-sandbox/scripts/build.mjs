import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

await removeBundledNoProxyEnv("dist/index.js");

async function removeBundledNoProxyEnv(filePath) {
  const source = await readFile(filePath, "utf-8");
  const patched = source
    .replace(/\n  envVars\.push\(`NO_PROXY=\$\{noProxyAddresses\}`\);/g, "")
    .replace(/\n  envVars\.push\(`no_proxy=\$\{noProxyAddresses\}`\);/g, "");

  if (patched === source) {
    throw new Error(`Expected bundled sandbox-runtime NO_PROXY injection in ${filePath}`);
  }

  await writeFile(filePath, patched);
}

async function copyIfExists(source, destination) {
  try {
    await access(source);
  } catch {
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

for (const arch of ["x64", "arm64"]) {
  for (const sourceRoot of [
    join("node_modules", "@carderne", "sandbox-runtime", "vendor"),
    join("node_modules", "@carderne", "sandbox-runtime", "dist", "vendor"),
  ]) {
    await copyIfExists(
      join(sourceRoot, "seccomp", arch, "apply-seccomp"),
      join("dist", "vendor", "seccomp", arch, "apply-seccomp"),
    );
  }
}
