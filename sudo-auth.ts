import type { BashOperations, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLocalBashOperations, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { randomBytes } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

import {
  ensureBashToolRegistered,
  registerBashToolPlugin,
  releaseBashToolOwner,
} from "./bash-tool-coordinator";

const STATUS_KEY = "sudo-auth";
const SOCKET_NAME = "askpass.sock";
const WRAPPER_NAME = "sudo";
const ASKPASS_NAME = "askpass";
const ASKPASS_CLIENT_NAME = "askpass-client.cjs";
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

const AUTH_FAILURE_PATTERN =
  /(Sorry, try again|incorrect password attempt|no password was provided|authentication failed|a password is required|askpass)/i;

type AuthResult = { ok: true } | { ok: false; reason: string };
type SudoCredential = { password: string };

type AskpassRequest = {
  token?: string;
  invocationId?: string;
  mode?: "askpass" | "preprompt";
  prompt?: string;
};

type SudoAuthRuntime = {
  dir: string;
  wrapperPath: string;
  askpassPath: string;
  socketPath: string;
  token: string;
  server: Server;
};

type SandboxStateResponse = {
  available: true;
  enabled: boolean;
};

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function masked(value: string): string {
  return "•".repeat([...value].length);
}

function getTempRoot(): string {
  return existsSync("/tmp") ? "/tmp" : process.cwd();
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findRealSudoPath(): Promise<string> {
  const override = process.env.PI_SUDO_AUTH_REAL_SUDO;
  if (override && (await isExecutable(override))) return override;

  for (const candidate of ["/usr/bin/sudo", "/bin/sudo", "/usr/local/bin/sudo"]) {
    if (await isExecutable(candidate)) return candidate;
  }

  return "sudo";
}

async function promptForPassword(ctx: ExtensionContext, attempt: number): Promise<string | undefined> {
  ctx.ui.setWorkingVisible(false);
  try {
    return await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
      let value = "";
      let cachedWidth: number | undefined;
      let cachedLines: string[] | undefined;

      const refresh = () => {
        cachedWidth = undefined;
        cachedLines = undefined;
        tui.requestRender();
      };

      return {
        render(width: number): string[] {
          if (cachedLines && cachedWidth === width) return cachedLines;

          const title = attempt === 1 ? "sudo authentication required" : `sudo authentication required (attempt ${attempt})`;
          const passwordLine = `  Password: ${masked(value)}${theme.fg("accent", "█")}`;
          const lines = [
            theme.fg("accent", "─".repeat(width)),
            ` ${theme.fg("warning", title)}`,
            theme.fg("dim", " Password is kept in this extension's memory only and is not written to the session."),
            "",
            passwordLine,
            "",
            theme.fg("dim", " Enter to submit • Esc/Ctrl+C to cancel"),
            theme.fg("accent", "─".repeat(width)),
          ].map((line) => truncateToWidth(line, width));

          cachedWidth = width;
          cachedLines = lines;
          return lines;
        },

        handleInput(data: string): void {
          if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
            done(undefined);
            return;
          }

          if (matchesKey(data, Key.enter)) {
            done(value);
            return;
          }

          if (matchesKey(data, Key.backspace) || data === "\x7f") {
            value = [...value].slice(0, -1).join("");
            refresh();
            return;
          }

          const decoded = decodeKittyPrintable(data);
          if (decoded !== undefined) {
            value += decoded;
            refresh();
            return;
          }

          const hasControlChars = [...data].some((char) => {
            const code = char.charCodeAt(0);
            return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
          });
          if (!hasControlChars) {
            value += data;
            refresh();
          }
        },

        invalidate(): void {
          cachedWidth = undefined;
          cachedLines = undefined;
        },
      };
    });
  } finally {
    ctx.ui.setWorkingVisible(true);
  }
}

function readAskpassRequest(socket: Socket): Promise<AskpassRequest | undefined> {
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const timeout = setTimeout(() => finish(undefined), REQUEST_TIMEOUT_MS);

    const finish = (request: AskpassRequest | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(request);
    };

    const parseBuffer = () => {
      const firstNewline = buffer.indexOf("\n");
      if (firstNewline === -1) return;

      const firstLine = buffer.slice(0, firstNewline);
      if (firstLine.trimStart().startsWith("{")) {
        try {
          finish(JSON.parse(firstLine) as AskpassRequest);
        } catch {
          finish(undefined);
        }
        return;
      }

      const lines = buffer.split("\n");
      if (lines.length < 4) return;
      if (lines.length >= 5 && (lines[2] === "askpass" || lines[2] === "preprompt")) {
        finish({ token: lines[0], invocationId: lines[1], mode: lines[2], prompt: lines[3] });
        return;
      }
      finish({ token: lines[0], invocationId: lines[1], mode: "askpass", prompt: lines[2] });
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      parseBuffer();
    });

    socket.on("error", () => finish(undefined));
    socket.on("end", () => {
      parseBuffer();
      finish(undefined);
    });
  });
}

async function writeAskpassResponse(socket: Socket, password: string | undefined): Promise<void> {
  const encoded = password === undefined ? undefined : Buffer.from(password, "utf8").toString("base64");
  const response = encoded === undefined ? "ERR\n" : `OK ${encoded}\n`;
  await new Promise<void>((resolve) => socket.end(response, resolve));
}

function createAskpassClientSource(useShebang: boolean): string {
  const shebang = useShebang ? `#!${process.execPath}\n` : "";
  return `${shebang}const net = require("node:net");
const socketPath = process.env.PI_SUDO_AUTH_SOCKET;
const token = process.env.PI_SUDO_AUTH_TOKEN;
const invocationId = process.env.PI_SUDO_AUTH_INVOCATION_ID || "unknown";
const mode = process.env.PI_SUDO_AUTH_MODE || "askpass";
const prompt = process.argv.slice(2).join(" ");

function fail() { process.exit(1); }
if (!socketPath || !token) fail();

let buffer = "";
const client = net.createConnection(socketPath);
const timeout = setTimeout(fail, ${REQUEST_TIMEOUT_MS});

client.on("connect", () => {
  client.write(token + "\\n" + invocationId + "\\n" + mode + "\\n" + prompt + "\\n");
});

client.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const newline = buffer.indexOf("\\n");
  if (newline === -1) return;
  clearTimeout(timeout);
  const line = buffer.slice(0, newline);
  if (!line.startsWith("OK ")) fail();
  try {
    process.stdout.write(Buffer.from(line.slice(3), "base64").toString("utf8") + "\\n");
    process.exit(0);
  } catch {
    fail();
  }
});

client.on("error", fail);
client.on("end", fail);
`;
}

function createSudoWrapperSource(realSudoPath: string, askpassPath: string): string {
  return `#!/bin/sh
REAL_SUDO=${shellSingleQuote(realSudoPath)}
export SUDO_ASKPASS=${shellSingleQuote(askpassPath)}
PI_SUDO_AUTH_INVOCATION_ID="\${PI_SUDO_AUTH_INVOCATION_ID:-$$}"
export PI_SUDO_AUTH_INVOCATION_ID

has_explicit_auth=0
has_noninteractive=0
for arg in "$@"; do
  case "$arg" in
    --)
      break
      ;;
    -A|--askpass|-S|--stdin)
      has_explicit_auth=1
      ;;
    -n|--non-interactive)
      has_noninteractive=1
      ;;
    --*)
      ;;
    -*)
      case "$arg" in
        *A*|*S*) has_explicit_auth=1 ;;
      esac
      case "$arg" in
        *n*) has_noninteractive=1 ;;
      esac
      ;;
    *)
      break
      ;;
  esac
done

if [ "$has_explicit_auth" = 1 ] || [ "$has_noninteractive" = 1 ]; then
  exec "$REAL_SUDO" "$@"
fi

if [ -n "\${PI_SUDO_AUTH_SOCKET:-}" ] && [ -n "\${PI_SUDO_AUTH_TOKEN:-}" ]; then
  PI_SUDO_AUTH_MODE=preprompt "$SUDO_ASKPASS" '' >/dev/null 2>&1 || exit 1
fi

exec "$REAL_SUDO" -A -p '' "$@"
`;
}

function createAskpassShellSource(clientPath: string): string {
  return `#!/bin/sh
exec ${shellSingleQuote(process.execPath)} ${shellSingleQuote(clientPath)} "$@"
`;
}

function injectSudoAuthEnv(env: NodeJS.ProcessEnv | undefined, runtime: SudoAuthRuntime): NodeJS.ProcessEnv {
  const base = env ?? process.env;
  return {
    ...base,
    PATH: `${runtime.dir}:${base.PATH ?? process.env.PATH ?? ""}`,
    SUDO_ASKPASS: runtime.askpassPath,
    PI_SUDO_AUTH_SOCKET: runtime.socketPath,
    PI_SUDO_AUTH_TOKEN: runtime.token,
  };
}

function requestSandboxState(pi: ExtensionAPI, ctx: ExtensionContext): Promise<SandboxStateResponse | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = (state: SandboxStateResponse | undefined) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(state);
    };

    timeout = setTimeout(() => finish(undefined), 50);

    pi.events.emit("pi-sandbox:request-state", {
      cwd: ctx.cwd,
      respond: (response: SandboxStateResponse | Promise<SandboxStateResponse>) => {
        Promise.resolve(response).then(finish, () => finish(undefined));
      },
    });
  });
}

export default function sudoAuth(pi: ExtensionAPI) {
  let credential: SudoCredential | undefined;
  let pendingAuthentication: Promise<AuthResult> | undefined;
  let lastStatusContext: ExtensionContext | undefined;
  let runtimePromise: Promise<SudoAuthRuntime> | undefined;
  let runtime: SudoAuthRuntime | undefined;
  const invocationAttempts = new Map<string, number>();

  const updateStatus = (ctx = lastStatusContext) => {
    ctx?.ui.setStatus(STATUS_KEY, credential ? "sudo: password cached" : undefined);
  };

  const clearCredential = (notify = false) => {
    credential = undefined;
    updateStatus();
    if (notify) {
      lastStatusContext?.ui.notify("Cached sudo password was rejected; please enter it again.", "warning");
    }
  };

  const authenticateWithPrompt = async (ctx: ExtensionContext, attempt: number): Promise<AuthResult> => {
    if (!ctx.hasUI) {
      return { ok: false, reason: "sudo requires interactive password input, but UI is not available" };
    }

    const password = await promptForPassword(ctx, attempt);
    if (password === undefined) return { ok: false, reason: "sudo authentication cancelled" };

    credential = { password };
    updateStatus(ctx);
    ctx.ui.notify("sudo password cached for this pi session", "info");
    return { ok: true };
  };

  const ensureAuthenticated = async (ctx: ExtensionContext, attempt = 1): Promise<AuthResult> => {
    lastStatusContext = ctx;
    if (credential) {
      updateStatus(ctx);
      return { ok: true };
    }

    pendingAuthentication ??= authenticateWithPrompt(ctx, attempt).finally(() => {
      pendingAuthentication = undefined;
    });

    return pendingAuthentication;
  };

  const handleAskpassRequest = async (request: AskpassRequest): Promise<string | undefined> => {
    if (!runtime || request.token !== runtime.token) return undefined;

    const ctx = lastStatusContext;
    if (!ctx) return undefined;

    if (request.mode === "preprompt") {
      const auth = await ensureAuthenticated(ctx, 1);
      if (!auth.ok) return undefined;
      return credential?.password;
    }

    const invocationId = request.invocationId || "unknown";
    const attempt = (invocationAttempts.get(invocationId) ?? 0) + 1;
    invocationAttempts.set(invocationId, attempt);

    if (attempt > 1) {
      clearCredential(true);
    }

    const auth = await ensureAuthenticated(ctx, attempt);
    if (!auth.ok) return undefined;
    return credential?.password;
  };

  const createRuntime = async (): Promise<SudoAuthRuntime> => {
    const dir = await mkdtemp(join(getTempRoot(), "pi-sa-"));
    await chmod(dir, 0o700);

    const socketPath = join(dir, SOCKET_NAME);
    const wrapperPath = join(dir, WRAPPER_NAME);
    const askpassClientPath = join(dir, ASKPASS_CLIENT_NAME);
    const canUseDirectNodeAskpass = !/\s/.test(process.execPath);
    const askpassPath = canUseDirectNodeAskpass ? askpassClientPath : join(dir, ASKPASS_NAME);
    const token = randomBytes(32).toString("hex");
    const realSudoPath = await findRealSudoPath();

    const server = createServer((socket) => {
      void (async () => {
        const request = await readAskpassRequest(socket);
        const password = request ? await handleAskpassRequest(request) : undefined;
        await writeAskpassResponse(socket, password);
      })().catch(() => {
        socket.destroy();
      });
    });
    server.unref();

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });

    await writeFile(askpassClientPath, createAskpassClientSource(canUseDirectNodeAskpass), { mode: 0o700 });
    if (!canUseDirectNodeAskpass) {
      await writeFile(askpassPath, createAskpassShellSource(askpassClientPath), { mode: 0o700 });
      await chmod(askpassPath, 0o700);
    }
    await writeFile(wrapperPath, createSudoWrapperSource(realSudoPath, askpassPath), { mode: 0o700 });
    await chmod(askpassClientPath, 0o700);
    await chmod(wrapperPath, 0o700);

    runtime = { dir, wrapperPath, askpassPath, socketPath, token, server };
    return runtime;
  };

  const ensureRuntime = async (): Promise<SudoAuthRuntime> => {
    runtimePromise ??= createRuntime();
    return runtimePromise;
  };

  const createSudoAuthOperations = (next: BashOperations): BashOperations => ({
    async exec(command, cwd, options) {
      const activeRuntime = await ensureRuntime();
      let sawAuthFailure = false;
      const onData = (data: Buffer) => {
        const text = data.toString("utf8");
        if (AUTH_FAILURE_PATTERN.test(text)) sawAuthFailure = true;
        options.onData(data);
      };

      try {
        const result = await next.exec(command, cwd, {
          ...options,
          env: injectSudoAuthEnv(options.env, activeRuntime),
          onData,
        });
        if (sawAuthFailure) clearCredential(true);
        return result;
      } catch (error) {
        if (sawAuthFailure) clearCredential(true);
        throw error;
      }
    },
  });

  registerBashToolPlugin(pi, {
    id: "sudo-auth",
    priority: -50,
    wrapOperations: createSudoAuthOperations,
  });

  pi.on("tool_call", (event, ctx) => {
    if (isToolCallEventType("bash", event)) lastStatusContext = ctx;
  });

  pi.on("user_bash", async (_event, ctx) => {
    lastStatusContext = ctx;

    // user_bash takes the first extension result. If pi-sandbox is active, do
    // not return operations here; let sandbox keep ownership of user_bash.
    const sandboxState = await requestSandboxState(pi, ctx);
    if (sandboxState?.enabled) return;

    return { operations: createSudoAuthOperations(createLocalBashOperations()) };
  });

  pi.on("session_start", (_event, ctx) => {
    lastStatusContext = ctx;
    ensureBashToolRegistered(pi, ctx.cwd);
    updateStatus(ctx);
    void ensureRuntime().catch((error) => {
      ctx.ui.notify(`sudo-auth setup failed: ${error instanceof Error ? error.message : error}`, "error");
    });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    releaseBashToolOwner(pi);
    credential = undefined;
    pendingAuthentication = undefined;
    invocationAttempts.clear();
    ctx.ui.setStatus(STATUS_KEY, undefined);
    lastStatusContext = undefined;

    const activeRuntime = runtime;
    runtime = undefined;
    runtimePromise = undefined;
    if (activeRuntime) {
      await new Promise<void>((resolve) => activeRuntime.server.close(() => resolve()));
      await rm(activeRuntime.dir, { recursive: true, force: true });
    }
  });
}
