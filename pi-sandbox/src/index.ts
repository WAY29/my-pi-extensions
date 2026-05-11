/**
 * Based on https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/sandbox/index.ts
 * by Mario Zechner, used under the MIT License.
 *
 * Sandbox Extension - OS-level sandboxing for bash commands, plus path policy
 * enforcement for pi's direct filesystem tools, with interactive
 * permission prompts and cooperative write locks for extensions like plan-mode.
 *
 * Uses @carderne/sandbox-runtime to initialize filesystem and network
 * restrictions for bash commands at the OS level (sandbox-exec on macOS,
 * bubblewrap on Linux), then installs a shared bash operations wrapper so other
 * bash customizations can compose with sandboxing. Also intercepts the read, write, and edit tools
 * to apply the same denyRead/denyWrite/allowWrite filesystem rules, which
 * OS-level sandboxing cannot cover (those tools run directly in Node.js, not in
 * a subprocess). Extensions can request a session write lock via
 * `pi-sandbox:set-read-only-lock` to deny writes globally or under a cwd without disabling tools.
 *
 * When a block is triggered, the user is prompted to:
 *   (a) Abort (keep blocked)
 *   (b) Allow for this session only  — stored in memory, agent cannot access
 *   (c) Allow for this project       — written to .pi/sandbox.json
 *   (d) Allow for all projects       — written to ~/.pi/agent/sandbox.json
 *
 * What gets prompted vs. hard-blocked:
 *   - domains: prompted if not whitelisted nor explicitly denied
 *   - direct write/edit tools: prompted if not whitelisted nor explicitly denied
 *   - bash writes: blocked by the OS sandbox, then prompted and retried when the blocked path can be detected
 *   - read: if allowRead is empty, only denyRead paths prompt; if allowRead has entries, reads outside allowRead prompt
 *
 * IMPORTANT — read policy:
 *   Read:  with denyRead only, denyRead is a blacklist and all other paths are allowed
 *   Read:  with both denyRead and allowRead, allowRead keeps the existing whitelist-style prompt behavior
 *   Write: denyWrite OVERRIDES allowWrite (most-specific deny wins)
 *
 * Config files (merged, project takes precedence):
 * - ~/.pi/agent/sandbox.json (global)
 * - <cwd>/.pi/sandbox.json  (project-local)
 *
 * Example .pi/sandbox.json:
 * ```json
 * {
 *   "enabled": true,
 *   "network": {
 *     "allowedDomains": ["github.com", "*.github.com"],
 *     "deniedDomains": []
 *   },
 *   "filesystem": {
 *     "denyRead": ["/Users", "/home"],
 *     "allowRead": [".", "~/.config", "~/.local", "Library"],
 *     "allowWrite": [".", "/tmp"],
 *     "denyWrite": [".env"]
 *   }
 * }
 * ```
 *
 * Usage:
 * - `pi -e ./sandbox` - sandbox enabled with default/config settings
 * - `pi -e ./sandbox --no-sandbox` - disable sandboxing
 * - `/sandbox` - show current sandbox configuration
 *
 * Setup:
 * 1. Copy sandbox/ directory to ~/.pi/agent/extensions/
 * 2. Run `npm install` in ~/.pi/agent/extensions/sandbox/
 *
 * Linux also requires: bubblewrap, socat, ripgrep
 */

import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { spawn } from "node:child_process";
import fs from "node:fs";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { BlockList, isIP } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SandboxManager,
  type SandboxAskCallback,
  type SandboxRuntimeConfig,
} from "@carderne/sandbox-runtime";
import { encodeSandboxedCommand } from "@carderne/sandbox-runtime/dist/sandbox/sandbox-utils.js";
import {
  type BashOperations,
  createBashToolDefinition,
  getAgentDir,
  getShellConfig,
  isToolCallEventType,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import fsPromises from "node:fs/promises";

import { ensureBashToolRegistered, registerBashToolPlugin } from "../../bash-tool-coordinator";
import { createDirectLinuxSandboxCommand } from "./direct-linux-sandbox";
import {
  createDirectMacSandboxCommand,
  type DirectMacSandboxViolation,
  type IgnoreViolationsConfig,
  startDirectMacSandboxLogMonitor,
} from "./direct-macos-sandbox";

interface SandboxConfig extends SandboxRuntimeConfig {
  enabled?: boolean;
}

const DEFAULT_CONFIG: SandboxConfig = {
  enabled: true,
  network: {
    allowedDomains: [
      "npmjs.org",
      "*.npmjs.org",
      "registry.npmjs.org",
      "registry.yarnpkg.com",
      "pypi.org",
      "*.pypi.org",
      "github.com",
      "*.github.com",
      "api.github.com",
      "raw.githubusercontent.com",
    ],
    deniedDomains: [],
  },
  filesystem: {
    denyRead: ["/Users", "/home"],
    allowRead: [".", "~/.config", "~/.local", "Library"],
    allowWrite: [".", "/tmp"],
    denyWrite: [".env", ".env.*", "*.pem", "*.key"],
  },
};

// @carderne/sandbox-runtime always allows a few diagnostic/temp write paths
// in addition to configured allowWrite entries. In global read-only lock mode,
// deny the filesystem-backed ones too so bash cannot use those escape hatches.
const READ_ONLY_LOCK_DENY_WRITE_PATHS = [
  "/tmp/claude",
  "/private/tmp/claude",
  join(homedir(), ".npm", "_logs"),
  join(homedir(), ".claude", "debug"),
];

// Pi must keep writing its own state while plan-mode is active: sessions,
// checkpoints, config changes, etc. This exception is process-local and only
// applies to global locks; cwd-scoped locks still protect their requested cwd.
const PROCESS_READ_ONLY_LOCK_ALLOW_WRITE_PATHS = [join(homedir(), ".pi", "agent")];

interface SandboxReadOnlyLockResponse {
  accepted: boolean;
  active: boolean;
  reason?: string;
}

type SandboxReadOnlyLockScope = "global" | "cwd";

interface SandboxReadOnlyLockRequest {
  owner?: string;
  enabled?: boolean;
  reason?: string;
  cwd?: string;
  scope?: SandboxReadOnlyLockScope;
  respond?: (response: SandboxReadOnlyLockResponse | Promise<SandboxReadOnlyLockResponse>) => void;
}

type MutableModule = Record<string, unknown>;
type AnyFunction = (this: unknown, ...args: any[]) => any;

let fsWriteApisPatched = false;
let readOnlyWriteLockDeniesWrite: ((target: unknown) => boolean) | undefined;
let writeLockBypassDepth = 0;

function describeFsTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (target instanceof URL) return target.toString();
  if (Buffer.isBuffer(target)) return target.toString("utf8");
  return undefined;
}

function getFsTargetPath(target: unknown): string | undefined {
  if (typeof target === "string") return resolve(target.replace(/^~(?=$|\/)/, homedir()));
  if (target instanceof URL && target.protocol === "file:") return resolve(fileURLToPath(target));
  if (Buffer.isBuffer(target)) return resolve(target.toString("utf8"));
  return undefined;
}

function isProcessWriteAllowedByPath(target: unknown): boolean {
  const targetPath = getFsTargetPath(target);
  if (!targetPath) return false;

  return PROCESS_READ_ONLY_LOCK_ALLOW_WRITE_PATHS.some((allowedPath) => {
    const resolvedAllowedPath = resolve(allowedPath);
    return targetPath === resolvedAllowedPath || targetPath.startsWith(resolvedAllowedPath + "/");
  });
}

function createReadOnlyWriteError(operation: string, target?: unknown): Error & { code: string } {
  const targetText = describeFsTarget(target);
  const error = new Error(
    `Sandbox read-only lock: ${operation} denied${targetText ? ` for "${targetText}"` : ""}`,
  ) as Error & { code: string };
  error.code = "ERR_PI_SANDBOX_READ_ONLY";
  return error;
}

function assertProcessWriteAllowed(operation: string, target?: unknown): void {
  if (writeLockBypassDepth === 0 && readOnlyWriteLockDeniesWrite?.(target)) {
    throw createReadOnlyWriteError(operation, target);
  }
}

function runWithWriteLockBypass<T>(fn: () => T): T {
  writeLockBypassDepth++;
  try {
    const result = fn();
    if (result && typeof (result as { finally?: unknown }).finally === "function") {
      return (result as unknown as Promise<unknown>).finally(() => {
        writeLockBypassDepth--;
      }) as T;
    }
    writeLockBypassDepth--;
    return result;
  } catch (error) {
    writeLockBypassDepth--;
    throw error;
  }
}

function isWriteFlag(flags: unknown): boolean {
  if (typeof flags === "number") {
    return Boolean(
      flags &
      (fs.constants.O_WRONLY |
        fs.constants.O_RDWR |
        fs.constants.O_APPEND |
        fs.constants.O_CREAT |
        fs.constants.O_TRUNC),
    );
  }

  if (typeof flags !== "string") return false;
  return flags.includes("+") || flags.startsWith("w") || flags.startsWith("a");
}

function patchMethod(
  target: MutableModule,
  method: string,
  wrap: (original: AnyFunction) => AnyFunction,
): void {
  const original = target[method];
  if (typeof original !== "function") return;
  target[method] = wrap(original as AnyFunction);
}

function patchPathMutation(target: MutableModule, method: string, targetArgIndex = 0): void {
  patchMethod(
    target,
    method,
    (original) =>
      function patchedPathMutation(this: unknown, ...args: unknown[]) {
        assertProcessWriteAllowed(method, args[targetArgIndex]);
        return original.apply(this, args);
      },
  );
}

function patchOpenMutation(target: MutableModule, method: string): void {
  patchMethod(
    target,
    method,
    (original) =>
      function patchedOpen(this: unknown, ...args: unknown[]) {
        if (isWriteFlag(args[1])) assertProcessWriteAllowed(method, args[0]);
        return original.apply(this, args);
      },
  );
}

function patchCreateWriteStream(target: MutableModule): void {
  patchMethod(
    target,
    "createWriteStream",
    (original) =>
      function patchedCreateWriteStream(this: unknown, ...args: unknown[]) {
        assertProcessWriteAllowed("createWriteStream", args[0]);
        return original.apply(this, args);
      },
  );
}

function patchFsWriteApis(deniesWrite: (target: unknown) => boolean): void {
  readOnlyWriteLockDeniesWrite = deniesWrite;
  if (fsWriteApisPatched) return;

  const fsModule = fs as unknown as MutableModule;
  const fsPromisesModule = fsPromises as unknown as MutableModule;
  const pathMutations: Array<[method: string, targetArgIndex?: number]> = [
    ["writeFile"],
    ["appendFile"],
    ["mkdir"],
    ["mkdtemp"],
    ["mkdtempDisposable"],
    ["rm"],
    ["unlink"],
    ["rmdir"],
    ["rename", 1],
    ["copyFile", 1],
    ["cp", 1],
    ["truncate"],
    ["chmod"],
    ["chown"],
    ["lchmod"],
    ["lchown"],
    ["utimes"],
    ["lutimes"],
    ["symlink", 1],
    ["link", 1],
  ];

  for (const [method, targetArgIndex] of pathMutations) {
    patchPathMutation(fsModule, method, targetArgIndex);
    patchPathMutation(fsModule, `${method}Sync`, targetArgIndex);
    patchPathMutation(fsPromisesModule, method, targetArgIndex);
  }

  patchOpenMutation(fsModule, "open");
  patchOpenMutation(fsModule, "openSync");
  patchOpenMutation(fsPromisesModule, "open");
  patchCreateWriteStream(fsModule);

  syncBuiltinESMExports();
  fsWriteApisPatched = true;
}

function loadConfig(cwd: string): SandboxConfig {
  const projectConfigPath = join(cwd, ".pi", "sandbox.json");
  const globalConfigPath = join(getAgentDir(), "sandbox.json");

  let globalConfig: Partial<SandboxConfig> = {};
  let projectConfig: Partial<SandboxConfig> = {};

  if (existsSync(globalConfigPath)) {
    try {
      globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
    } catch (e) {
      console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`);
    }
  }

  if (existsSync(projectConfigPath)) {
    try {
      projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
    } catch (e) {
      console.error(`Warning: Could not parse ${projectConfigPath}: ${e}`);
    }
  }

  return deepMerge(deepMerge(DEFAULT_CONFIG, globalConfig), projectConfig);
}

function deepMerge(base: SandboxConfig, overrides: Partial<SandboxConfig>): SandboxConfig {
  const result: SandboxConfig = { ...base };

  if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
  if (overrides.network) {
    result.network = { ...base.network, ...overrides.network };
  }
  if (overrides.filesystem) {
    result.filesystem = { ...base.filesystem, ...overrides.filesystem };
    if (
      overrides.filesystem.denyRead !== undefined &&
      overrides.filesystem.allowRead === undefined
    ) {
      // A config that specifies only denyRead opts into blacklist-only reads.
      // Do not inherit DEFAULT_CONFIG.allowRead and accidentally whitelist-gate reads.
      result.filesystem.allowRead = [];
    }
  }

  const extOverrides = overrides as {
    ignoreViolations?: Record<string, string[]>;
    enableWeakerNestedSandbox?: boolean;
    allowBrowserProcess?: boolean;
  };
  const extResult = result as {
    ignoreViolations?: Record<string, string[]>;
    enableWeakerNestedSandbox?: boolean;
    allowBrowserProcess?: boolean;
  };

  if (extOverrides.ignoreViolations) {
    extResult.ignoreViolations = extOverrides.ignoreViolations;
  }
  if (extOverrides.enableWeakerNestedSandbox !== undefined) {
    extResult.enableWeakerNestedSandbox = extOverrides.enableWeakerNestedSandbox;
  }
  if (extOverrides.allowBrowserProcess !== undefined) {
    extResult.allowBrowserProcess = extOverrides.allowBrowserProcess;
  }

  return result;
}

// ── Domain helpers ────────────────────────────────────────────────────────────

export function shouldPromptForWrite(
  path: string,
  allowWrite: string[],
  matchesPattern: (path: string, patterns: string[]) => boolean,
): boolean {
  // Secure default: empty allowWrite means deny-all writes (prompt every path).
  return allowWrite.length === 0 || !matchesPattern(path, allowWrite);
}

type ReadBlockReason = "allowRead" | "denyRead";

export function getReadBlockReason(
  path: string,
  denyRead: string[],
  allowRead: string[],
  sessionAllowRead: string[],
  matchesPattern: (path: string, patterns: string[]) => boolean,
): ReadBlockReason | null {
  if (matchesPattern(path, sessionAllowRead)) return null;

  if (allowRead.length > 0) {
    return matchesPattern(path, allowRead) ? null : "allowRead";
  }

  return matchesPattern(path, denyRead) ? "denyRead" : null;
}

function normalizeNetworkHost(host: string): string {
  const trimmed = host.trim().toLowerCase().replace(/\.$/, "");
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractDomainsFromCommand(command: string): string[] {
  const urlRegex = /https?:\/\/[^\s'"<>]+/gi;
  const domains = new Set<string>();
  let match;
  while ((match = urlRegex.exec(command)) !== null) {
    try {
      domains.add(normalizeNetworkHost(new URL(match[0]).hostname));
    } catch {
      // Ignore shell fragments that look URL-ish but are not valid URLs.
    }
  }
  return [...domains];
}

function cidrMatchesHost(host: string, cidr: string): boolean {
  const slashIndex = cidr.indexOf("/");
  if (slashIndex === -1) return false;

  const baseAddress = normalizeNetworkHost(cidr.slice(0, slashIndex));
  const prefixLength = Number(cidr.slice(slashIndex + 1));
  const family = isIP(baseAddress);
  const hostFamily = isIP(host);

  if (!family || family !== hostFamily || !Number.isInteger(prefixLength)) return false;
  if (prefixLength < 0 || prefixLength > (family === 4 ? 32 : 128)) return false;

  try {
    const blockList = new BlockList();
    const familyName = family === 4 ? "ipv4" : "ipv6";
    blockList.addSubnet(baseAddress, prefixLength, familyName);
    return blockList.check(host, familyName);
  } catch {
    return false;
  }
}

function domainMatchesPattern(domain: string, pattern: string): boolean {
  const host = normalizeNetworkHost(domain);
  const normalizedPattern = normalizeNetworkHost(pattern);

  if (normalizedPattern === "*") return true;
  if (normalizedPattern.includes("/")) return cidrMatchesHost(host, normalizedPattern);
  if (normalizedPattern.startsWith("*.")) {
    if (isIP(host)) return false;
    const base = normalizedPattern.slice(2);
    return host === base || host.endsWith("." + base);
  }
  return host === normalizedPattern;
}

function allowsAllDomains(allowedDomains: string[] | undefined): boolean {
  return allowedDomains?.includes("*") ?? false;
}

function domainIsAllowed(domain: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((p) => domainMatchesPattern(domain, p));
}

function createNetworkAskCallback(allowedDomains: string[]): SandboxAskCallback {
  return async ({ host }) => domainIsAllowed(host, allowedDomains);
}

// ── Sandbox violation analysis ───────────────────────────────────────────────

type FilesystemAccessKind = "read" | "write";

interface SandboxFilesystemViolation {
  path: string;
  access: FilesystemAccessKind;
}

interface SandboxRuntimeViolation {
  line: string;
  command?: string;
  encodedCommand?: string;
  timestamp?: Date | number | string;
}

interface BashResultLike {
  content: Array<TextContent | ImageContent>;
  details: unknown;
  isError: boolean;
}

interface SandboxViolationStoreLike {
  getViolationsForCommand(command: string): SandboxRuntimeViolation[];
}

interface SandboxManagerWithViolationStore {
  getSandboxViolationStore?: () => SandboxViolationStoreLike;
}

const directMacSandboxViolations: SandboxRuntimeViolation[] = [];
let stopDirectMacSandboxLogMonitor: (() => void) | undefined;

function rememberDirectMacSandboxViolation(violation: DirectMacSandboxViolation): void {
  directMacSandboxViolations.push(violation);
  if (directMacSandboxViolations.length > 100) {
    directMacSandboxViolations.splice(0, directMacSandboxViolations.length - 100);
  }
}

function getDirectMacSandboxViolationsForCommand(command: string): SandboxRuntimeViolation[] {
  const encodedCommand = encodeSandboxedCommand(command);
  return directMacSandboxViolations.filter(
    (violation) => violation.command === command || violation.encodedCommand === encodedCommand,
  );
}

function restartDirectMacSandboxLogMonitor(ignoreViolations?: IgnoreViolationsConfig): void {
  if (process.platform !== "darwin") return;
  stopDirectMacSandboxLogMonitor?.();
  directMacSandboxViolations.length = 0;
  stopDirectMacSandboxLogMonitor = startDirectMacSandboxLogMonitor(
    rememberDirectMacSandboxViolation,
    ignoreViolations,
  );
}

function stopDirectMacSandboxMonitoring(): void {
  stopDirectMacSandboxLogMonitor?.();
  stopDirectMacSandboxLogMonitor = undefined;
  directMacSandboxViolations.length = 0;
}

const SANDBOX_DENIAL_OUTPUT_PATTERN =
  /(?:Operation not permitted|Permission denied|Read-only file system)/i;
const MAX_SANDBOX_PERMISSION_RETRIES = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bashOutputLooksLikeSandboxDenial(content: Array<TextContent | ImageContent>): boolean {
  return content.some(
    (part) =>
      part.type === "text" &&
      typeof part.text === "string" &&
      SANDBOX_DENIAL_OUTPUT_PATTERN.test(part.text),
  );
}

function getViolationTimestampMs(violation: SandboxRuntimeViolation): number | undefined {
  if (violation.timestamp === undefined) return undefined;
  if (violation.timestamp instanceof Date) return violation.timestamp.getTime();
  if (typeof violation.timestamp === "number") return violation.timestamp;
  const parsed = Date.parse(violation.timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function getSandboxViolationsForCommand(
  command: string,
  sinceMs?: number,
): SandboxRuntimeViolation[] {
  const violations = [
    ...((SandboxManager as unknown as SandboxManagerWithViolationStore)
      .getSandboxViolationStore?.()
      .getViolationsForCommand(command) ?? []),
    ...getDirectMacSandboxViolationsForCommand(command),
  ];

  if (sinceMs === undefined) return violations;
  return violations.filter((violation) => {
    const timestampMs = getViolationTimestampMs(violation);
    return timestampMs !== undefined && timestampMs >= sinceMs;
  });
}

function parseSandboxFilesystemViolationLine(line: string): SandboxFilesystemViolation | null {
  // macOS sandbox logs are authoritative here, e.g.:
  //   bash(12345) deny(1) file-write-create /private/tmp/example
  //   cat(12345) deny(1) file-read-data /Users/example/secret
  const match = line.match(/\bdeny(?:\(\d+\))?\s+(file-(read|write)[^\s]*)\s+(.+)$/);
  if (!match) return null;

  let path = match[3].trim();
  if (
    (path.startsWith('"') && path.endsWith('"')) ||
    (path.startsWith("'") && path.endsWith("'"))
  ) {
    path = path.slice(1, -1);
  }
  if (!path.startsWith("/")) return null;

  return { path, access: match[2] as FilesystemAccessKind };
}

function getSandboxFilesystemViolationsForCommand(
  command: string,
  sinceMs?: number,
): SandboxFilesystemViolation[] {
  const filesystemViolations: SandboxFilesystemViolation[] = [];
  for (const violation of getSandboxViolationsForCommand(command, sinceMs)) {
    const filesystemViolation = parseSandboxFilesystemViolationLine(violation.line);
    if (filesystemViolation) filesystemViolations.push(filesystemViolation);
  }

  return filesystemViolations;
}

async function waitForSandboxFilesystemViolationsForCommand(
  command: string,
  sinceMs?: number,
): Promise<SandboxFilesystemViolation[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(50);
    const violations = getSandboxFilesystemViolationsForCommand(command, sinceMs);
    if (violations.length > 0) return violations;
  }

  return [];
}

function getFilesystemViolationKey(violation: SandboxFilesystemViolation): string {
  return `${violation.access}:${canonicalizePath(violation.path)}`;
}

function dedupeFilesystemViolations(
  violations: SandboxFilesystemViolation[],
): SandboxFilesystemViolation[] {
  const seen = new Set<string>();
  const deduped: SandboxFilesystemViolation[] = [];

  for (const violation of violations) {
    const key = getFilesystemViolationKey(violation);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(violation);
  }

  return deduped;
}

async function getFilesystemViolationsForFailedBashResult(
  command: string,
  content: Array<TextContent | ImageContent>,
  sinceMs: number,
): Promise<SandboxFilesystemViolation[] | null> {
  let violations = getSandboxFilesystemViolationsForCommand(command, sinceMs);
  if (violations.length > 0) return dedupeFilesystemViolations(violations);

  if (!bashOutputLooksLikeSandboxDenial(content)) return null;

  violations = await waitForSandboxFilesystemViolationsForCommand(command, sinceMs);
  return dedupeFilesystemViolations(violations);
}

// ── Path pattern matching ─────────────────────────────────────────────────────

function expandPath(filePath: string): string {
  const expanded = filePath.replace(/^~(?=$|\/)/, homedir());
  return resolve(expanded);
}

function canonicalizePath(filePath: string): string {
  const abs = expandPath(filePath);
  try {
    return realpathSync.native(abs);
  } catch {
    // For writes to paths that do not exist yet, resolve symlinks in the nearest
    // existing parent directory, then append the non-existent tail.
    const tail: string[] = [];
    let probe = abs;
    while (!existsSync(probe)) {
      const parent = dirname(probe);
      if (parent === probe) return abs;
      tail.unshift(basename(probe));
      probe = parent;
    }
    try {
      return resolve(realpathSync.native(probe), ...tail);
    } catch {
      return abs;
    }
  }
}

function matchesPattern(filePath: string, patterns: string[]): boolean {
  const abs = canonicalizePath(filePath);
  return patterns.some((p) => {
    const absP = p.includes("*") ? expandPath(p) : canonicalizePath(p);
    if (p.includes("*")) {
      const escaped = absP.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`).test(abs);
    }
    const sep = absP.endsWith("/") ? "" : "/";
    return abs === absP || abs.startsWith(absP + sep);
  });
}

// ── Config file updaters (Node.js process — not OS-sandboxed) ─────────────────

function getConfigPaths(cwd: string): {
  globalPath: string;
  projectPath: string;
} {
  return {
    globalPath: join(homedir(), ".pi", "agent", "sandbox.json"),
    projectPath: join(cwd, ".pi", "sandbox.json"),
  };
}

function readOrEmptyConfig(configPath: string): Partial<SandboxConfig> {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

function writeConfigFile(configPath: string, config: Partial<SandboxConfig>): void {
  runWithWriteLockBypass(() => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  });
}

function addDomainToConfig(configPath: string, domain: string): void {
  const config = readOrEmptyConfig(configPath);
  const existing = config.network?.allowedDomains ?? [];
  if (!existing.includes(domain)) {
    config.network = {
      ...config.network,
      allowedDomains: [...existing, domain],
      deniedDomains: config.network?.deniedDomains ?? [],
    };
    writeConfigFile(configPath, config);
  }
}

function addReadPathToConfig(configPath: string, pathToAdd: string): void {
  const config = readOrEmptyConfig(configPath);
  const existing = config.filesystem?.allowRead ?? [];
  if (!existing.includes(pathToAdd)) {
    config.filesystem = {
      ...config.filesystem,
      allowRead: [...existing, pathToAdd],
      denyRead: config.filesystem?.denyRead ?? [],
      allowWrite: config.filesystem?.allowWrite ?? [],
      denyWrite: config.filesystem?.denyWrite ?? [],
    };
    writeConfigFile(configPath, config);
  }
}

function addWritePathToConfig(configPath: string, pathToAdd: string): void {
  const config = readOrEmptyConfig(configPath);
  const existing = config.filesystem?.allowWrite ?? [];
  if (!existing.includes(pathToAdd)) {
    config.filesystem = {
      ...config.filesystem,
      allowWrite: [...existing, pathToAdd],
      denyRead: config.filesystem?.denyRead ?? [],
      denyWrite: config.filesystem?.denyWrite ?? [],
    };
    writeConfigFile(configPath, config);
  }
}

// ── Sandboxed bash ops ────────────────────────────────────────────────────────

function execSpawnedCommand(
  file: string,
  args: string[],
  cwd: string,
  { onData, signal, timeout, env }: Parameters<BashOperations["exec"]>[2],
  cleanup?: () => void,
): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let cleanupDone = false;

    const cleanupAfterSpawn = () => {
      if (cleanupDone) return;
      cleanupDone = true;
      try {
        cleanup?.();
      } catch {
        // cleanup is best-effort
      }
      try {
        SandboxManager.cleanupAfterCommand();
      } catch {
        // cleanup is best-effort
      }
    };

    if (timeout !== undefined && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      }, timeout * 1000);
    }

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      cleanupAfterSpawn();
      reject(err);
    });

    const onAbort = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      cleanupAfterSpawn();

      if (signal?.aborted) {
        reject(new Error("aborted"));
      } else if (timedOut) {
        reject(new Error(`timeout:${timeout}`));
      } else {
        resolve({ exitCode: code });
      }
    });
  });
}

function createSandboxedBashOps(
  shellPath?: string,
  fallback?: BashOperations,
  isEnabled: () => boolean = () => SandboxManager.isSandboxingEnabled(),
): BashOperations {
  return {
    async exec(command, cwd, options) {
      if (!existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }

      const { shell, args } = getShellConfig(shellPath);
      if (!isEnabled() || !SandboxManager.isSandboxingEnabled()) {
        if (fallback) return fallback.exec(command, cwd, options);
        return execSpawnedCommand(shell, [...args, command], cwd, options);
      }

      if (process.platform === "darwin") {
        const runtimeConfig = SandboxManager.getConfig() as
          | (SandboxRuntimeConfig & {
              allowPty?: boolean;
              allowBrowserProcess?: boolean;
              enableWeakerNetworkIsolation?: boolean;
              filesystem?: SandboxRuntimeConfig["filesystem"] & { allowGitConfig?: boolean };
            })
          | undefined;
        const commandSpec = createDirectMacSandboxCommand({
          command,
          shell,
          needsNetworkRestriction: runtimeConfig?.network?.allowedDomains !== undefined,
          httpProxyPort: SandboxManager.getProxyPort(),
          socksProxyPort: SandboxManager.getSocksProxyPort(),
          allowUnixSockets: runtimeConfig?.network?.allowUnixSockets,
          allowAllUnixSockets: runtimeConfig?.network?.allowAllUnixSockets,
          allowLocalBinding: runtimeConfig?.network?.allowLocalBinding,
          allowMachLookup: runtimeConfig?.network?.allowMachLookup,
          readConfig: SandboxManager.getFsReadConfig(),
          writeConfig: SandboxManager.getFsWriteConfig(),
          allowPty: runtimeConfig?.allowPty,
          allowBrowserProcess: runtimeConfig?.allowBrowserProcess,
          allowGitConfig: runtimeConfig?.filesystem?.allowGitConfig,
          enableWeakerNetworkIsolation: runtimeConfig?.enableWeakerNetworkIsolation,
        });
        return execSpawnedCommand(commandSpec.file, commandSpec.args, cwd, options);
      }

      if (process.platform === "linux") {
        const runtimeConfig = SandboxManager.getConfig() as
          | (SandboxRuntimeConfig & {
              filesystem?: SandboxRuntimeConfig["filesystem"] & { allowGitConfig?: boolean };
            })
          | undefined;
        const needsNetworkRestriction = runtimeConfig?.network?.allowedDomains !== undefined;
        if (needsNetworkRestriction) await SandboxManager.waitForNetworkInitialization();
        const commandSpec = await createDirectLinuxSandboxCommand({
          command,
          shell,
          needsNetworkRestriction,
          httpSocketPath: needsNetworkRestriction
            ? SandboxManager.getLinuxHttpSocketPath()
            : undefined,
          socksSocketPath: needsNetworkRestriction
            ? SandboxManager.getLinuxSocksSocketPath()
            : undefined,
          httpProxyPort: needsNetworkRestriction ? SandboxManager.getProxyPort() : undefined,
          socksProxyPort: needsNetworkRestriction ? SandboxManager.getSocksProxyPort() : undefined,
          readConfig: SandboxManager.getFsReadConfig(),
          writeConfig: SandboxManager.getFsWriteConfig(),
          enableWeakerNestedSandbox: runtimeConfig?.enableWeakerNestedSandbox,
          allowAllUnixSockets: runtimeConfig?.network?.allowAllUnixSockets,
          ripgrepConfig: runtimeConfig?.ripgrep,
          mandatoryDenySearchDepth: runtimeConfig?.mandatoryDenySearchDepth,
          allowGitConfig: runtimeConfig?.filesystem?.allowGitConfig,
          seccompConfig: runtimeConfig?.seccomp,
          abortSignal: options.signal,
        });
        return execSpawnedCommand(
          commandSpec.file,
          commandSpec.args,
          cwd,
          options,
          commandSpec.cleanup,
        );
      }

      const directCommand = [shell, ...args, command];
      return execSpawnedCommand(directCommand[0], directCommand.slice(1), cwd, options);
    },
  };
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerFlag("no-sandbox", {
    description: "Disable OS-level sandboxing for bash commands",
    type: "boolean",
    default: false,
  });

  const localCwd = process.cwd();
  const userShellPath = SettingsManager.create(localCwd).getShellPath();

  let sandboxEnabled = true;
  let sandboxInitialized = false;

  // Session-temporary allowances — held in JS memory, not accessible by the agent.
  // These are added on top of whatever is in the config files.
  const sessionAllowedDomains: string[] = [];
  const sessionAllowedReadPaths: string[] = [];
  const sessionAllowedWritePaths: string[] = [];

  const pendingSandboxedBash = new Map<
    string,
    { command: string; timeout?: number; startedAt: number }
  >();

  // Cooperative write locks from other extensions, e.g. plan-mode.
  // Locks can be global or scoped to a cwd while keeping the active tool set unchanged.
  const readOnlyWriteLocks = new Map<string, { scope: SandboxReadOnlyLockScope; cwd: string }>();
  let lastStatusContext: ExtensionContext | undefined;

  registerBashToolPlugin(pi, {
    id: "pi-sandbox",
    priority: -100,
    wrapOperations: (next) =>
      createSandboxedBashOps(userShellPath, next, () => sandboxEnabled && sandboxInitialized),
  });

  // ── Effective config helpers ────────────────────────────────────────────────

  function uniqueStrings(values: string[]): string[] {
    return [...new Set(values)];
  }

  function isReadOnlyWriteLocked(): boolean {
    return readOnlyWriteLocks.size > 0;
  }

  function hasGlobalReadOnlyWriteLock(): boolean {
    return [...readOnlyWriteLocks.values()].some((lock) => lock.scope === "global");
  }

  function getScopedReadOnlyWriteLockPaths(): string[] {
    return uniqueStrings(
      [...readOnlyWriteLocks.values()]
        .filter((lock) => lock.scope === "cwd")
        .map((lock) => lock.cwd),
    );
  }

  function matchesReadOnlyWriteLock(filePath: string): boolean {
    if (!isReadOnlyWriteLocked()) return false;
    if (hasGlobalReadOnlyWriteLock()) return true;

    const lockedPaths = getScopedReadOnlyWriteLockPaths();
    return lockedPaths.length > 0 && matchesPattern(filePath, lockedPaths);
  }

  function isProcessWriteDeniedByReadOnlyLock(target: unknown): boolean {
    if (!sandboxEnabled || !isReadOnlyWriteLocked()) return false;
    if (hasGlobalReadOnlyWriteLock()) return !isProcessWriteAllowedByPath(target);

    const targetPath = getFsTargetPath(target);
    return targetPath !== undefined && matchesReadOnlyWriteLock(targetPath);
  }

  function getReadOnlyWriteLockSignature(): string {
    return [...readOnlyWriteLocks]
      .map(([owner, lock]) => `${owner}:${lock.scope}:${lock.cwd}`)
      .sort()
      .join("|");
  }

  function describeReadOnlyWriteLocks(): string {
    if (readOnlyWriteLocks.size === 0) return "(none)";

    return [...readOnlyWriteLocks]
      .map(([owner, lock]) => `${owner}:${lock.scope === "cwd" ? lock.cwd : "global"}`)
      .join(", ");
  }

  patchFsWriteApis((target) => isProcessWriteDeniedByReadOnlyLock(target));

  function applyReadOnlyWriteLock(config: SandboxConfig): SandboxConfig {
    if (!isReadOnlyWriteLocked()) return config;

    const scopedDenyWrite = getScopedReadOnlyWriteLockPaths();
    const globalLocked = hasGlobalReadOnlyWriteLock();

    return {
      ...config,
      filesystem: {
        ...config.filesystem,
        allowWrite: globalLocked ? [] : (config.filesystem?.allowWrite ?? []),
        denyWrite: uniqueStrings([
          ...(config.filesystem?.denyWrite ?? []),
          ...scopedDenyWrite,
          ...(globalLocked ? READ_ONLY_LOCK_DENY_WRITE_PATHS : []),
        ]),
      },
    };
  }

  function getEffectiveConfig(cwd: string): SandboxConfig {
    return applyReadOnlyWriteLock(loadConfig(cwd));
  }

  function canUseSandbox(cwd: string): { ok: boolean; reason?: string } {
    if (pi.getFlag("no-sandbox") === true)
      return { ok: false, reason: "sandbox disabled via --no-sandbox" };
    if (!sandboxEnabled && lastStatusContext !== undefined) {
      return { ok: false, reason: "sandbox disabled for this session" };
    }

    const config = loadConfig(cwd);
    if (!config.enabled) return { ok: false, reason: "sandbox disabled via config" };

    const platform = process.platform;
    if (platform !== "darwin" && platform !== "linux") {
      return { ok: false, reason: `sandbox not supported on ${platform}` };
    }

    return { ok: true };
  }

  function updateSandboxStatus(ctx: ExtensionContext): void {
    lastStatusContext = ctx;
    if (!sandboxEnabled) {
      ctx.ui.setStatus("sandbox", undefined);
      return;
    }

    const config = getEffectiveConfig(ctx.cwd);
    const networkLabel = allowsAllDomains(config.network?.allowedDomains)
      ? "all domains"
      : `${config.network?.allowedDomains?.length ?? 0} domains`;
    const lockScopeLabel = hasGlobalReadOnlyWriteLock() ? "read-only" : "cwd write lock";
    const writeLabel = isReadOnlyWriteLocked()
      ? `${lockScopeLabel} (${readOnlyWriteLocks.size} lock${readOnlyWriteLocks.size === 1 ? "" : "s"})`
      : `${config.filesystem?.allowWrite?.length ?? 0} write paths`;
    ctx.ui.setStatus(
      "sandbox",
      ctx.ui.theme.fg("accent", `🔒 Sandbox: ${networkLabel}, ${writeLabel}`),
    );
  }

  async function setReadOnlyWriteLock(
    enabled: boolean,
    owner: string,
    cwd: string,
    scope: SandboxReadOnlyLockScope,
  ): Promise<SandboxReadOnlyLockResponse> {
    const availability = canUseSandbox(cwd);
    if (!availability.ok) {
      readOnlyWriteLocks.delete(owner);
      return { accepted: false, active: false, reason: availability.reason };
    }

    const previousLockSignature = getReadOnlyWriteLockSignature();
    if (enabled) {
      readOnlyWriteLocks.set(owner, { scope, cwd: canonicalizePath(cwd) });
    } else {
      readOnlyWriteLocks.delete(owner);
    }

    const active = isReadOnlyWriteLocked();
    if (sandboxInitialized && previousLockSignature !== getReadOnlyWriteLockSignature()) {
      await reinitializeSandbox(cwd);
    }
    if (lastStatusContext) updateSandboxStatus(lastStatusContext);

    return {
      accepted: true,
      active,
      reason: active ? `write lock active: ${describeReadOnlyWriteLocks()}` : undefined,
    };
  }

  pi.events.on("pi-sandbox:set-read-only-lock", (data: unknown) => {
    const request = data as SandboxReadOnlyLockRequest;
    const owner = request.owner || "unknown";
    const cwd = request.cwd || localCwd;
    const scope = request.scope === "cwd" ? "cwd" : "global";
    request.respond?.(setReadOnlyWriteLock(request.enabled === true, owner, cwd, scope));
  });

  function getEffectiveAllowedDomains(cwd: string): string[] {
    const config = getEffectiveConfig(cwd);
    return [...(config.network?.allowedDomains ?? []), ...sessionAllowedDomains];
  }

  function getEffectiveAllowWrite(cwd: string): string[] {
    if (hasGlobalReadOnlyWriteLock()) return [];
    const config = getEffectiveConfig(cwd);
    return [...(config.filesystem?.allowWrite ?? []), ...sessionAllowedWritePaths];
  }

  // ── Sandbox reinitialize ────────────────────────────────────────────────────
  // Called after granting a session/permanent allowance so the OS-level sandbox
  // picks up the new rules before the next bash subprocess starts.

  async function reinitializeSandbox(cwd: string): Promise<void> {
    if (!sandboxInitialized) return;
    const config = getEffectiveConfig(cwd);
    const configExt = config as unknown as {
      ignoreViolations?: Record<string, string[]>;
      allowBrowserProcess?: boolean;
    };
    try {
      const network = {
        ...config.network,
        allowedDomains: [...(config.network?.allowedDomains ?? []), ...sessionAllowedDomains],
        deniedDomains: config.network?.deniedDomains ?? [],
      };
      await runWithWriteLockBypass(async () => {
        await SandboxManager.reset();
        await SandboxManager.initialize(
          {
            network,
            filesystem: {
              ...config.filesystem,
              denyRead: config.filesystem?.denyRead ?? [],
              allowRead: [...(config.filesystem?.allowRead ?? []), ...sessionAllowedReadPaths],
              allowWrite: [
                ...(config.filesystem?.allowWrite ?? []),
                ...(isReadOnlyWriteLocked() ? [] : sessionAllowedWritePaths),
              ],
              denyWrite: config.filesystem?.denyWrite ?? [],
            },
            allowBrowserProcess: configExt.allowBrowserProcess,
            enableWeakerNetworkIsolation: true,
          },
          createNetworkAskCallback(network.allowedDomains),
          true,
        );
        restartDirectMacSandboxLogMonitor(configExt.ignoreViolations);
      });
    } catch (e) {
      console.error(`Warning: Failed to reinitialize sandbox: ${e}`);
    }
  }

  // ── UI prompts ──────────────────────────────────────────────────────────────

  type DomainPermissionAction = "abort" | "session" | "project" | "global";
  type FilesystemPermissionAction = "abort" | "session-file" | "session-dir" | "project" | "global";

  interface PromptOption<TAction extends string = DomainPermissionAction> {
    label: string;
    key: string;
    action: TAction;
    confirm?: boolean;
    hint?: string;
  }

  const DOMAIN_PERMISSION_OPTIONS: Array<PromptOption<DomainPermissionAction>> = [
    { label: "Allow for this session only", key: "s", action: "session" },
    { label: "Abort (keep blocked)", key: "esc", action: "abort" },
    {
      label: "Allow for this project",
      key: "P",
      action: "project",
      confirm: true,
      hint: "→ .pi/sandbox.json",
    },
    {
      label: "Allow for all projects",
      key: "A",
      action: "global",
      confirm: true,
      hint: "→ ~/.pi/agent/sandbox.json",
    },
  ];

  const FILESYSTEM_PERMISSION_OPTIONS: Array<PromptOption<FilesystemPermissionAction>> = [
    { label: "Allow this file for this session only", key: "s", action: "session-file" },
    { label: "Allow containing folder for this session only", key: "d", action: "session-dir" },
    { label: "Abort (keep blocked)", key: "esc", action: "abort" },
    {
      label: "Allow for this project",
      key: "P",
      action: "project",
      confirm: true,
      hint: "→ .pi/sandbox.json",
    },
    {
      label: "Allow for all projects",
      key: "A",
      action: "global",
      confirm: true,
      hint: "→ ~/.pi/agent/sandbox.json",
    },
  ];

  async function showPermissionPrompt<TAction extends string>(
    ctx: ExtensionContext,
    title: string,
    options: Array<PromptOption<TAction>>,
  ): Promise<TAction | "abort"> {
    if (!ctx.hasUI) return "abort";

    const result = await ctx.ui.custom<TAction | "abort">((tui, theme, _kb, done) => {
      let selectedIndex = 0;
      let pendingAction: TAction | "abort" | null = null;

      function resolve(action: TAction | "abort") {
        done(action);
      }

        return {
          render(width: number): string[] {
            const lines: string[] = [];
            lines.push(truncateToWidth(theme.fg("warning", title), width));
            lines.push("");

            for (let i = 0; i < options.length; i++) {
              const opt = options[i];
              const isSelected = i === selectedIndex;
              const isPending = pendingAction === opt.action;

              const prefix = isSelected ? " → " : "   ";
              const keyHint = theme.fg("accent", `[${opt.key}]`);
              let label = opt.label;

              if (opt.hint) {
                label += `  ${theme.fg("dim", opt.hint)}`;
              }

              if (isPending) {
                label += `  ${theme.fg("warning", "→ press Enter to confirm")}`;
              }

              const line = `${prefix}${keyHint} ${label}`;
              lines.push(truncateToWidth(line, width));
            }

            lines.push("");
            const footer = pendingAction
              ? "↑↓ navigate  enter confirm  esc cancel"
              : "↑↓ navigate  enter select  esc/ctrl+c cancel";
            lines.push(truncateToWidth(theme.fg("dim", footer), width));

            return lines;
          },

          handleInput(data: string): void {
            if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
              resolve("abort");
              return;
            }

            if (matchesKey(data, Key.enter)) {
              if (pendingAction) {
                resolve(pendingAction);
              } else {
                resolve(options[selectedIndex]?.action ?? "abort");
              }
              return;
            }

            if (matchesKey(data, Key.up)) {
              selectedIndex = Math.max(0, selectedIndex - 1);
              pendingAction = null;
              tui.requestRender();
              return;
            }
            if (matchesKey(data, Key.down)) {
              selectedIndex = Math.min(options.length - 1, selectedIndex + 1);
              pendingAction = null;
              tui.requestRender();
              return;
            }

            for (let i = 0; i < options.length; i++) {
              const opt = options[i];
              if (data === opt.key) {
                // Exact case match (uppercase P/A) → immediate
                resolve(opt.action);
                return;
              }
              if (data.toLowerCase() === opt.key.toLowerCase()) {
                // Lowercase match → confirmation required for P/A
                if (opt.confirm) {
                  pendingAction = opt.action;
                  selectedIndex = i;
                } else {
                  resolve(opt.action);
                }
                tui.requestRender();
                return;
              }
            }
          },

          invalidate(): void {
            // no-op
          },
        };
      });

    return result ?? "abort";
  }

  async function promptDomainBlock(
    ctx: ExtensionContext,
    domain: string,
  ): Promise<DomainPermissionAction> {
    return showPermissionPrompt(
      ctx,
      `🌐 Network blocked: "${domain}" is not in allowedDomains`,
      DOMAIN_PERMISSION_OPTIONS,
    );
  }

  async function promptReadBlock(
    ctx: ExtensionContext,
    filePath: string,
    reason: ReadBlockReason,
  ): Promise<FilesystemPermissionAction> {
    const reasonText = reason === "denyRead" ? "is in denyRead" : "is not in allowRead";
    return showPermissionPrompt(
      ctx,
      `📖 Read blocked: "${filePath}" ${reasonText}`,
      FILESYSTEM_PERMISSION_OPTIONS,
    );
  }

  async function promptWriteBlock(
    ctx: ExtensionContext,
    filePath: string,
  ): Promise<FilesystemPermissionAction> {
    return showPermissionPrompt(
      ctx,
      `📝 Write blocked: "${filePath}" is not in allowWrite`,
      FILESYSTEM_PERMISSION_OPTIONS,
    );
  }

  // ── Apply allowance choices ─────────────────────────────────────────────────

  async function applyDomainChoice(
    choice: Exclude<DomainPermissionAction, "abort">,
    domain: string,
    cwd: string,
  ): Promise<void> {
    const { globalPath, projectPath } = getConfigPaths(cwd);
    if (!sessionAllowedDomains.includes(domain)) sessionAllowedDomains.push(domain);
    if (choice === "project") addDomainToConfig(projectPath, domain);
    if (choice === "global") addDomainToConfig(globalPath, domain);
    await reinitializeSandbox(cwd);
  }

  function getSessionFilesystemAllowancePath(
    choice: FilesystemPermissionAction,
    filePath: string,
  ): string {
    return choice === "session-dir" ? dirname(filePath) : filePath;
  }

  async function applyReadChoice(
    choice: Exclude<FilesystemPermissionAction, "abort">,
    filePath: string,
    cwd: string,
  ): Promise<void> {
    const { globalPath, projectPath } = getConfigPaths(cwd);
    const sessionPath = getSessionFilesystemAllowancePath(choice, filePath);
    if (!sessionAllowedReadPaths.includes(sessionPath)) sessionAllowedReadPaths.push(sessionPath);
    if (choice === "project") addReadPathToConfig(projectPath, filePath);
    if (choice === "global") addReadPathToConfig(globalPath, filePath);
    await reinitializeSandbox(cwd);
  }

  async function applyWriteChoice(
    choice: Exclude<FilesystemPermissionAction, "abort">,
    filePath: string,
    cwd: string,
  ): Promise<void> {
    const { globalPath, projectPath } = getConfigPaths(cwd);
    const sessionPath = getSessionFilesystemAllowancePath(choice, filePath);
    if (!sessionAllowedWritePaths.includes(sessionPath)) sessionAllowedWritePaths.push(sessionPath);
    if (choice === "project") addWritePathToConfig(projectPath, filePath);
    if (choice === "global") addWritePathToConfig(globalPath, filePath);
    await reinitializeSandbox(cwd);
  }

  async function retrySandboxedBash(
    toolCallId: string,
    params: { command: string; timeout?: number },
    ctx: ExtensionContext,
  ) {
    const sandboxedBash = createBashToolDefinition(ctx.cwd, {
      operations: createSandboxedBashOps(userShellPath),
      shellPath: userShellPath,
    });

    try {
      const result = await sandboxedBash.execute(toolCallId, params, ctx.signal, undefined, ctx);
      return {
        content: result.content,
        details: result.details,
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        details: undefined,
        isError: true,
      };
    }
  }

  // ── user_bash — network pre-check ──────────────────────────────────────────

  pi.on("user_bash", async (event, ctx) => {
    if (!sandboxEnabled || !sandboxInitialized) return;

    const domains = extractDomainsFromCommand(event.command);
    const effectiveDomains = getEffectiveAllowedDomains(ctx.cwd);

    for (const domain of domains) {
      if (!domainIsAllowed(domain, effectiveDomains)) {
        const choice = await promptDomainBlock(ctx, domain);
        if (choice === "abort") {
          return {
            result: {
              output: `Blocked: "${domain}" is not in allowedDomains. Use /sandbox to review your config.`,
              exitCode: 1,
              cancelled: false,
              truncated: false,
            },
          };
        }
        await applyDomainChoice(choice, domain, ctx.cwd);
      }
    }

    return {
      operations: createSandboxedBashOps(
        userShellPath,
        undefined,
        () => sandboxEnabled && sandboxInitialized,
      ),
    };
  });

  // ── tool_call — sandbox bash, network pre-check, and path policy for direct filesystem tools

  pi.on("tool_call", async (event, ctx) => {
    if (!sandboxEnabled) return;

    const config = getEffectiveConfig(ctx.cwd);
    if (!config.enabled) return;

    const { projectPath, globalPath } = getConfigPaths(ctx.cwd);

    // Bash tool calls are executed by the shared bash tool operations wrapper.
    // This hook only does preflight prompting and records original commands for retry.
    if (sandboxInitialized && isToolCallEventType("bash", event)) {
      const originalCommand = event.input.command;
      const domains = extractDomainsFromCommand(originalCommand);
      const effectiveDomains = getEffectiveAllowedDomains(ctx.cwd);
      for (const domain of domains) {
        if (!domainIsAllowed(domain, effectiveDomains)) {
          const choice = await promptDomainBlock(ctx, domain);
          if (choice === "abort") {
            return {
              block: true,
              reason: `Network access to "${domain}" is blocked (not in allowedDomains).`,
            };
          }
          await applyDomainChoice(choice, domain, ctx.cwd);
        }
      }

      pendingSandboxedBash.set(event.toolCallId, {
        command: originalCommand,
        timeout: event.input.timeout,
        startedAt: Date.now(),
      });
      return;
    }

    // Path policy: read tool.
    //   - With configured allowRead entries, keep the existing whitelist-style prompt behavior.
    //   - With denyRead only, treat denyRead as a blacklist and allow other paths silently.
    //   - Session grants override either mode without changing the configured mode.
    if (isToolCallEventType("read", event)) {
      const filePath = canonicalizePath(event.input.path);
      const readBlockReason = getReadBlockReason(
        filePath,
        config.filesystem?.denyRead ?? [],
        config.filesystem?.allowRead ?? [],
        sessionAllowedReadPaths,
        matchesPattern,
      );

      if (readBlockReason) {
        const choice = await promptReadBlock(ctx, filePath, readBlockReason);
        if (choice === "abort") {
          return {
            block: true,
            reason: `Sandbox: read access denied for "${filePath}"`,
          };
        }
        await applyReadChoice(choice, filePath, ctx.cwd);
        // Allowed — fall through, tool runs.
        return;
      }
    }

    // Read-only locks deny matching direct filesystem mutation tools while keeping
    // non-writing and out-of-scope writing tools available.
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const path = canonicalizePath((event.input as { path: string }).path);
      if (matchesReadOnlyWriteLock(path)) {
        return {
          block: true,
          reason: `Sandbox read-only lock: write access denied for "${path}"`,
        };
      }
    }

    // Path policy: write/edit — prompt for allowWrite, hard-block for denyWrite.
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const path = canonicalizePath((event.input as { path: string }).path);
      const allowWrite = getEffectiveAllowWrite(ctx.cwd);
      const denyWrite = config.filesystem?.denyWrite ?? [];

      if (shouldPromptForWrite(path, allowWrite, matchesPattern)) {
        const choice = await promptWriteBlock(ctx, path);
        if (choice === "abort") {
          return {
            block: true,
            reason: `Sandbox: write access denied for "${path}" (not in allowWrite)`,
          };
        }
        await applyWriteChoice(choice, path, ctx.cwd);

        // denyWrite takes precedence — warn if it would still block.
        if (matchesPattern(path, denyWrite)) {
          ctx.ui.notify(
            `⚠️ "${path}" was added to allowWrite, but it is also in denyWrite and will remain blocked.\n` +
              `Check denyWrite in:\n  ${projectPath}\n  ${globalPath}`,
            "warning",
          );
          return {
            block: true,
            reason: `Sandbox: write access denied for "${path}" (also in denyWrite)`,
          };
        }

        // Allowed — fall through, tool runs.
        return;
      }

      if (matchesPattern(path, denyWrite)) {
        return {
          block: true,
          reason:
            `Sandbox: write access denied for "${path}" (in denyWrite). ` +
            `To change this, edit denyWrite in:\n  ${projectPath}\n  ${globalPath}`,
        };
      }
    }
  });

  type GrantedFilesystemAccess = { access: FilesystemAccessKind; path: string };

  function appendSandboxErrorResult(result: BashResultLike, text: string): BashResultLike {
    return {
      content: [
        ...result.content,
        {
          type: "text" as const,
          text,
        },
      ],
      details: result.details,
      isError: true,
    };
  }

  function deniedFilesystemViolationResult(
    result: BashResultLike,
    violation: SandboxFilesystemViolation,
    blockedPath: string,
    reason?: string,
  ): BashResultLike {
    return appendSandboxErrorResult(
      result,
      reason ?? `Sandbox: ${violation.access} access denied for "${blockedPath}"`,
    );
  }

  async function allowSandboxFilesystemViolation(
    violation: SandboxFilesystemViolation,
    result: BashResultLike,
    ctx: ExtensionContext,
  ): Promise<
    { allowed: true; granted: GrantedFilesystemAccess } | { allowed: false; result: BashResultLike }
  > {
    const blockedPath = canonicalizePath(violation.path);

    if (!ctx.hasUI || (violation.access === "write" && matchesReadOnlyWriteLock(blockedPath))) {
      return {
        allowed: false,
        result: deniedFilesystemViolationResult(result, violation, blockedPath),
      };
    }

    const config = getEffectiveConfig(ctx.cwd);
    const { projectPath, globalPath } = getConfigPaths(ctx.cwd);

    if (violation.access === "read") {
      const readBlockReason = getReadBlockReason(
        blockedPath,
        config.filesystem?.denyRead ?? [],
        config.filesystem?.allowRead ?? [],
        sessionAllowedReadPaths,
        matchesPattern,
      );
      if (!readBlockReason) {
        return {
          allowed: false,
          result: deniedFilesystemViolationResult(
            result,
            violation,
            blockedPath,
            `Sandbox: read access denied for "${blockedPath}", but this path already matches the read policy. ` +
              `Check the OS-level sandbox path normalization.`,
          ),
        };
      }

      const choice = await promptReadBlock(ctx, blockedPath, readBlockReason);
      if (choice === "abort") {
        return {
          allowed: false,
          result: deniedFilesystemViolationResult(result, violation, blockedPath),
        };
      }

      const grantedPath = getSessionFilesystemAllowancePath(choice, blockedPath);
      await applyReadChoice(choice, blockedPath, ctx.cwd);
      return { allowed: true, granted: { access: "read", path: grantedPath } };
    }

    const denyWrite = config.filesystem?.denyWrite ?? [];
    if (matchesPattern(blockedPath, denyWrite)) {
      return {
        allowed: false,
        result: deniedFilesystemViolationResult(
          result,
          violation,
          blockedPath,
          `Sandbox: write access denied for "${blockedPath}" (in denyWrite). ` +
            `To change this, edit denyWrite in:\n  ${projectPath}\n  ${globalPath}`,
        ),
      };
    }

    const allowWrite = getEffectiveAllowWrite(ctx.cwd);
    if (!shouldPromptForWrite(blockedPath, allowWrite, matchesPattern)) {
      return {
        allowed: false,
        result: deniedFilesystemViolationResult(
          result,
          violation,
          blockedPath,
          `Sandbox: write access denied for "${blockedPath}", but this path already matches allowWrite. ` +
            `Check the OS-level sandbox path normalization.`,
        ),
      };
    }

    const choice = await promptWriteBlock(ctx, blockedPath);
    if (choice === "abort") {
      return {
        allowed: false,
        result: deniedFilesystemViolationResult(result, violation, blockedPath),
      };
    }

    const grantedPath = getSessionFilesystemAllowancePath(choice, blockedPath);
    await applyWriteChoice(choice, blockedPath, ctx.cwd);
    return { allowed: true, granted: { access: "write", path: grantedPath } };
  }

  function notifySandboxRetry(ctx: ExtensionContext, granted: GrantedFilesystemAccess[]): void {
    if (granted.length === 1) {
      const [{ access, path }] = granted;
      const label = access === "read" ? "Read" : "Write";
      ctx.ui.notify(`${label} access granted for "${path}", retrying bash command`, "info");
      return;
    }

    ctx.ui.notify(`${granted.length} sandbox accesses granted, retrying bash command`, "info");
  }

  pi.on("tool_result", async (event, ctx) => {
    if (!sandboxEnabled || !sandboxInitialized) return;
    if (event.toolName !== "bash") return;
    if (!event.isError) return;

    const original = pendingSandboxedBash.get(event.toolCallId);
    pendingSandboxedBash.delete(event.toolCallId);
    if (!original) return;

    let currentResult: BashResultLike = {
      content: event.content,
      details: event.details,
      isError: true,
    };
    let executionStartedAt = original.startedAt;

    for (let attempt = 0; attempt < MAX_SANDBOX_PERMISSION_RETRIES; attempt++) {
      const violations = await getFilesystemViolationsForFailedBashResult(
        original.command,
        currentResult.content,
        executionStartedAt,
      );

      if (violations === null || violations.length === 0) {
        return attempt === 0 ? undefined : currentResult;
      }

      const granted: GrantedFilesystemAccess[] = [];
      for (const violation of violations) {
        const decision = await allowSandboxFilesystemViolation(violation, currentResult, ctx);
        if (!decision.allowed) return decision.result;
        granted.push(decision.granted);
      }

      notifySandboxRetry(ctx, granted);
      executionStartedAt = Date.now();
      currentResult = await retrySandboxedBash(event.toolCallId, original, ctx);
      if (!currentResult.isError) return currentResult;
    }

    return appendSandboxErrorResult(
      currentResult,
      `Sandbox: permission retry limit (${MAX_SANDBOX_PERMISSION_RETRIES}) reached for bash command.`,
    );
  });

  // ── session_start ───────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    lastStatusContext = ctx;
    ensureBashToolRegistered(pi, ctx.cwd);
    const noSandbox = pi.getFlag("no-sandbox") as boolean;

    if (noSandbox) {
      sandboxEnabled = false;
      stopDirectMacSandboxMonitoring();
      updateSandboxStatus(ctx);
      ctx.ui.notify("Sandbox disabled via --no-sandbox", "warning");
      return;
    }

    const config = getEffectiveConfig(ctx.cwd);

    if (!config.enabled) {
      sandboxEnabled = false;
      stopDirectMacSandboxMonitoring();
      updateSandboxStatus(ctx);
      ctx.ui.notify("Sandbox disabled via config", "info");
      return;
    }

    const platform = process.platform;
    if (platform !== "darwin" && platform !== "linux") {
      sandboxEnabled = false;
      updateSandboxStatus(ctx);
      ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");
      return;
    }

    try {
      const configExt = config as unknown as {
        ignoreViolations?: Record<string, string[]>;
        enableWeakerNestedSandbox?: boolean;
        allowBrowserProcess?: boolean;
      };

      await runWithWriteLockBypass(async () => {
        await SandboxManager.initialize(
          {
            network: config.network,
            filesystem: config.filesystem,
            ignoreViolations: configExt.ignoreViolations,
            enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox,
            allowBrowserProcess: configExt.allowBrowserProcess,
            enableWeakerNetworkIsolation: true,
          },
          createNetworkAskCallback(config.network?.allowedDomains ?? []),
          true,
        );
        restartDirectMacSandboxLogMonitor(configExt.ignoreViolations);
      });

      // Make Node's built-in fetch() honour HTTP_PROXY / HTTPS_PROXY in this
      // process and any child processes that inherit the environment.
      // NODE_USE_ENV_PROXY avoids NODE_OPTIONS allowlisting issues on older Node
      // versions while still propagating naturally to child `node` processes.
      // fetch() supports this on Node 22.21.0+ and 24.0.0+.
      const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
      const supportsEnvProxy = (nodeMajor === 22 && nodeMinor >= 21) || nodeMajor >= 24;
      if (supportsEnvProxy) {
        process.env.NODE_USE_ENV_PROXY ??= "1";
      }

      sandboxEnabled = true;
      sandboxInitialized = true;
      updateSandboxStatus(ctx);
    } catch (err) {
      sandboxEnabled = false;
      stopDirectMacSandboxMonitoring();
      updateSandboxStatus(ctx);
      ctx.ui.notify(
        `Sandbox initialization failed: ${err instanceof Error ? err.message : err}`,
        "error",
      );
    }
  });

  // ── session_shutdown ────────────────────────────────────────────────────────

  pi.on("session_shutdown", async () => {
    pendingSandboxedBash.clear();
    stopDirectMacSandboxMonitoring();
    if (sandboxInitialized) {
      try {
        await runWithWriteLockBypass(() => SandboxManager.reset());
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ── /sandbox command ────────────────────────────────────────────────────────

  pi.registerCommand("sandbox-enable", {
    description: "Enable the sandbox for this session",
    handler: async (_args, ctx) => {
      if (sandboxEnabled) {
        ctx.ui.notify("Sandbox is already enabled", "info");
        return;
      }

      const config = getEffectiveConfig(ctx.cwd);
      const platform = process.platform;
      if (platform !== "darwin" && platform !== "linux") {
        ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");
        return;
      }

      try {
        const configExt = config as unknown as {
          ignoreViolations?: Record<string, string[]>;
          enableWeakerNestedSandbox?: boolean;
          allowBrowserProcess?: boolean;
        };

        await runWithWriteLockBypass(async () => {
          await SandboxManager.initialize(
            {
              network: config.network,
              filesystem: config.filesystem,
              ignoreViolations: configExt.ignoreViolations,
              enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox,
              allowBrowserProcess: configExt.allowBrowserProcess,
              enableWeakerNetworkIsolation: true,
            },
            createNetworkAskCallback(config.network?.allowedDomains ?? []),
            true,
          );
          restartDirectMacSandboxLogMonitor(configExt.ignoreViolations);
        });

        sandboxEnabled = true;
        sandboxInitialized = true;
        updateSandboxStatus(ctx);
        ctx.ui.notify("Sandbox enabled", "info");
      } catch (err) {
        ctx.ui.notify(
          `Sandbox initialization failed: ${err instanceof Error ? err.message : err}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("sandbox-disable", {
    description: "Disable the sandbox for this session",
    handler: async (_args, ctx) => {
      if (!sandboxEnabled) {
        ctx.ui.notify("Sandbox is already disabled", "info");
        return;
      }

      stopDirectMacSandboxMonitoring();
      if (sandboxInitialized) {
        try {
          await runWithWriteLockBypass(() => SandboxManager.reset());
        } catch {
          // Ignore cleanup errors
        }
      }

      sandboxEnabled = false;
      sandboxInitialized = false;
      updateSandboxStatus(ctx);
      ctx.ui.notify("Sandbox disabled", "info");
    },
  });

  pi.registerCommand("sandbox", {
    description: "Show sandbox configuration",
    handler: async (_args, ctx) => {
      if (!sandboxEnabled) {
        ctx.ui.notify("Sandbox is disabled", "info");
        return;
      }

      const config = loadConfig(ctx.cwd);
      const { globalPath, projectPath } = getConfigPaths(ctx.cwd);

      const lines = [
        "Sandbox Configuration",
        `  Project config: ${projectPath}`,
        `  Global config:  ${globalPath}`,
        "",
        "Network (bash + !cmd):",
        `  Allowed domains: ${config.network?.allowedDomains?.join(", ") || "(none)"}`,
        `  Denied domains:  ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
        ...(sessionAllowedDomains.length > 0
          ? [`  Session allowed: ${sessionAllowedDomains.join(", ")}`]
          : []),
        "",
        "Filesystem (bash + direct filesystem tools):",
        `  Read-only locks: ${describeReadOnlyWriteLocks()}`,
        `  Deny Read:   ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
        `  Allow Read:  ${config.filesystem?.allowRead?.join(", ") || "(none)"}`,
        `  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(none)"}`,
        `  Deny Write:  ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
        ...(sessionAllowedReadPaths.length > 0
          ? [`  Session read files/dirs:  ${sessionAllowedReadPaths.join(", ")}`]
          : []),
        ...(sessionAllowedWritePaths.length > 0
          ? [`  Session write files/dirs: ${sessionAllowedWritePaths.join(", ")}`]
          : []),
        "",
        "Note: If Allow Read is empty, reads are only prompted when matching Deny Read.",
        "Note: If Allow Read has entries, reads are prompted unless the path matches Allow Read.",
        "Note: denyRead prompts can be overridden by granting read access.",
        "Note: session filesystem grants may apply to a single file or its containing folder.",
        "Note: denyWrite takes PRECEDENCE over allowWrite and is never prompted.",
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
