#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry === name) {
      return full;
    }
  }
  return null;
}

async function compileCore() {
  const compileDir = await mkdtemp(join(tmpdir(), "pi-rewind-compile-"));
  const typeRoot = join(compileDir, "types");
  await mkdir(join(typeRoot, "node"), { recursive: true });
  await writeFile(join(typeRoot, "node", "index.d.ts"), `
declare namespace NodeJS {
  interface ProcessEnv { [key: string]: string | undefined; }
}
declare const process: { env: NodeJS.ProcessEnv };
declare module "child_process" { export function spawn(command: string, args?: readonly string[], options?: any): any; }
declare module "crypto" { export function createHash(algorithm: string): { update(data: string): any; digest(encoding: "hex"): string; }; }
declare module "fs" {
  export interface Stats { isFile(): boolean; isDirectory(): boolean; size: number; }
  export interface Dirent { name: string; isDirectory(): boolean; isFile(): boolean; }
  export function statSync(path: string): Stats;
  export function readdirSync(path: string, options?: any): Dirent[];
}
declare module "fs/promises" {
  export function mkdtemp(prefix: string): Promise<string>;
  export function mkdir(path: string, options?: any): Promise<void>;
  export function readFile(path: string, encoding: string): Promise<string>;
  export function realpath(path: string): Promise<string>;
  export function rm(path: string, options?: any): Promise<void>;
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>;
}
declare module "os" { export function homedir(): string; export function tmpdir(): string; }
declare module "path" { export function dirname(path: string): string; export function join(...parts: string[]): string; export function relative(from: string, to: string): string; }
`, "utf8");

  const outDir = join(compileDir, "dist");
  run("tsc", [
    "--target", "ES2022",
    "--module", "commonjs",
    "--moduleResolution", "node",
    "--skipLibCheck",
    "--typeRoots", typeRoot,
    "--rootDir", repoDir,
    "--outDir", outDir,
    join(repoDir, "core.ts"),
  ], repoDir);

  const compiled = findFile(outDir, "core.js");
  assert.ok(compiled, "compiled core.js should exist");
  return { core: require(compiled), compileDir };
}

async function testRealGitRepo(core, root) {
  await mkdir(root, { recursive: true });
  run("git", ["init"], root);
  await writeFile(join(root, "tracked.txt"), "initial\n", "utf8");
  run("git", ["add", "tracked.txt"], root);
  run("git", ["-c", "user.name=pi-rewind-test", "-c", "user.email=test@example.invalid", "commit", "-m", "init"], root);
  await writeFile(join(root, "note.txt"), "keep me\n", "utf8");

  const cp = await core.createCheckpoint({
    root,
    id: "real-session-cp1",
    sessionId: "real-session",
    trigger: "resume",
    turnIndex: 0,
    description: "real repo baseline",
  });

  await writeFile(join(root, "tracked.txt"), "changed\n", "utf8");
  await writeFile(join(root, "generated.txt"), "remove me\n", "utf8");
  await core.restoreCheckpoint(root, cp);

  assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "initial\n", "tracked file should restore");
  assert.equal(await readFile(join(root, "note.txt"), "utf8"), "keep me\n", "preexisting untracked file should stay");
  assert.equal(existsSync(join(root, "generated.txt")), false, "new untracked file should be removed");
}

async function testSyntheticRepo(core, root) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "a.txt"), "one\n", "utf8");

  const synthetic = await core.initSyntheticGitRepo(root);
  try {
    assert.equal(synthetic.root, await realpath(root), "synthetic root should be real worktree path");
    const expectedStorageBase = await realpath(join(homedir(), ".pi", "agent", "pi-rewind", "workspaces"));
    assert.ok(
      synthetic.storageDir.startsWith(expectedStorageBase),
      "synthetic storage should live under ~/.pi/agent/pi-rewind/workspaces",
    );
    assert.ok(synthetic.gitDir.endsWith("/.git"), "synthetic git dir should be a .git directory");
    assert.ok(existsSync(synthetic.gitDir), "synthetic git dir should exist");
    assert.ok(existsSync(join(synthetic.storageDir, "metadata.json")), "metadata.json should exist");

    const cp = await core.createCheckpoint({
      root: synthetic.root,
      gitDir: synthetic.gitDir,
      id: "synthetic-session-cp1",
      sessionId: "synthetic-session",
      trigger: "resume",
      turnIndex: 0,
      description: "synthetic baseline",
    });

    const loaded = await core.loadAllCheckpoints(synthetic.root, "synthetic-session", synthetic.gitDir);
    assert.equal(loaded.some((item) => item.id === cp.id), true, "synthetic checkpoints should load from external git dir");

    await writeFile(join(root, "a.txt"), "two\n", "utf8");
    await writeFile(join(root, "b.txt"), "new\n", "utf8");
    await core.restoreCheckpoint(synthetic.root, cp, synthetic.gitDir);

    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "one\n", "synthetic tracked content should restore");
    assert.equal(existsSync(join(root, "b.txt")), false, "synthetic restore should delete files added after checkpoint");
  } finally {
    await rm(synthetic.storageDir, { recursive: true, force: true });
  }
}

async function testSyntheticStorageInsideWorktree(core, root) {
  await mkdir(root, { recursive: true });
  const originalHome = process.env.HOME;
  process.env.HOME = root;
  try {
    await writeFile(join(root, "a.txt"), "one\n", "utf8");
    const synthetic = await core.initSyntheticGitRepo(root);
    const realRoot = await realpath(root);
    assert.ok(
      synthetic.storageDir.startsWith(join(realRoot, ".pi", "agent", "pi-rewind", "workspaces")),
      "test setup should place synthetic storage inside the worktree",
    );

    const cp = await core.createCheckpoint({
      root: synthetic.root,
      gitDir: synthetic.gitDir,
      id: "inside-storage-cp1",
      sessionId: "inside-storage-session",
      trigger: "resume",
      turnIndex: 0,
      description: "storage inside worktree baseline",
    });
    const treeFiles = await core.git(`ls-tree -r --name-only ${cp.worktreeTreeSha}`, synthetic.root, { gitDir: synthetic.gitDir });
    assert.equal(
      treeFiles.split("\n").some((file) => file.startsWith(".pi/")),
      false,
      "synthetic storage under the worktree must not be snapshotted",
    );

    await writeFile(join(root, "new.txt"), "remove me\n", "utf8");
    await core.restoreCheckpoint(synthetic.root, cp, synthetic.gitDir);
    assert.ok(existsSync(synthetic.gitDir), "restore must not clean pi-rewind's own external git dir");
    assert.equal(existsSync(join(root, "new.txt")), false, "restore should still clean normal new files");
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
}

async function testCommandSourceDoesNotUseMissingStateRoot() {
  const commands = await readFile(join(repoDir, "commands.ts"), "utf8");
  assert.equal(commands.includes("state.root"), false, "/rewind branch display should not reference missing state.root");
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "pi-rewind-test-"));
  const { core, compileDir } = await compileCore();
  try {
    await testRealGitRepo(core, join(tempRoot, "real"));
    await testSyntheticRepo(core, join(tempRoot, "plain"));
    await testSyntheticStorageInsideWorktree(core, join(tempRoot, "home-worktree"));
    await testCommandSourceDoesNotUseMissingStateRoot();
    console.log("pi-rewind core tests passed");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(compileDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
