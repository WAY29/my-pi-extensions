import type { SeccompConfig } from "@carderne/sandbox-runtime/dist/sandbox/sandbox-config.js";

import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { getApplySeccompBinaryPath } from "@carderne/sandbox-runtime/dist/sandbox/generate-seccomp-filter.js";
import {
  DANGEROUS_FILES,
  generateProxyEnvVars,
  getDangerousDirectories,
  isSymlinkOutsideBoundary,
  normalizeCaseForComparison,
  normalizePathForSandbox,
} from "@carderne/sandbox-runtime/dist/sandbox/sandbox-utils.js";
import { logForDebugging } from "@carderne/sandbox-runtime/dist/utils/debug.js";
import { ripGrep, type RipgrepConfig } from "@carderne/sandbox-runtime/dist/utils/ripgrep.js";
import { whichSync } from "@carderne/sandbox-runtime/dist/utils/which.js";

const DEFAULT_MANDATORY_DENY_SEARCH_DEPTH = 3;

export interface FsReadRestrictionConfig {
  denyOnly: string[];
  allowWithinDeny?: string[];
}

export interface FsWriteRestrictionConfig {
  allowOnly: string[];
  denyWithinAllow?: string[];
}

export interface DirectLinuxSandboxCommand {
  file: string;
  args: string[];
  cleanup?: () => void;
}

export interface DirectLinuxSandboxParams {
  command: string;
  shell: string;
  needsNetworkRestriction: boolean;
  httpSocketPath?: string;
  socksSocketPath?: string;
  httpProxyPort?: number;
  socksProxyPort?: number;
  readConfig?: FsReadRestrictionConfig;
  writeConfig?: FsWriteRestrictionConfig;
  enableWeakerNestedSandbox?: boolean;
  allowAllUnixSockets?: boolean;
  ripgrepConfig?: RipgrepConfig;
  mandatoryDenySearchDepth?: number;
  allowGitConfig?: boolean;
  seccompConfig?: SeccompConfig;
  abortSignal?: AbortSignal;
}

interface DirectSeccompInvocation {
  file: string;
  argv0?: string;
}

function findSymlinkInPath(targetPath: string, allowedWritePaths: string[]): string | null {
  const parts = targetPath.split(path.sep);
  let currentPath = "";

  for (const part of parts) {
    if (!part) continue;
    const nextPath = currentPath + path.sep + part;
    try {
      const stats = fs.lstatSync(nextPath);
      if (stats.isSymbolicLink()) {
        const isWithinAllowedPath = allowedWritePaths.some(
          (allowedPath) => nextPath.startsWith(allowedPath + "/") || nextPath === allowedPath,
        );
        if (isWithinAllowedPath) return nextPath;
      }
    } catch {
      break;
    }
    currentPath = nextPath;
  }

  return null;
}

function hasFileAncestor(targetPath: string): boolean {
  const parts = targetPath.split(path.sep);
  let currentPath = "";

  for (const part of parts) {
    if (!part) continue;
    const nextPath = currentPath + path.sep + part;
    try {
      const stat = fs.statSync(nextPath);
      if (stat.isFile() || stat.isSymbolicLink()) return true;
    } catch {
      break;
    }
    currentPath = nextPath;
  }

  return false;
}

function findFirstNonExistentComponent(targetPath: string): string {
  const parts = targetPath.split(path.sep);
  let currentPath = "";

  for (const part of parts) {
    if (!part) continue;
    const nextPath = currentPath + path.sep + part;
    if (!fs.existsSync(nextPath)) return nextPath;
    currentPath = nextPath;
  }

  return targetPath;
}

async function linuxGetMandatoryDenyPaths(
  ripgrepConfig: RipgrepConfig = { command: "rg" },
  maxDepth = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH,
  allowGitConfig = false,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  const cwd = process.cwd();
  const fallbackController = new AbortController();
  const signal = abortSignal ?? fallbackController.signal;
  const dangerousDirectories = getDangerousDirectories();
  const denyPaths = [
    ...DANGEROUS_FILES.map((fileName) => path.resolve(cwd, fileName)),
    ...dangerousDirectories.map((dirName) => path.resolve(cwd, dirName)),
  ];

  const dotGitPath = path.resolve(cwd, ".git");
  let dotGitIsDirectory = false;
  try {
    dotGitIsDirectory = fs.statSync(dotGitPath).isDirectory();
  } catch {
    // .git does not exist or is inaccessible
  }

  if (dotGitIsDirectory) {
    denyPaths.push(path.resolve(cwd, ".git/hooks"));
    if (!allowGitConfig) denyPaths.push(path.resolve(cwd, ".git/config"));
  }

  const iglobArgs: string[] = [];
  for (const fileName of DANGEROUS_FILES) iglobArgs.push("--iglob", fileName);
  for (const dirName of dangerousDirectories) iglobArgs.push("--iglob", `**/${dirName}/**`);
  iglobArgs.push("--iglob", "**/.git/hooks/**");
  if (!allowGitConfig) iglobArgs.push("--iglob", "**/.git/config");

  let matches: string[] = [];
  try {
    matches = await ripGrep(
      [
        "--files",
        "--hidden",
        "--max-depth",
        String(maxDepth),
        ...iglobArgs,
        "-g",
        "!**/node_modules/**",
      ],
      cwd,
      signal,
      ripgrepConfig,
    );
  } catch (error) {
    logForDebugging(`[Sandbox] ripgrep scan failed: ${error}`);
  }

  for (const match of matches) {
    const absolutePath = path.resolve(cwd, match);
    let foundDir = false;

    for (const dirName of [...dangerousDirectories, ".git"]) {
      const normalizedDirName = normalizeCaseForComparison(dirName);
      const segments = absolutePath.split(path.sep);
      const dirIndex = segments.findIndex(
        (segment) => normalizeCaseForComparison(segment) === normalizedDirName,
      );
      if (dirIndex === -1) continue;

      if (dirName === ".git") {
        const gitDir = segments.slice(0, dirIndex + 1).join(path.sep);
        if (match.includes(".git/hooks")) denyPaths.push(path.join(gitDir, "hooks"));
        else if (match.includes(".git/config")) denyPaths.push(path.join(gitDir, "config"));
      } else {
        denyPaths.push(segments.slice(0, dirIndex + 1).join(path.sep));
      }
      foundDir = true;
      break;
    }

    if (!foundDir) denyPaths.push(absolutePath);
  }

  return [...new Set(denyPaths)];
}

const directBwrapMountPoints = new Set<string>();
let activeDirectSandboxCount = 0;
let exitHandlerRegistered = false;

function registerExitCleanupHandler(): void {
  if (exitHandlerRegistered) return;
  process.on("exit", () => cleanupDirectLinuxSandboxMountPoints({ force: true }));
  exitHandlerRegistered = true;
}

export function cleanupDirectLinuxSandboxMountPoints(opts?: { force?: boolean }): void {
  if (!opts?.force) {
    if (activeDirectSandboxCount > 0) activeDirectSandboxCount--;
    if (activeDirectSandboxCount > 0) {
      logForDebugging(
        `[Sandbox Linux] Deferring direct mount point cleanup — ${activeDirectSandboxCount} sandbox(es) still active`,
      );
      return;
    }
  } else {
    activeDirectSandboxCount = 0;
  }

  for (const mountPoint of directBwrapMountPoints) {
    try {
      const stat = fs.statSync(mountPoint);
      if (stat.isFile() && stat.size === 0) {
        fs.unlinkSync(mountPoint);
        logForDebugging(
          `[Sandbox Linux] Cleaned up direct bwrap mount point (file): ${mountPoint}`,
        );
      } else if (stat.isDirectory()) {
        const entries = fs.readdirSync(mountPoint);
        if (entries.length === 0) {
          fs.rmdirSync(mountPoint);
          logForDebugging(
            `[Sandbox Linux] Cleaned up direct bwrap mount point (dir): ${mountPoint}`,
          );
        }
      }
    } catch {
      // Ignore cleanup errors; bwrap may not have created the mount point.
    }
  }

  directBwrapMountPoints.clear();
}

async function generateFilesystemArgs(
  readConfig?: FsReadRestrictionConfig,
  writeConfig?: FsWriteRestrictionConfig,
  ripgrepConfig: RipgrepConfig = { command: "rg" },
  mandatoryDenySearchDepth = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH,
  allowGitConfig = false,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  const args: string[] = [];
  const allowedWritePaths: string[] = [];
  const denyWriteArgs: string[] = [];

  if (writeConfig) {
    args.push("--ro-bind", "/", "/");

    for (const pathPattern of writeConfig.allowOnly || []) {
      const normalizedPath = normalizePathForSandbox(pathPattern);
      logForDebugging(`[Sandbox Linux] Processing write path: ${pathPattern} -> ${normalizedPath}`);
      if (normalizedPath.startsWith("/dev/")) {
        logForDebugging(`[Sandbox Linux] Skipping /dev path: ${normalizedPath}`);
        continue;
      }
      if (!fs.existsSync(normalizedPath)) {
        logForDebugging(`[Sandbox Linux] Skipping non-existent write path: ${normalizedPath}`);
        continue;
      }

      try {
        const resolvedPath = fs.realpathSync(normalizedPath);
        const normalizedForComparison = normalizedPath.replace(/\/+$/, "");
        if (
          resolvedPath !== normalizedForComparison &&
          isSymlinkOutsideBoundary(normalizedPath, resolvedPath)
        ) {
          logForDebugging(
            `[Sandbox Linux] Skipping symlink write path pointing outside expected location: ${pathPattern} -> ${resolvedPath}`,
          );
          continue;
        }
      } catch {
        logForDebugging(
          `[Sandbox Linux] Skipping write path that could not be resolved: ${normalizedPath}`,
        );
        continue;
      }

      args.push("--bind", normalizedPath, normalizedPath);
      allowedWritePaths.push(normalizedPath);
    }

    const denyPaths = [
      ...(writeConfig.denyWithinAllow || []),
      ...(await linuxGetMandatoryDenyPaths(
        ripgrepConfig,
        mandatoryDenySearchDepth,
        allowGitConfig,
        abortSignal,
      )),
    ];
    const seenDenyWrite = new Set<string>();

    for (const pathPattern of denyPaths) {
      const normalizedPath = normalizePathForSandbox(pathPattern);
      if (seenDenyWrite.has(normalizedPath)) continue;
      seenDenyWrite.add(normalizedPath);
      if (normalizedPath.startsWith("/dev/")) continue;

      const symlinkInPath = findSymlinkInPath(normalizedPath, allowedWritePaths);
      if (symlinkInPath) {
        denyWriteArgs.push("--ro-bind", "/dev/null", symlinkInPath);
        logForDebugging(
          `[Sandbox Linux] Mounted /dev/null at symlink ${symlinkInPath} to prevent symlink replacement attack`,
        );
        continue;
      }

      if (!fs.existsSync(normalizedPath)) {
        if (hasFileAncestor(normalizedPath)) {
          logForDebugging(
            `[Sandbox Linux] Skipping deny path with file ancestor (cannot create paths under a file): ${normalizedPath}`,
          );
          continue;
        }

        let ancestorPath = path.dirname(normalizedPath);
        while (ancestorPath !== "/" && !fs.existsSync(ancestorPath)) {
          ancestorPath = path.dirname(ancestorPath);
        }

        const ancestorIsWithinAllowedPath = allowedWritePaths.some(
          (allowedPath) =>
            ancestorPath.startsWith(allowedPath + "/") ||
            ancestorPath === allowedPath ||
            normalizedPath.startsWith(allowedPath + "/"),
        );
        if (ancestorIsWithinAllowedPath) {
          const firstNonExistent = findFirstNonExistentComponent(normalizedPath);
          if (firstNonExistent !== normalizedPath) {
            const emptyDir = fs.mkdtempSync(path.join(tmpdir(), "claude-empty-"));
            denyWriteArgs.push("--ro-bind", emptyDir, firstNonExistent);
            directBwrapMountPoints.add(firstNonExistent);
            registerExitCleanupHandler();
            logForDebugging(
              `[Sandbox Linux] Mounted empty dir at ${firstNonExistent} to block creation of ${normalizedPath}`,
            );
          } else {
            denyWriteArgs.push("--ro-bind", "/dev/null", firstNonExistent);
            directBwrapMountPoints.add(firstNonExistent);
            registerExitCleanupHandler();
            logForDebugging(
              `[Sandbox Linux] Mounted /dev/null at ${firstNonExistent} to block creation of ${normalizedPath}`,
            );
          }
        } else {
          logForDebugging(
            `[Sandbox Linux] Skipping non-existent deny path not within allowed paths: ${normalizedPath}`,
          );
        }
        continue;
      }

      const isWithinAllowedPath = allowedWritePaths.some(
        (allowedPath) =>
          normalizedPath.startsWith(allowedPath + "/") || normalizedPath === allowedPath,
      );
      if (isWithinAllowedPath) denyWriteArgs.push("--ro-bind", normalizedPath, normalizedPath);
      else
        logForDebugging(
          `[Sandbox Linux] Skipping deny path not within allowed paths: ${normalizedPath}`,
        );
    }
  } else {
    args.push("--bind", "/", "/");
  }

  const readDenyPaths: string[] = [];
  const readAllowPaths = (readConfig?.allowWithinDeny || []).map((pathPattern) =>
    normalizePathForSandbox(pathPattern),
  );
  const maskedFiles = new Set<string>();
  const rootSkip = new Set(["proc", "dev", "sys"]);

  for (const pathPattern of readConfig?.denyOnly || []) {
    if (normalizePathForSandbox(pathPattern) === "/") {
      for (const child of fs.readdirSync("/")) {
        if (!rootSkip.has(child)) readDenyPaths.push("/" + child);
      }
    } else {
      readDenyPaths.push(pathPattern);
    }
  }

  if (fs.existsSync("/etc/ssh/ssh_config.d")) readDenyPaths.push("/etc/ssh/ssh_config.d");

  const normalizedDenyPaths = readDenyPaths
    .map((pathPattern) => normalizePathForSandbox(pathPattern))
    .sort((a, b) => a.split("/").length - b.split("/").length);

  for (const normalizedPath of normalizedDenyPaths) {
    if (!fs.existsSync(normalizedPath)) {
      logForDebugging(`[Sandbox Linux] Skipping non-existent read deny path: ${normalizedPath}`);
      continue;
    }

    const denySep = normalizedPath === "/" ? "/" : normalizedPath + "/";
    const readDenyStat = fs.statSync(normalizedPath);
    if (readDenyStat.isDirectory()) {
      args.push("--tmpfs", normalizedPath);

      for (const writePath of allowedWritePaths) {
        if (writePath.startsWith(denySep) || writePath === normalizedPath) {
          args.push("--bind", writePath, writePath);
          logForDebugging(
            `[Sandbox Linux] Re-bound write path wiped by denyRead tmpfs: ${writePath}`,
          );
        }
      }

      for (const allowPath of readAllowPaths) {
        if (!(allowPath.startsWith(denySep) || allowPath === normalizedPath)) continue;
        if (!fs.existsSync(allowPath)) {
          logForDebugging(`[Sandbox Linux] Skipping non-existent read allow path: ${allowPath}`);
          continue;
        }
        if (
          allowedWritePaths.some(
            (writePath) =>
              (writePath.startsWith(denySep) || writePath === normalizedPath) &&
              (allowPath === writePath || allowPath.startsWith(writePath + "/")),
          )
        ) {
          continue;
        }
        args.push("--ro-bind", allowPath, allowPath);
        logForDebugging(
          `[Sandbox Linux] Re-allowed read access within denied region: ${allowPath}`,
        );
      }
    } else {
      if (readAllowPaths.includes(normalizedPath)) {
        logForDebugging(
          `[Sandbox Linux] Skipping read deny for re-allowed path: ${normalizedPath}`,
        );
        continue;
      }
      args.push("--ro-bind", "/dev/null", normalizedPath);
      maskedFiles.add(normalizedPath);
    }
  }

  for (let i = 0; i < denyWriteArgs.length; i += 3) {
    const dest = denyWriteArgs[i + 2];
    if (maskedFiles.has(dest)) continue;
    args.push(denyWriteArgs[i], denyWriteArgs[i + 1], dest);
  }

  return args;
}

function resolveApplySeccompInvocation(
  applyPath?: string,
  argv0?: string,
): DirectSeccompInvocation | undefined {
  if (argv0) {
    if (!applyPath) throw new Error("seccompConfig.argv0 requires seccompConfig.applyPath");
    return { file: applyPath, argv0 };
  }

  const binary = getApplySeccompBinaryPath(applyPath);
  return binary ? { file: binary } : undefined;
}

function buildNetworkCommandArgs(
  httpSocketPath: string,
  socksSocketPath: string,
  command: string,
  seccomp: DirectSeccompInvocation | undefined,
  shell: string,
): string[] {
  const script = [
    'socat TCP-LISTEN:3128,fork,reuseaddr "UNIX-CONNECT:$1" >/dev/null 2>&1 &',
    "http_pid=$!",
    'socat TCP-LISTEN:1080,fork,reuseaddr "UNIX-CONNECT:$2" >/dev/null 2>&1 &',
    "socks_pid=$!",
    'cleanup() { kill "$http_pid" "$socks_pid" 2>/dev/null; }',
    "trap cleanup EXIT",
    'if [ -n "$4" ]; then',
    '  if [ -n "$5" ]; then',
    '    ARGV0="$5" "$4" "$3" -c "$6"',
    "  else",
    '    "$4" "$3" -c "$6"',
    "  fi",
    "else",
    '  "$3" -c "$6"',
    "fi",
    "status=$?",
    "exit $status",
  ].join("\n");

  return [
    shell,
    "-c",
    script,
    "pi-sandbox-network",
    httpSocketPath,
    socksSocketPath,
    shell,
    seccomp?.file ?? "",
    seccomp?.argv0 ?? "",
    command,
  ];
}

export async function createDirectLinuxSandboxCommand(
  params: DirectLinuxSandboxParams,
): Promise<DirectLinuxSandboxCommand> {
  const {
    command,
    needsNetworkRestriction,
    httpSocketPath,
    socksSocketPath,
    httpProxyPort,
    socksProxyPort,
    readConfig,
    writeConfig,
    enableWeakerNestedSandbox,
    allowAllUnixSockets,
    shell,
    ripgrepConfig = { command: "rg" },
    mandatoryDenySearchDepth = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH,
    allowGitConfig = false,
    seccompConfig,
    abortSignal,
  } = params;
  const hasReadRestrictions = readConfig && readConfig.denyOnly.length > 0;
  const hasWriteRestrictions = writeConfig !== undefined;

  if (!needsNetworkRestriction && !hasReadRestrictions && !hasWriteRestrictions) {
    return { file: shell, args: ["-c", command] };
  }

  activeDirectSandboxCount++;
  const bwrapArgs = ["--new-session", "--die-with-parent"];
  let seccomp: DirectSeccompInvocation | undefined;

  try {
    if (!allowAllUnixSockets) {
      seccomp = resolveApplySeccompInvocation(seccompConfig?.applyPath, seccompConfig?.argv0);
      if (!seccomp) {
        logForDebugging(
          "[Sandbox Linux] apply-seccomp binary not available - unix socket blocking disabled. " +
            "Install @anthropic-ai/sandbox-runtime globally for full protection.",
          { level: "warn" },
        );
      } else {
        logForDebugging("[Sandbox Linux] Applying seccomp filter for Unix socket blocking");
      }
    } else {
      logForDebugging("[Sandbox Linux] Skipping seccomp filter - allowAllUnixSockets is enabled");
    }

    if (needsNetworkRestriction) {
      bwrapArgs.push("--unshare-net");
      if (httpSocketPath && socksSocketPath) {
        if (!fs.existsSync(httpSocketPath)) {
          throw new Error(
            `Linux HTTP bridge socket does not exist: ${httpSocketPath}. The bridge process may have died. Try reinitializing the sandbox.`,
          );
        }
        if (!fs.existsSync(socksSocketPath)) {
          throw new Error(
            `Linux SOCKS bridge socket does not exist: ${socksSocketPath}. The bridge process may have died. Try reinitializing the sandbox.`,
          );
        }

        bwrapArgs.push("--bind", httpSocketPath, httpSocketPath);
        bwrapArgs.push("--bind", socksSocketPath, socksSocketPath);
        const proxyEnv = generateProxyEnvVars(3128, 1080);
        bwrapArgs.push(
          ...proxyEnv.flatMap((env) => {
            const firstEq = env.indexOf("=");
            const key = env.slice(0, firstEq);
            const value = env.slice(firstEq + 1);
            return ["--setenv", key, value];
          }),
        );
        if (httpProxyPort !== undefined) {
          bwrapArgs.push("--setenv", "CLAUDE_CODE_HOST_HTTP_PROXY_PORT", String(httpProxyPort));
        }
        if (socksProxyPort !== undefined) {
          bwrapArgs.push("--setenv", "CLAUDE_CODE_HOST_SOCKS_PROXY_PORT", String(socksProxyPort));
        }
      }
    }

    bwrapArgs.push(
      ...(await generateFilesystemArgs(
        readConfig,
        writeConfig,
        ripgrepConfig,
        mandatoryDenySearchDepth,
        allowGitConfig,
        abortSignal,
      )),
    );
    bwrapArgs.push("--dev", "/dev");
    bwrapArgs.push("--unshare-pid");
    if (!enableWeakerNestedSandbox) {
      bwrapArgs.push("--proc", "/proc");
    } else {
      bwrapArgs.push("--unshare-user", "--bind", "/proc", "/proc");
    }

    const resolvedShell = whichSync(shell);
    if (!resolvedShell) throw new Error(`Shell '${shell}' not found in PATH`);

    if (needsNetworkRestriction && httpSocketPath && socksSocketPath) {
      bwrapArgs.push(
        "--",
        ...buildNetworkCommandArgs(
          httpSocketPath,
          socksSocketPath,
          command,
          seccomp,
          resolvedShell,
        ),
      );
    } else if (seccomp) {
      if (seccomp.argv0) bwrapArgs.push("--setenv", "ARGV0", seccomp.argv0);
      bwrapArgs.push("--", seccomp.file, resolvedShell, "-c", command);
    } else {
      bwrapArgs.push("--", resolvedShell, "-c", command);
    }

    const restrictions: string[] = [];
    if (needsNetworkRestriction) restrictions.push("network");
    if (hasReadRestrictions || hasWriteRestrictions) restrictions.push("filesystem");
    if (seccomp) restrictions.push("seccomp(unix-block)");
    logForDebugging(
      `[Sandbox Linux] Wrapped command with direct bwrap argv (${restrictions.join(", ")} restrictions)`,
    );

    return { file: "bwrap", args: bwrapArgs, cleanup: cleanupDirectLinuxSandboxMountPoints };
  } catch (error) {
    if (activeDirectSandboxCount > 0) activeDirectSandboxCount--;
    throw error;
  }
}
