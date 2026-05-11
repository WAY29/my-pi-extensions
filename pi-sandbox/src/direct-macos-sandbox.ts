import { spawn } from "node:child_process";
import * as path from "node:path";

import {
  containsGlobChars,
  decodeSandboxedCommand,
  DANGEROUS_FILES,
  encodeSandboxedCommand,
  generateProxyEnvVars,
  getDangerousDirectories,
  globToRegex,
  normalizePathForSandbox,
} from "@carderne/sandbox-runtime/dist/sandbox/sandbox-utils.js";

export type FilesystemAccessKind = "read" | "write";

export interface DirectMacSandboxViolation {
  line: string;
  command?: string;
  encodedCommand?: string;
  timestamp: Date;
}

export interface DirectMacSandboxCommand {
  file: string;
  args: string[];
}

export interface FsReadRestrictionConfig {
  denyOnly: string[];
  allowWithinDeny?: string[];
}

export interface FsWriteRestrictionConfig {
  allowOnly: string[];
  denyWithinAllow?: string[];
}

export interface DirectMacSandboxParams {
  command: string;
  shell: string;
  needsNetworkRestriction: boolean;
  httpProxyPort?: number;
  socksProxyPort?: number;
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  allowLocalBinding?: boolean;
  allowMachLookup?: string[];
  readConfig: FsReadRestrictionConfig | undefined;
  writeConfig: FsWriteRestrictionConfig | undefined;
  allowPty?: boolean;
  allowBrowserProcess?: boolean;
  allowGitConfig?: boolean;
  enableWeakerNetworkIsolation?: boolean;
}

export type IgnoreViolationsConfig = Record<string, string[]>;

const directSessionSuffix = `_${Math.random().toString(36).slice(2, 11)}_PI_SBX`;

function generateLogTag(command: string): string {
  return `CMD64_${encodeSandboxedCommand(command)}_END_${directSessionSuffix}`;
}

function macGetMandatoryDenyPatterns(allowGitConfig = false): string[] {
  const cwd = process.cwd();
  const denyPaths: string[] = [];

  for (const fileName of DANGEROUS_FILES) {
    denyPaths.push(path.resolve(cwd, fileName));
    denyPaths.push(`**/${fileName}`);
  }

  for (const dirName of getDangerousDirectories()) {
    denyPaths.push(path.resolve(cwd, dirName));
    denyPaths.push(`**/${dirName}/**`);
  }

  denyPaths.push(path.resolve(cwd, ".git/hooks"));
  denyPaths.push("**/.git/hooks/**");

  if (!allowGitConfig) {
    denyPaths.push(path.resolve(cwd, ".git/config"));
    denyPaths.push("**/.git/config");
  }

  return [...new Set(denyPaths)];
}

function getAncestorDirectories(pathStr: string): string[] {
  const ancestors: string[] = [];
  let currentPath = path.dirname(pathStr);

  while (currentPath !== "/" && currentPath !== ".") {
    ancestors.push(currentPath);
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }

  return ancestors;
}

function escapePath(pathStr: string): string {
  return JSON.stringify(pathStr);
}

function generateMoveBlockingRules(pathPatterns: string[], logTag: string): string[] {
  const rules: string[] = [];
  const ops = ["file-write-unlink", "file-write-create"];

  for (const pathPattern of pathPatterns) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      for (const op of ops) {
        rules.push(
          `(deny ${op}`,
          `  (regex ${escapePath(regexPattern)})`,
          `  (with message "${logTag}"))`,
        );
      }

      const staticPrefix = normalizedPath.split(/[*?[\]]/)[0];
      if (staticPrefix && staticPrefix !== "/") {
        const baseDir = staticPrefix.endsWith("/")
          ? staticPrefix.slice(0, -1)
          : path.dirname(staticPrefix);
        for (const op of ops) {
          rules.push(
            `(deny ${op}`,
            `  (literal ${escapePath(baseDir)})`,
            `  (with message "${logTag}"))`,
          );
        }
        for (const ancestorDir of getAncestorDirectories(baseDir)) {
          for (const op of ops) {
            rules.push(
              `(deny ${op}`,
              `  (literal ${escapePath(ancestorDir)})`,
              `  (with message "${logTag}"))`,
            );
          }
        }
      }
    } else {
      for (const op of ops) {
        rules.push(
          `(deny ${op}`,
          `  (subpath ${escapePath(normalizedPath)})`,
          `  (with message "${logTag}"))`,
        );
      }
      for (const ancestorDir of getAncestorDirectories(normalizedPath)) {
        for (const op of ops) {
          rules.push(
            `(deny ${op}`,
            `  (literal ${escapePath(ancestorDir)})`,
            `  (with message "${logTag}"))`,
          );
        }
      }
    }
  }

  return rules;
}

function generateReadRules(
  config: FsReadRestrictionConfig | undefined,
  logTag: string,
  writeAllowPaths: string[] | undefined,
): string[] {
  if (!config) return ["(allow file-read*)"];

  const rules: string[] = [];
  let deniesRoot = false;
  rules.push("(allow file-read*)");

  for (const pathPattern of config.denyOnly || []) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (normalizedPath === "/") deniesRoot = true;
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(
        "(deny file-read*",
        `  (regex ${escapePath(regexPattern)})`,
        `  (with message "${logTag}"))`,
      );
    } else {
      rules.push(
        "(deny file-read*",
        `  (subpath ${escapePath(normalizedPath)})`,
        `  (with message "${logTag}"))`,
      );
    }
  }

  if (deniesRoot) rules.push('(allow file-read* (literal "/"))');

  for (const pathPattern of config.allowWithinDeny || []) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(
        "(allow file-read*",
        `  (regex ${escapePath(regexPattern)})`,
        `  (with message "${logTag}"))`,
      );
    } else {
      rules.push(
        "(allow file-read*",
        `  (subpath ${escapePath(normalizedPath)})`,
        `  (with message "${logTag}"))`,
      );
    }
  }

  if (config.denyOnly.length > 0) {
    rules.push("(allow file-read-metadata", "  (vnode-type DIRECTORY))");
  }

  rules.push(...generateMoveBlockingRules(config.denyOnly || [], logTag));

  if (writeAllowPaths && writeAllowPaths.length > 0) {
    for (const pathPattern of writeAllowPaths) {
      const normalizedPath = normalizePathForSandbox(pathPattern);
      for (const op of ["file-write-unlink", "file-write-create"]) {
        if (containsGlobChars(normalizedPath)) {
          const regexPattern = globToRegex(normalizedPath);
          rules.push(
            `(allow ${op}`,
            `  (regex ${escapePath(regexPattern)})`,
            `  (with message "${logTag}"))`,
          );
        } else {
          rules.push(
            `(allow ${op}`,
            `  (subpath ${escapePath(normalizedPath)})`,
            `  (with message "${logTag}"))`,
          );
        }
      }
    }
  }

  return rules;
}

function generateWriteRules(
  config: FsWriteRestrictionConfig | undefined,
  logTag: string,
  allowGitConfig = false,
): string[] {
  if (!config) return ["(allow file-write*)"];

  const rules: string[] = [];
  for (const pathPattern of config.allowOnly || []) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(
        "(allow file-write*",
        `  (regex ${escapePath(regexPattern)})`,
        `  (with message "${logTag}"))`,
      );
    } else {
      rules.push(
        "(allow file-write*",
        `  (subpath ${escapePath(normalizedPath)})`,
        `  (with message "${logTag}"))`,
      );
    }
  }

  const denyPaths = [
    ...(config.denyWithinAllow || []),
    ...macGetMandatoryDenyPatterns(allowGitConfig),
  ];
  for (const pathPattern of denyPaths) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(
        "(deny file-write*",
        `  (regex ${escapePath(regexPattern)})`,
        `  (with message "${logTag}"))`,
      );
    } else {
      rules.push(
        "(deny file-write*",
        `  (subpath ${escapePath(normalizedPath)})`,
        `  (with message "${logTag}"))`,
      );
    }
  }

  rules.push(...generateMoveBlockingRules(denyPaths, logTag));
  return rules;
}

function generateSandboxProfile({
  readConfig,
  writeConfig,
  httpProxyPort,
  socksProxyPort,
  needsNetworkRestriction,
  allowUnixSockets,
  allowAllUnixSockets,
  allowLocalBinding,
  allowMachLookup,
  allowPty,
  allowBrowserProcess = false,
  allowGitConfig = false,
  enableWeakerNetworkIsolation = false,
  logTag,
}: DirectMacSandboxParams & { logTag: string }): string {
  const profile = [
    "(version 1)",
    `(deny default (with message "${logTag}"))`,
    "",
    `; LogTag: ${logTag}`,
    "",
    "; Essential permissions - based on Chrome sandbox policy",
    "; Process permissions",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow process-info* (target same-sandbox))",
    "(allow signal (target same-sandbox))",
    "(allow mach-priv-task-port (target same-sandbox))",
    "",
    "; User preferences",
    "(allow user-preference-read)",
    "",
    "; Mach IPC - specific services only (no wildcard)",
    "(allow mach-lookup",
    '  (global-name "com.apple.audio.systemsoundserver")',
    '  (global-name "com.apple.distributed_notifications@Uv3")',
    '  (global-name "com.apple.FontObjectsServer")',
    '  (global-name "com.apple.fonts")',
    '  (global-name "com.apple.logd")',
    '  (global-name "com.apple.lsd.mapdb")',
    '  (global-name "com.apple.PowerManagement.control")',
    '  (global-name "com.apple.system.logger")',
    '  (global-name "com.apple.system.notification_center")',
    '  (global-name "com.apple.system.opendirectoryd.libinfo")',
    '  (global-name "com.apple.system.opendirectoryd.membership")',
    '  (global-name "com.apple.bsd.dirhelper")',
    '  (global-name "com.apple.securityd.xpc")',
    '  (global-name "com.apple.coreservices.launchservicesd")',
    ")",
    "",
    ...(enableWeakerNetworkIsolation
      ? [
          "; trustd.agent - needed for Go TLS certificate verification (weaker network isolation)",
          '(allow mach-lookup (global-name "com.apple.trustd.agent"))',
          "; configd - needed for Rust/Go programs that query system proxy/network config (uv, cargo)",
          '(allow mach-lookup (global-name "com.apple.SystemConfiguration.configd"))',
        ]
      : []),
    ...(allowMachLookup && allowMachLookup.length > 0
      ? [
          "; User-specified XPC/Mach services",
          ...allowMachLookup.map((name) =>
            name.endsWith("*")
              ? `(allow mach-lookup (global-name-prefix ${escapePath(name.slice(0, -1))}))`
              : `(allow mach-lookup (global-name ${escapePath(name)}))`,
          ),
        ]
      : []),
    "",
    "; POSIX IPC - shared memory",
    "(allow ipc-posix-shm)",
    "",
    "; POSIX IPC - semaphores for Python multiprocessing",
    "(allow ipc-posix-sem)",
    "",
    "; IOKit - specific operations only",
    "(allow iokit-open",
    '  (iokit-registry-entry-class "IOSurfaceRootUserClient")',
    '  (iokit-registry-entry-class "RootDomainUserClient")',
    '  (iokit-user-client-class "IOSurfaceSendRight")',
    ")",
    "",
    "; IOKit properties",
    "(allow iokit-get-properties)",
    "",
    "; Specific safe system-sockets, doesn't allow network access",
    "(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))",
    "",
    "; sysctl - specific sysctls only",
    "(allow sysctl-read",
    '  (sysctl-name "hw.activecpu")',
    '  (sysctl-name "hw.busfrequency_compat")',
    '  (sysctl-name "hw.byteorder")',
    '  (sysctl-name "hw.cacheconfig")',
    '  (sysctl-name "hw.cachelinesize_compat")',
    '  (sysctl-name "hw.cpufamily")',
    '  (sysctl-name "hw.cpufrequency")',
    '  (sysctl-name "hw.cpufrequency_compat")',
    '  (sysctl-name "hw.cputype")',
    '  (sysctl-name "hw.l1dcachesize_compat")',
    '  (sysctl-name "hw.l1icachesize_compat")',
    '  (sysctl-name "hw.l2cachesize_compat")',
    '  (sysctl-name "hw.l3cachesize_compat")',
    '  (sysctl-name "hw.logicalcpu")',
    '  (sysctl-name "hw.logicalcpu_max")',
    '  (sysctl-name "hw.machine")',
    '  (sysctl-name "hw.memsize")',
    '  (sysctl-name "hw.ncpu")',
    '  (sysctl-name "hw.nperflevels")',
    '  (sysctl-name "hw.packages")',
    '  (sysctl-name "hw.pagesize_compat")',
    '  (sysctl-name "hw.pagesize")',
    '  (sysctl-name "hw.physicalcpu")',
    '  (sysctl-name "hw.physicalcpu_max")',
    '  (sysctl-name "hw.tbfrequency_compat")',
    '  (sysctl-name "hw.vectorunit")',
    '  (sysctl-name "kern.argmax")',
    '  (sysctl-name "kern.bootargs")',
    '  (sysctl-name "kern.hostname")',
    '  (sysctl-name "kern.maxfiles")',
    '  (sysctl-name "kern.maxfilesperproc")',
    '  (sysctl-name "kern.maxproc")',
    '  (sysctl-name "kern.ngroups")',
    '  (sysctl-name "kern.osproductversion")',
    '  (sysctl-name "kern.osrelease")',
    '  (sysctl-name "kern.ostype")',
    '  (sysctl-name "kern.osvariant_status")',
    '  (sysctl-name "kern.osversion")',
    '  (sysctl-name "kern.secure_kernel")',
    '  (sysctl-name "kern.tcsm_available")',
    '  (sysctl-name "kern.tcsm_enable")',
    '  (sysctl-name "kern.usrstack64")',
    '  (sysctl-name "kern.version")',
    '  (sysctl-name "kern.willshutdown")',
    '  (sysctl-name "machdep.cpu.brand_string")',
    '  (sysctl-name "machdep.ptrauth_enabled")',
    '  (sysctl-name "security.mac.lockdown_mode_state")',
    '  (sysctl-name "sysctl.proc_cputype")',
    '  (sysctl-name "vm.loadavg")',
    '  (sysctl-name-prefix "hw.optional.arm")',
    '  (sysctl-name-prefix "hw.optional.arm.")',
    '  (sysctl-name-prefix "hw.optional.armv8_")',
    '  (sysctl-name-prefix "hw.perflevel")',
    '  (sysctl-name-prefix "kern.proc.all")',
    '  (sysctl-name-prefix "kern.proc.pgrp.")',
    '  (sysctl-name-prefix "kern.proc.pid.")',
    '  (sysctl-name-prefix "machdep.cpu.")',
    '  (sysctl-name-prefix "net.routetable.")',
    ")",
    "",
    "; V8 thread calculations",
    "(allow sysctl-write",
    '  (sysctl-name "kern.tcsm_enable")',
    ")",
    "",
    "; Distributed notifications",
    "(allow distributed-notification-post)",
    "",
    "; Specific mach-lookup permissions for security operations",
    '(allow mach-lookup (global-name "com.apple.SecurityServer"))',
    "",
    "; File I/O on device files",
    '(allow file-ioctl (literal "/dev/null"))',
    '(allow file-ioctl (literal "/dev/zero"))',
    '(allow file-ioctl (literal "/dev/random"))',
    '(allow file-ioctl (literal "/dev/urandom"))',
    '(allow file-ioctl (literal "/dev/dtracehelper"))',
    '(allow file-ioctl (literal "/dev/tty"))',
    "",
    "(allow file-ioctl file-read-data file-write-data",
    "  (require-all",
    '    (literal "/dev/null")',
    "    (vnode-type CHARACTER-DEVICE)",
    "  )",
    ")",
    "",
  ];

  profile.push("; Network");
  if (!needsNetworkRestriction) {
    profile.push("(allow network*)");
  } else {
    if (allowLocalBinding) {
      profile.push('(allow network-bind (local ip "*:*"))');
      profile.push('(allow network-inbound (local ip "*:*"))');
      profile.push('(allow network-outbound (local ip "*:*"))');
    }
    if (allowAllUnixSockets) {
      profile.push("(allow system-socket (socket-domain AF_UNIX))");
      profile.push('(allow network-bind (local unix-socket (path-regex #"^/")))');
      profile.push('(allow network-outbound (remote unix-socket (path-regex #"^/")))');
    } else if (allowUnixSockets && allowUnixSockets.length > 0) {
      profile.push("(allow system-socket (socket-domain AF_UNIX))");
      for (const socketPath of allowUnixSockets) {
        const normalizedPath = normalizePathForSandbox(socketPath);
        profile.push(
          `(allow network-bind (local unix-socket (subpath ${escapePath(normalizedPath)})))`,
        );
        profile.push(
          `(allow network-outbound (remote unix-socket (subpath ${escapePath(normalizedPath)})))`,
        );
      }
    }
    if (httpProxyPort !== undefined) {
      profile.push(`(allow network-bind (local ip "localhost:${httpProxyPort}"))`);
      profile.push(`(allow network-inbound (local ip "localhost:${httpProxyPort}"))`);
      profile.push(`(allow network-outbound (remote ip "localhost:${httpProxyPort}"))`);
    }
    if (socksProxyPort !== undefined) {
      profile.push(`(allow network-bind (local ip "localhost:${socksProxyPort}"))`);
      profile.push(`(allow network-inbound (local ip "localhost:${socksProxyPort}"))`);
      profile.push(`(allow network-outbound (remote ip "localhost:${socksProxyPort}"))`);
    }
  }

  profile.push("");
  profile.push("; File read");
  profile.push(...generateReadRules(readConfig, logTag, writeConfig?.allowOnly));
  profile.push("");
  profile.push("; File write");
  profile.push(...generateWriteRules(writeConfig, logTag, allowGitConfig));

  if (allowPty) {
    profile.push(
      "",
      "; Pseudo-terminal (pty) support",
      "(allow pseudo-tty)",
      "(allow file-ioctl",
      '  (literal "/dev/ptmx")',
      '  (regex #"^/dev/ttys")',
      ")",
      "(allow file-read* file-write*",
      '  (literal "/dev/ptmx")',
      '  (regex #"^/dev/ttys")',
      ")",
    );
  }

  if (allowBrowserProcess) {
    profile.push(
      "",
      "; Browser process support (Chrome/Chromium)",
      "; All Mach operations — Chrome requires bootstrap registration",
      "; (Crashpad), service lookups (window server, CoreDisplay, GPU),",
      "; task ports, and cross-domain lookups that vary by OS version",
      "(allow mach*)",
      "",
      "; Process info for all processes — Chrome manages renderer, GPU,",
      "; utility, and crashpad child processes outside the same sandbox",
      "(allow process-info*)",
      "",
      "; Broader IOKit access — needed for GPU process and display management",
      "(allow iokit-open)",
      "",
      "; Shared memory with non-sandboxed processes (e.g. renderer ↔ GPU)",
      "(allow ipc-posix-shm*)",
    );
  }

  return profile.join("\n");
}

export function createDirectMacSandboxCommand(
  params: DirectMacSandboxParams,
): DirectMacSandboxCommand {
  const hasReadRestrictions = params.readConfig && params.readConfig.denyOnly.length > 0;
  const hasWriteRestrictions = params.writeConfig !== undefined;
  if (!params.needsNetworkRestriction && !hasReadRestrictions && !hasWriteRestrictions) {
    return { file: params.shell, args: ["-c", params.command] };
  }

  const profile = generateSandboxProfile({ ...params, logTag: generateLogTag(params.command) });
  return {
    file: "env",
    args: [
      ...generateProxyEnvVars(params.httpProxyPort, params.socksProxyPort),
      "sandbox-exec",
      "-p",
      profile,
      params.shell,
      "-c",
      params.command,
    ],
  };
}

export function startDirectMacSandboxLogMonitor(
  callback: (violation: DirectMacSandboxViolation) => void,
  ignoreViolations?: IgnoreViolationsConfig,
): () => void {
  const cmdExtractRegex = /CMD64_(.+?)_END/;
  const sandboxExtractRegex = /Sandbox:\s+(.+)$/;
  const wildcardPaths = ignoreViolations?.["*"] || [];
  const commandPatterns = ignoreViolations
    ? Object.entries(ignoreViolations).filter(([pattern]) => pattern !== "*")
    : [];

  const logProcess = spawn("log", [
    "stream",
    "--predicate",
    `(eventMessage ENDSWITH "${directSessionSuffix}")`,
    "--style",
    "compact",
  ]);

  logProcess.stdout?.on("data", (data) => {
    const lines = data.toString().split("\n");
    const violationLines = lines.filter(
      (line: string) => line.includes("Sandbox:") && line.includes("deny"),
    );
    const commandLine = lines.find((line: string) => line.startsWith("CMD64_"));
    if (violationLines.length === 0) return;

    let command: string | undefined;
    let encodedCommand: string | undefined;
    if (commandLine) {
      const cmdMatch = commandLine.match(cmdExtractRegex);
      encodedCommand = cmdMatch?.[1];
      if (encodedCommand) {
        try {
          command = decodeSandboxedCommand(encodedCommand);
        } catch {
          // keep the encoded command only
        }
      }
    }

    for (const violationLine of violationLines) {
      const sandboxMatch = violationLine.match(sandboxExtractRegex);
      if (!sandboxMatch?.[1]) continue;
      const violationDetails = sandboxMatch[1];

      if (
        violationDetails.includes("mDNSResponder") ||
        violationDetails.includes("mach-lookup com.apple.diagnosticd") ||
        violationDetails.includes("mach-lookup com.apple.analyticsd")
      ) {
        continue;
      }

      if (ignoreViolations && command) {
        if (wildcardPaths.some((ignoredPath) => violationDetails.includes(ignoredPath))) continue;
        let ignoredByCommandPattern = false;
        for (const [pattern, paths] of commandPatterns) {
          if (
            command.includes(pattern) &&
            paths.some((ignoredPath) => violationDetails.includes(ignoredPath))
          ) {
            ignoredByCommandPattern = true;
            break;
          }
        }
        if (ignoredByCommandPattern) continue;
      }

      callback({ line: violationDetails, command, encodedCommand, timestamp: new Date() });
    }
  });

  logProcess.stderr?.on("data", () => {
    // Ignore log stream diagnostics; SandboxManager's own monitor behaves the same for users.
  });

  return () => logProcess.kill("SIGTERM");
}
