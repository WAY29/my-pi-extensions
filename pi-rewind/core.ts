/**
 * pi-rewind — Core git operations
 *
 * Pure git functions with zero pi-coding-agent dependency.
 * Independently testable, safe to import from anywhere.
 */

import { createHash } from "crypto";
import { spawn } from "child_process";
import { statSync, readdirSync } from "fs";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import { dirname, join, relative } from "path";

// ============================================================================
// Constants & Types
// ============================================================================

export const ZEROS = "0".repeat(40);
export const REF_BASE = "refs/pi-checkpoints";

/** Maximum size for untracked files to include in snapshot (10 MiB) */
export const MAX_UNTRACKED_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum files in an untracked directory before skipping (200) */
export const MAX_UNTRACKED_DIR_FILES = 200;

/** Default max checkpoints kept by manual cleanup commands */
export const DEFAULT_MAX_CHECKPOINTS = 200;

/** Auto-clean only removes missing-path synthetic workspaces after this grace period. */
export const MISSING_WORKSPACE_GRACE_MS = 24 * 60 * 60 * 1000;

/** Directories to exclude from snapshots (matched against any path component) */
export const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".venv",
  "venv",
  "env",
  ".env",
  "dist",
  "build",
  ".pytest_cache",
  ".mypy_cache",
  ".cache",
  ".tox",
  "__pycache__",
]);

/** Tools that modify the filesystem and warrant a checkpoint */
export const MUTATING_TOOLS = new Set(["write", "edit", "bash"]);

export interface CheckpointData {
  /** Unique checkpoint ID (used as git ref name) */
  id: string;
  /** Session this checkpoint belongs to */
  sessionId: string;
  /** What triggered this checkpoint */
  trigger: "turn" | "tool" | "resume" | "before-restore";
  /** Turn index when checkpoint was created */
  turnIndex: number;
  /** Tool name if trigger === "tool" */
  toolName?: string;
  /** Human-readable description (prompt text, tool args, etc.) */
  description?: string;
  /** Git branch name at snapshot time */
  branch: string;
  /** SHA of HEAD at snapshot time */
  headSha: string;
  /** SHA of the real git index tree */
  indexTreeSha: string;
  /** SHA of the full worktree tree (index + untracked) */
  worktreeTreeSha: string;
  /** Epoch ms when created */
  timestamp: number;
  /** Untracked files present when snapshot was taken (for safe restore) */
  preexistingUntrackedFiles?: string[];
  /** Files skipped because > 10 MiB */
  skippedLargeFiles?: string[];
  /** Directories skipped because >= 200 files */
  skippedLargeDirs?: string[];
}

export interface SyntheticGitRepo {
  /** Real path to the directory being snapshotted */
  root: string;
  /** pi-rewind-owned bare git directory */
  gitDir: string;
  /** Directory containing the bare git dir and metadata */
  storageDir: string;
  /** Stable key derived from root */
  key: string;
}

export interface SyntheticWorkspaceMetadata {
  formatVersion?: number;
  key?: string;
  worktreePath: string;
  gitDir?: string;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface SyntheticWorkspaceInfo {
  key: string;
  storageDir: string;
  metadataPath: string;
  gitDir: string;
  valid: boolean;
  error?: string;
  metadata?: SyntheticWorkspaceMetadata;
  worktreePath?: string;
  worktreeExists: boolean;
  lastUsedAtMs: number;
  sizeBytes: number;
  checkpointCount: number;
}

export interface SyntheticWorkspaceListOptions {
  includeSizeBytes?: boolean;
  includeCheckpointCount?: boolean;
}

export interface MissingWorkspaceCleanupResult {
  deleted: SyntheticWorkspaceInfo[];
  skipped: SyntheticWorkspaceInfo[];
  bytesFreed: number;
}

export interface WorkspaceCleanupResult {
  checkpointCountBefore: number;
  checkpointCountAfter: number;
  pruned: number;
  gc: "synthetic-prune-now" | "real-auto";
}

export interface AllSyntheticCleanupResult {
  deletedMissing: SyntheticWorkspaceInfo[];
  cleanedExisting: Array<SyntheticWorkspaceInfo & { pruned: number }>;
  skippedInvalid: SyntheticWorkspaceInfo[];
  bytesFreed: number;
}

// ============================================================================
// Git helpers
// ============================================================================

/** Options for running git. gitDir points at a pi-rewind-owned bare repo. */
export interface GitOptions {
  env?: NodeJS.ProcessEnv;
  input?: string;
  gitDir?: string | null;
}

function runGit(args: string[], cwd: string, opts: GitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const finalArgs = opts.gitDir
      ? [`--git-dir=${opts.gitDir}`, `--work-tree=${cwd}`, ...args]
      : args;
    const proc = spawn("git", finalArgs, {
      cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `git ${args[0] ?? "command"} failed (code ${code})`));
    });
    proc.on("error", reject);

    if (opts.input && proc.stdin) {
      proc.stdin.write(opts.input);
      proc.stdin.end();
    } else if (proc.stdin) {
      proc.stdin.end();
    }
  });
}

/**
 * Run a git command via spawn (no shell injection).
 * `cmd` is parsed into args respecting quotes.
 */
export function git(
  cmd: string,
  cwd: string,
  opts: GitOptions = {},
): Promise<string> {
  return runGit(parseArgs(cmd), cwd, opts);
}

function parseArgs(cmd: string): string[] {
  const args: string[] = [];
  let cur = "";
  let sq = false;
  let dq = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'" && !dq) sq = !sq;
    else if (c === '"' && !sq) dq = !dq;
    else if (c === " " && !sq && !dq) {
      if (cur) { args.push(cur); cur = ""; }
    } else cur += c;
  }
  if (cur) args.push(cur);
  return args;
}

export const isGitRepo = (cwd: string) =>
  git("rev-parse --is-inside-work-tree", cwd).then(() => true).catch(() => false);

export const getRepoRoot = (cwd: string) =>
  git("rev-parse --show-toplevel", cwd);

function hasGitHead(gitDir: string): boolean {
  try {
    return statSync(join(gitDir, "HEAD")).isFile();
  } catch {
    return false;
  }
}

/**
 * Create or reuse pi-rewind's external git database for a non-git directory.
 * The user's directory remains untouched; git data lives under ~/.pi/agent/pi-rewind.
 */
export async function initSyntheticGitRepo(cwd: string): Promise<SyntheticGitRepo> {
  const root = await realpath(cwd);
  const key = createHash("sha256").update(root).digest("hex").slice(0, 32);
  const storageDirPath = join(getSyntheticWorkspacesDir(), key);
  await mkdir(storageDirPath, { recursive: true });

  const storageDir = await realpath(storageDirPath);
  const gitDir = join(storageDir, ".git");

  if (!hasGitHead(gitDir)) {
    await runGit(["init", "--bare", gitDir], root);
  }

  const now = new Date().toISOString();
  const metadataPath = join(storageDir, "metadata.json");
  let createdAt = now;
  try {
    const existing = JSON.parse(await readFile(metadataPath, "utf8")) as { createdAt?: unknown };
    if (typeof existing.createdAt === "string") createdAt = existing.createdAt;
  } catch {
    // Missing or invalid metadata is harmless; rewrite it below.
  }

  await writeFile(
    metadataPath,
    JSON.stringify({ formatVersion: 1, key, worktreePath: root, gitDir, createdAt, lastUsedAt: now }, null, 2) + "\n",
    "utf8",
  );

  return { root, gitDir, storageDir, key };
}

export function getSyntheticWorkspacesDir(): string {
  return join(homedir(), ".pi", "agent", "pi-rewind", "workspaces");
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function parseTimeMs(value: unknown): number {
  if (typeof value !== "string") return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

interface FsDirentLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

function directorySizeBytes(path: string): number {
  let total = 0;
  const walk = (dir: string) => {
    let entries: FsDirentLike[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) total += statSync(full).size;
      } catch {
        // Ignore racing deletes and permission errors.
      }
    }
  };
  walk(path);
  return total;
}

async function readSyntheticWorkspace(
  storageDir: string,
  options: SyntheticWorkspaceListOptions = {},
): Promise<SyntheticWorkspaceInfo> {
  const key = storageDir.split(/[/\\]/).filter(Boolean).pop() || "unknown";
  const metadataPath = join(storageDir, "metadata.json");
  const fallbackGitDir = join(storageDir, ".git");
  const sizeBytes = options.includeSizeBytes ? directorySizeBytes(storageDir) : 0;

  let metadata: SyntheticWorkspaceMetadata | undefined;
  try {
    const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as Partial<SyntheticWorkspaceMetadata>;
    if (typeof parsed.worktreePath !== "string" || parsed.worktreePath.length === 0) {
      throw new Error("metadata missing worktreePath");
    }
    metadata = {
      ...parsed,
      worktreePath: parsed.worktreePath,
      gitDir: typeof parsed.gitDir === "string" ? parsed.gitDir : fallbackGitDir,
    };
  } catch (err) {
    return {
      key,
      storageDir,
      metadataPath,
      gitDir: fallbackGitDir,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
      worktreeExists: false,
      lastUsedAtMs: 0,
      sizeBytes,
      checkpointCount: 0,
    };
  }

  const worktreeExists = pathExists(metadata.worktreePath);
  const lastUsedAtMs = parseTimeMs(metadata.lastUsedAt) || parseTimeMs(metadata.createdAt);
  let checkpointCount = 0;
  if (options.includeCheckpointCount) {
    try {
      const gitRoot = worktreeExists ? metadata.worktreePath : storageDir;
      checkpointCount = (await listCheckpointRefs(gitRoot, metadata.gitDir)).length;
    } catch {
      checkpointCount = 0;
    }
  }

  return {
    key,
    storageDir,
    metadataPath,
    gitDir: metadata.gitDir || fallbackGitDir,
    valid: true,
    metadata,
    worktreePath: metadata.worktreePath,
    worktreeExists,
    lastUsedAtMs,
    sizeBytes,
    checkpointCount,
  };
}

export async function listSyntheticWorkspaces(
  options: SyntheticWorkspaceListOptions = {},
): Promise<SyntheticWorkspaceInfo[]> {
  const root = getSyntheticWorkspacesDir();
  let entries: FsDirentLike[] = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const workspaces: SyntheticWorkspaceInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    workspaces.push(await readSyntheticWorkspace(join(root, entry.name), options));
  }
  return workspaces;
}

export async function cleanupMissingSyntheticWorkspaces(
  graceMs: number = MISSING_WORKSPACE_GRACE_MS,
  nowMs: number = Date.now(),
): Promise<MissingWorkspaceCleanupResult> {
  const deleted: SyntheticWorkspaceInfo[] = [];
  const skipped: SyntheticWorkspaceInfo[] = [];
  let bytesFreed = 0;

  for (const workspace of await listSyntheticWorkspaces()) {
    if (!workspace.valid || workspace.worktreeExists) {
      skipped.push(workspace);
      continue;
    }
    const ageMs = workspace.lastUsedAtMs > 0 ? nowMs - workspace.lastUsedAtMs : Number.POSITIVE_INFINITY;
    if (ageMs < graceMs) {
      skipped.push(workspace);
      continue;
    }
    const sizeBytes = directorySizeBytes(workspace.storageDir);
    const deletedWorkspace = { ...workspace, sizeBytes };
    await rm(workspace.storageDir, { recursive: true, force: true });
    deleted.push(deletedWorkspace);
    bytesFreed += sizeBytes;
  }

  return { deleted, skipped, bytesFreed };
}

// ============================================================================
// Path filtering
// ============================================================================

/** Returns true if any path component is in IGNORED_DIR_NAMES */
export function shouldIgnoreForSnapshot(path: string): boolean {
  return path.split(/[/\\]/).some((c) => IGNORED_DIR_NAMES.has(c));
}

/** Returns true if file exceeds MAX_UNTRACKED_FILE_SIZE */
export function isLargeFile(root: string, rel: string): boolean {
  try {
    const s = statSync(join(root, rel));
    return s.isFile() && s.size > MAX_UNTRACKED_FILE_SIZE;
  } catch { return false; }
}

/** Returns true if directory contains >= MAX_UNTRACKED_DIR_FILES files */
export function isLargeDirectory(root: string, rel: string): boolean {
  try {
    const full = join(root, rel);
    const s = statSync(full);
    if (!s.isDirectory()) return false;
    return countFiles(full, MAX_UNTRACKED_DIR_FILES) >= MAX_UNTRACKED_DIR_FILES;
  } catch { return false; }
}

function countFiles(dir: string, max: number): number {
  let n = 0;
  const walk = (d: string) => {
    if (n > max) return;
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (n > max) return;
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.isFile()) n++;
      }
    } catch { /* permission errors */ }
  };
  walk(dir);
  return n;
}

function normalizeGitPath(p: string): string {
  let n = p.replace(/\\/g, "/");
  if (n.startsWith("./")) n = n.slice(2);
  return n.replace(/\/$/, "");
}

function isPathWithin(path: string, dir: string): boolean {
  if (!dir || dir === ".") return true;
  if (path === dir) return true;
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  return path.startsWith(prefix);
}

function isPathWithinAny(path: string, dirs: Set<string>): boolean {
  for (const d of dirs) if (isPathWithin(path, d)) return true;
  return false;
}

function getInternalStorageDirs(root: string, gitDir?: string | null): Set<string> {
  if (!gitDir) return new Set();
  const storageDir = dirname(gitDir);
  const rel = normalizeGitPath(relative(root, storageDir));
  if (!rel || rel === "." || rel.startsWith("..")) return new Set();
  return new Set([rel]);
}

function shouldSkipSnapshotPath(path: string, internalDirs: Set<string>): boolean {
  return shouldIgnoreForSnapshot(path) || isPathWithinAny(path, internalDirs);
}

// ============================================================================
// Status snapshot (what files need snapshotting)
// ============================================================================

interface StatusSnapshot {
  trackedPaths: string[];
  untrackedFiles: string[];
  untrackedFilesForIndex: string[];
  untrackedDirs: string[];
  skippedLargeFiles: string[];
}

async function captureStatusSnapshot(root: string, gitDir?: string | null): Promise<StatusSnapshot> {
  const snap: StatusSnapshot = {
    trackedPaths: [],
    untrackedFiles: [],
    untrackedFilesForIndex: [],
    untrackedDirs: [],
    skippedLargeFiles: [],
  };

  const output = await git("status --porcelain=2 -z --untracked-files=all", root, { gitDir }).catch(() => "");
  if (!output) return snap;

  const internalDirs = getInternalStorageDirs(root, gitDir);
  const entries = output.split("\0").filter(Boolean);
  let expectRename = false;

  for (const entry of entries) {
    if (expectRename) {
      const n = normalizeGitPath(entry);
      if (n && !shouldSkipSnapshotPath(n, internalDirs)) snap.trackedPaths.push(n);
      expectRename = false;
      continue;
    }

    const tag = entry[0];
    if (tag === "?" || tag === "!") {
      const sp = entry.indexOf(" ");
      if (sp === -1) continue;
      const raw = normalizeGitPath(entry.slice(sp + 1));
      if (!raw || shouldSkipSnapshotPath(raw, internalDirs)) continue;

      let st: ReturnType<typeof statSync> | null = null;
      try { st = statSync(join(root, raw)); } catch { st = null; }

      if (st?.isDirectory()) { snap.untrackedDirs.push(raw); continue; }

      snap.untrackedFiles.push(raw);
      const large = st?.isFile() ? st.size > MAX_UNTRACKED_FILE_SIZE : false;
      if (large) snap.skippedLargeFiles.push(raw);
      else snap.untrackedFilesForIndex.push(raw);
    } else if (tag === "1") {
      const p = extractField(entry, 8);
      if (p) {
        const n = normalizeGitPath(p);
        if (!shouldSkipSnapshotPath(n, internalDirs)) snap.trackedPaths.push(n);
      }
    } else if (tag === "2") {
      const p = extractField(entry, 9);
      if (p) {
        const n = normalizeGitPath(p);
        if (!shouldSkipSnapshotPath(n, internalDirs)) snap.trackedPaths.push(n);
      }
      expectRename = true;
    } else if (tag === "u") {
      const p = extractField(entry, 10);
      if (p) {
        const n = normalizeGitPath(p);
        if (!shouldSkipSnapshotPath(n, internalDirs)) snap.trackedPaths.push(n);
      }
    }
  }
  return snap;
}

function extractField(record: string, n: number): string | null {
  let spaces = 0;
  for (let i = 0; i < record.length; i++) {
    if (record[i] === " " && ++spaces === n) {
      const p = record.slice(i + 1);
      return p.length > 0 ? p : null;
    }
  }
  return null;
}

/** Detect directories with >= threshold untracked files */
function detectLargeDirs(files: string[], dirs: string[], threshold: number): string[] {
  if (threshold <= 0 || files.length === 0) return [];
  const counts = new Map<string, number>();

  const sortedDirs = [...dirs].sort((a, b) => {
    const da = a.split("/").length, db = b.split("/").length;
    return da !== db ? db - da : a.localeCompare(b);
  });

  for (const f of files) {
    let bucket: string | null = null;
    for (const d of sortedDirs) {
      if (isPathWithin(f, d)) { bucket = d; break; }
    }
    if (!bucket) {
      const parts = f.split("/");
      bucket = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
    }
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([k, v]) => v >= threshold && k !== ".")
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

interface FilesToAddResult {
  filtered: string[];
  allUntracked: string[];
  skippedLargeFiles: string[];
  skippedLargeDirs: string[];
}

async function getFilesToAdd(root: string, gitDir?: string | null): Promise<FilesToAddResult> {
  const status = await captureStatusSnapshot(root, gitDir);
  const largeDirs = detectLargeDirs(
    status.untrackedFiles,
    status.untrackedDirs,
    MAX_UNTRACKED_DIR_FILES,
  );
  const largeDirsSet = new Set(largeDirs);

  const untrackedForIndex = status.untrackedFilesForIndex
    .filter((p) => !isPathWithinAny(p, largeDirsSet));
  const skippedLargeFiles = status.skippedLargeFiles
    .filter((p) => !isPathWithinAny(p, largeDirsSet));

  const all = new Set<string>();
  status.trackedPaths.forEach((p) => all.add(p));
  untrackedForIndex.forEach((p) => all.add(p));

  return {
    filtered: [...all],
    allUntracked: status.untrackedFiles,
    skippedLargeFiles,
    skippedLargeDirs: largeDirs,
  };
}

// ============================================================================
// Checkpoint CRUD
// ============================================================================

export interface CreateCheckpointOpts {
  root: string;
  id: string;
  sessionId: string;
  trigger: CheckpointData["trigger"];
  turnIndex: number;
  toolName?: string;
  /** External bare git dir for non-git workspaces */
  gitDir?: string | null;
  /** Human-readable label (user prompt, tool args summary) */
  description?: string;
}

/**
 * Snapshot HEAD + index + worktree into a git ref.
 * Returns full checkpoint metadata.
 */
export async function createCheckpoint(opts: CreateCheckpointOpts): Promise<CheckpointData> {
  const { root, id, sessionId, trigger, turnIndex, toolName, gitDir, description } = opts;
  const timestamp = Date.now();
  const iso = new Date(timestamp).toISOString();

  const headSha = await git("rev-parse HEAD", root, { gitDir }).catch(() => ZEROS);
  const branch = await git("rev-parse --abbrev-ref HEAD", root, { gitDir }).catch(() => gitDir ? "pi-rewind" : "unknown");
  const indexTreeSha = await git("write-tree", root, { gitDir });

  const tmpDir = await mkdtemp(join(tmpdir(), "pi-rewind-"));
  const tmpIndex = join(tmpDir, "index");

  try {
    const tmpEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex };

    const { filtered, allUntracked, skippedLargeFiles, skippedLargeDirs } =
      await getFilesToAdd(root, gitDir);

    const largeDirsSet = new Set(skippedLargeDirs);
    const largeFilesSet = new Set(skippedLargeFiles);
    const preexistingUntrackedFiles = allUntracked.filter((f) => {
      if (shouldIgnoreForSnapshot(f)) return false;
      if (largeFilesSet.has(f)) return false;
      if (isPathWithinAny(f, largeDirsSet)) return false;
      return true;
    });

    // Seed temp index from HEAD
    if (headSha !== ZEROS) {
      await git(`read-tree ${headSha}`, root, { env: tmpEnv, gitDir });
    }

    // Add files in batches of 100
    const BATCH = 100;
    for (let i = 0; i < filtered.length; i += BATCH) {
      const batch = filtered.slice(i, i + BATCH);
      const paths = batch.map((f) => `"${f}"`).join(" ");
      await git(`add --all -- ${paths}`, root, { env: tmpEnv, gitDir });
    }

    const worktreeTreeSha = await git("write-tree", root, { env: tmpEnv, gitDir });

    // Build commit message with all metadata
    const msg = [
      `pi-rewind:${id}`,
      `sessionId ${sessionId}`,
      `trigger ${trigger}`,
      `turn ${turnIndex}`,
      toolName ? `toolName ${toolName}` : null,
      description ? `description ${description}` : null,
      `branch ${branch}`,
      `head ${headSha}`,
      `index-tree ${indexTreeSha}`,
      `worktree-tree ${worktreeTreeSha}`,
      `created ${iso}`,
      `untracked ${JSON.stringify(preexistingUntrackedFiles)}`,
      `largeFiles ${JSON.stringify(skippedLargeFiles)}`,
      `largeDirs ${JSON.stringify(skippedLargeDirs)}`,
    ].filter(Boolean).join("\n");

    const commitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "pi-rewind",
      GIT_AUTHOR_EMAIL: "rewind@pi",
      GIT_AUTHOR_DATE: iso,
      GIT_COMMITTER_NAME: "pi-rewind",
      GIT_COMMITTER_EMAIL: "rewind@pi",
      GIT_COMMITTER_DATE: iso,
    };

    const commitSha = await git(`commit-tree ${worktreeTreeSha}`, root, {
      input: msg,
      env: commitEnv,
      gitDir,
    });

    await git(`update-ref ${REF_BASE}/${id} ${commitSha}`, root, { gitDir });

    return {
      id,
      sessionId,
      trigger,
      turnIndex,
      toolName,
      description,
      branch,
      headSha,
      indexTreeSha,
      worktreeTreeSha,
      timestamp,
      preexistingUntrackedFiles,
      skippedLargeFiles: skippedLargeFiles.length > 0 ? skippedLargeFiles : undefined,
      skippedLargeDirs: skippedLargeDirs.length > 0 ? skippedLargeDirs : undefined,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Restore worktree + index to a checkpoint's state.
 * Safely preserves pre-existing untracked files and skipped large items.
 */
export async function restoreCheckpoint(
  root: string,
  cp: CheckpointData,
  gitDir?: string | null,
): Promise<void> {
  // Safety: verify we're on the same branch as when the checkpoint was created
  if (cp.branch) {
    const currentBranch = await git("rev-parse --abbrev-ref HEAD", root, { gitDir })
      .catch(() => gitDir ? "pi-rewind" : "unknown");
    if (currentBranch !== cp.branch) {
      throw new Error(
        `Branch mismatch: checkpoint was created on "${cp.branch}" but you are on "${currentBranch}". ` +
        `Switch to "${cp.branch}" first, or this restore could corrupt your worktree.`
      );
    }
  }
  // 1. Reset HEAD
  if (cp.headSha !== ZEROS) {
    await git(`reset --hard ${cp.headSha}`, root, { gitDir });
  }

  // 2. Restore worktree from snapshot tree
  await git(`read-tree --reset -u ${cp.worktreeTreeSha}`, root, { gitDir });

  // 3. Safe-clean new untracked files only
  await safeClean(
    root,
    cp.preexistingUntrackedFiles || [],
    cp.skippedLargeFiles || [],
    cp.skippedLargeDirs || [],
    gitDir,
  );

  // 4. Restore staged state without touching files
  await git(`read-tree --reset ${cp.indexTreeSha}`, root, { gitDir });
}

async function safeClean(
  root: string,
  preexisting: string[],
  skippedFiles: string[],
  skippedDirs: string[],
  gitDir?: string | null,
): Promise<void> {
  const output = await git("ls-files --others --exclude-standard", root, { gitDir }).catch(() => "");
  if (!output) return;
  const current = output.split("\n").filter(Boolean);
  if (current.length === 0) return;

  const preSet = new Set(preexisting);
  const sfSet = new Set(skippedFiles);
  const sdSet = new Set(skippedDirs);
  const internalDirs = getInternalStorageDirs(root, gitDir);

  const toRemove = current.filter((f) => {
    if (preSet.has(f)) return false;
    if (shouldSkipSnapshotPath(f, internalDirs)) return false;
    if (sfSet.has(f)) return false;
    if (isPathWithinAny(f, sdSet)) return false;
    return true;
  });

  if (toRemove.length === 0) return;

  const BATCH = 100;
  for (let i = 0; i < toRemove.length; i += BATCH) {
    const batch = toRemove.slice(i, i + BATCH);
    const paths = batch.map((f) => `"${f}"`).join(" ");
    await git(`clean -f -- ${paths}`, root, { gitDir }).catch(() => {});
  }
}

// ============================================================================
// Load / list checkpoints
// ============================================================================

/** Load checkpoint metadata from a git ref */
function parseCheckpointMessage(refName: string, msg: string): CheckpointData | null {
  const get = (key: string) =>
    msg.match(new RegExp(`^${key} (.+)$`, "m"))?.[1]?.trim();

  const sid = get("sessionId");
  const turn = get("turn");
  const head = get("head");
  const idx = get("index-tree");
  const wt = get("worktree-tree");
  if (!sid || !turn || !head || !idx || !wt) return null;

  const parseJson = (key: string): string[] | undefined => {
    const raw = get(key);
    if (!raw) return undefined;
    try {
      const arr = JSON.parse(raw);
      return arr.length > 0 ? arr : undefined;
    } catch { return undefined; }
  };

  return {
    id: refName,
    sessionId: sid,
    trigger: (get("trigger") as CheckpointData["trigger"]) || "turn",
    turnIndex: parseInt(turn, 10),
    toolName: get("toolName"),
    description: get("description"),
    branch: get("branch") || "unknown",
    headSha: head,
    indexTreeSha: idx,
    worktreeTreeSha: wt,
    timestamp: get("created") ? new Date(get("created")!).getTime() : 0,
    preexistingUntrackedFiles: parseJson("untracked"),
    skippedLargeFiles: parseJson("largeFiles"),
    skippedLargeDirs: parseJson("largeDirs"),
  };
}

export async function loadCheckpointFromRef(
  root: string,
  refName: string,
  gitDir?: string | null,
): Promise<CheckpointData | null> {
  try {
    const commitSha = await git(`rev-parse --verify ${REF_BASE}/${refName}`, root, { gitDir });
    const msg = await git(`cat-file commit ${commitSha}`, root, { gitDir });
    return parseCheckpointMessage(refName, msg);
  } catch {
    return null;
  }
}

/** List all checkpoint ref names under REF_BASE */
export async function listCheckpointRefs(root: string, gitDir?: string | null): Promise<string[]> {
  try {
    const prefix = `${REF_BASE}/`;
    const out = await git(`for-each-ref --format=%(refname) ${prefix}`, root, { gitDir });
    return out.split("\n").filter(Boolean).map((r) => r.replace(prefix, ""));
  } catch {
    return [];
  }
}

function refBelongsToSession(refName: string, sessionId?: string): boolean {
  if (!sessionId) return true;
  return (
    refName.startsWith(`resume-${sessionId}-`) ||
    refName.startsWith(`turn-${sessionId}-`) ||
    refName.startsWith(`before-restore-${sessionId}-`)
  );
}

/** List checkpoint ref names newest-first, optionally filtered by session ID from the ref name. */
export async function listCheckpointRefsByRecency(
  root: string,
  sessionId?: string,
  gitDir?: string | null,
): Promise<string[]> {
  try {
    const prefix = `${REF_BASE}/`;
    const out = await git(`for-each-ref --sort=-creatordate --format=%(refname) ${prefix}`, root, { gitDir });
    return out
      .split("\n")
      .filter(Boolean)
      .map((r) => r.replace(prefix, ""))
      .filter((r) => refBelongsToSession(r, sessionId));
  } catch {
    return [];
  }
}

function parseCheckpointForEachRefOutput(out: string, sessionId?: string): CheckpointData[] {
  const prefix = `${REF_BASE}/`;
  const parts = out.split("\0");
  const results: CheckpointData[] = [];

  for (let i = 0; i + 1 < parts.length; i += 2) {
    const fullRef = parts[i].replace(/^\n+/, "").trim();
    const msg = parts[i + 1];
    if (!fullRef.startsWith(prefix)) continue;
    const refName = fullRef.slice(prefix.length);
    const cp = parseCheckpointMessage(refName, msg);
    if (cp && (!sessionId || cp.sessionId === sessionId)) results.push(cp);
  }

  return results;
}

/** Load a checkpoint page from a precomputed ref-name list. */
export async function loadCheckpointPage(
  root: string,
  refs: string[],
  sessionId?: string,
  gitDir?: string | null,
): Promise<CheckpointData[]> {
  if (refs.length === 0) return [];
  try {
    const prefix = `${REF_BASE}/`;
    const patterns = refs.map((r) => `${prefix}${r}`).join(" ");
    const out = await git(`for-each-ref --sort=-creatordate --format=%(refname)%00%(contents)%00 ${patterns}`, root, { gitDir });
    return parseCheckpointForEachRefOutput(out, sessionId);
  } catch {
    return [];
  }
}

/** Load all checkpoints, optionally filtered by session */
export async function loadAllCheckpoints(
  root: string,
  sessionId?: string,
  gitDir?: string | null,
): Promise<CheckpointData[]> {
  try {
    const prefix = `${REF_BASE}/`;
    const out = await git(`for-each-ref --sort=-creatordate --format=%(refname)%00%(contents)%00 ${prefix}`, root, { gitDir });
    return parseCheckpointForEachRefOutput(out, sessionId);
  } catch {
    return [];
  }
}

async function deleteCheckpointRefs(
  root: string,
  ids: string[],
  gitDir?: string | null,
): Promise<void> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (uniqueIds.length === 0) return;
  const input = uniqueIds.map((id) => `delete ${REF_BASE}/${id}`).join("\n") + "\n";
  await runGit(["update-ref", "--stdin"], root, { input, gitDir }).catch(() => {});
}

/** Delete a checkpoint ref */
export async function deleteCheckpoint(root: string, id: string, gitDir?: string | null): Promise<void> {
  await deleteCheckpointRefs(root, [id], gitDir);
}

/** Prune oldest checkpoints for a session, keeping at most `max` */
export async function pruneCheckpoints(
  root: string,
  sessionId: string,
  max: number = DEFAULT_MAX_CHECKPOINTS,
  gitDir?: string | null,
): Promise<number> {
  const all = await loadAllCheckpoints(root, sessionId, gitDir);
  // Sort oldest first
  all.sort((a, b) => a.timestamp - b.timestamp);

  // Don't prune before-restore checkpoints — they're safety nets
  const prunable = all.filter((cp) => cp.trigger !== "before-restore");
  if (prunable.length <= max) return 0;

  const toDelete = prunable.slice(0, prunable.length - max);
  await deleteCheckpointRefs(root, toDelete.map((cp) => cp.id), gitDir);
  return toDelete.length;
}

/** Prune all pi-rewind checkpoints for a workspace, keeping the newest `max`. */
export async function pruneWorkspaceCheckpoints(
  root: string,
  max: number = DEFAULT_MAX_CHECKPOINTS,
  gitDir?: string | null,
): Promise<number> {
  const all = await loadAllCheckpoints(root, undefined, gitDir);
  all.sort((a, b) => a.timestamp - b.timestamp);
  if (all.length <= max) return 0;

  const toDelete = all.slice(0, all.length - max);
  await deleteCheckpointRefs(root, toDelete.map((cp) => cp.id), gitDir);
  return toDelete.length;
}

export async function runCheckpointGc(root: string, gitDir?: string | null): Promise<WorkspaceCleanupResult["gc"]> {
  if (gitDir) {
    await git("gc --prune=now", root, { gitDir });
    return "synthetic-prune-now";
  }
  await git("gc --auto", root);
  return "real-auto";
}

export async function cleanWorkspaceCheckpoints(
  root: string,
  gitDir?: string | null,
  max: number = DEFAULT_MAX_CHECKPOINTS,
): Promise<WorkspaceCleanupResult> {
  const checkpointCountBefore = (await listCheckpointRefs(root, gitDir)).length;
  const pruned = await pruneWorkspaceCheckpoints(root, max, gitDir);
  const gc = await runCheckpointGc(root, gitDir);
  const checkpointCountAfter = (await listCheckpointRefs(root, gitDir)).length;
  return { checkpointCountBefore, checkpointCountAfter, pruned, gc };
}

export async function cleanAllSyntheticWorkspaces(
  max: number = DEFAULT_MAX_CHECKPOINTS,
): Promise<AllSyntheticCleanupResult> {
  const deletedMissing: SyntheticWorkspaceInfo[] = [];
  const cleanedExisting: Array<SyntheticWorkspaceInfo & { pruned: number }> = [];
  const skippedInvalid: SyntheticWorkspaceInfo[] = [];
  let bytesFreed = 0;

  for (const workspace of await listSyntheticWorkspaces()) {
    if (!workspace.valid || !workspace.worktreePath) {
      skippedInvalid.push(workspace);
      continue;
    }

    if (!workspace.worktreeExists) {
      const sizeBytes = directorySizeBytes(workspace.storageDir);
      const deletedWorkspace = { ...workspace, sizeBytes };
      await rm(workspace.storageDir, { recursive: true, force: true });
      deletedMissing.push(deletedWorkspace);
      bytesFreed += sizeBytes;
      continue;
    }

    const pruned = await pruneWorkspaceCheckpoints(workspace.worktreePath, max, workspace.gitDir);
    await runCheckpointGc(workspace.worktreePath, workspace.gitDir);
    cleanedExisting.push({ ...workspace, pruned });
  }

  return { deletedMissing, cleanedExisting, skippedInvalid, bytesFreed };
}

/**
 * Prune checkpoints from all sessions except the current one.
 * Keeps only the most recent `keepPerOldSession` checkpoints per old session.
 * Returns total number of deleted checkpoints.
 */
export async function pruneOldSessions(
  root: string,
  currentSessionId: string,
  keepPerOldSession: number = 0,
  gitDir?: string | null,
): Promise<number> {
  const refs = await listCheckpointRefs(root, gitDir);
  let deleted = 0;

  // Group refs by session (parse sessionId from ref name without loading full commit)
  const bySession = new Map<string, string[]>();
  for (const ref of refs) {
    // Ref format: refs/pi-checkpoints/{type}-{sessionId}-{turnIndex}-{timestamp}
    // Extract sessionId: skip the type prefix, take the UUID part
    const name = ref.replace("refs/pi-checkpoints/", "");
    const parts = name.split("-");
    // UUID is 5 groups: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    // Find it after the trigger prefix (resume, turn, before-restore)
    let sessionId: string | null = null;
    for (let i = 0; i < parts.length - 5; i++) {
      const candidate = parts.slice(i + 1, i + 6).join("-");
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(candidate)) {
        sessionId = candidate;
        break;
      }
    }
    if (!sessionId || sessionId === currentSessionId) continue;

    if (!bySession.has(sessionId)) bySession.set(sessionId, []);
    bySession.get(sessionId)!.push(ref);
  }

  for (const [_sid, sessionRefs] of bySession) {
    // Sort by ref name (contains timestamp at end) — oldest first
    sessionRefs.sort();
    const toDelete = keepPerOldSession > 0
      ? sessionRefs.slice(0, Math.max(0, sessionRefs.length - keepPerOldSession))
      : sessionRefs;

    await deleteCheckpointRefs(root, toDelete, gitDir);
    deleted += toDelete.length;
  }

  return deleted;
}

/** Get a diff summary between two checkpoint trees */
export async function diffCheckpoints(
  root: string,
  fromTree: string,
  toTree: string,
  gitDir?: string | null,
): Promise<string> {
  try {
    // diff-tree compares two tree objects and works with tree SHAs or commit refs
    return await git(`diff-tree --stat --no-commit-id ${fromTree} ${toTree}`, root, { gitDir });
  } catch {
    return "(diff unavailable)";
  }
}

// ============================================================================
// Utilities
// ============================================================================

/** Validate ID contains only safe characters */
export const isSafeId = (id: string) => /^[\w-]+$/.test(id);

/** Sanitize a string for use in git ref names */
export function sanitizeForRef(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]/g, "_");
}

/** Find checkpoint closest to a target timestamp */
export function findClosestCheckpoint(
  checkpoints: CheckpointData[],
  targetTs: number,
): CheckpointData | undefined {
  if (checkpoints.length === 0) return undefined;
  return checkpoints.reduce((best, cp) => {
    const bd = Math.abs(best.timestamp - targetTs);
    const cd = Math.abs(cp.timestamp - targetTs);
    if (cp.timestamp <= targetTs && best.timestamp > targetTs) return cp;
    if (best.timestamp <= targetTs && cp.timestamp > targetTs) return best;
    return cd < bd ? cp : best;
  });
}
