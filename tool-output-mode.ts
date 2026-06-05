import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Key } from "@earendil-works/pi-tui";
import {
  ensureBashToolRegistered,
  refreshBashTool,
  registerBashToolPlugin,
  releaseBashToolOwner,
} from "./bash-tool-coordinator";

type OutputMode = "hidden" | "compact" | "full";

const STATUS_KEY = "tool-output-mode";
const COMMAND = "tool-output-mode";
const TOOL_SCOPE = "bash/grep/find/ls";
const SHORTCUTS = [
  Key.ctrlShift("o"),
  // Fallback: many terminals collapse Ctrl+Shift+O to Ctrl+O, so the shifted
  // shortcut never reaches pi distinctly unless Kitty/CSI-u keys are enabled.
  Key.alt("o"),
] as const;
let outputMode: OutputMode = "hidden";

function nextMode(mode: OutputMode): OutputMode {
  if (mode === "hidden") return "compact";
  if (mode === "compact") return "full";
  return "hidden";
}

function setStatus(ctx: { ui: { setStatus(key: string, text: string | undefined): void } }): void {
  ctx.ui.setStatus(STATUS_KEY, `tool output: ${outputMode}`);
}

function refreshToolRows(ctx: {
  ui: {
    getToolsExpanded(): boolean;
    setToolsExpanded(expanded: boolean): void;
  };
}): void {
  refreshBashTool();
  // Re-apply the existing global expansion state so pi asks existing tool rows to rebuild.
  // This extension's renderers read outputMode from closure and decide hidden/compact/full themselves.
  ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
}

function applyOutputMode(
  ctx: {
    ui: {
      setStatus(key: string, text: string | undefined): void;
      notify(message: string, type?: "info" | "warning" | "error"): void;
      getToolsExpanded(): boolean;
      setToolsExpanded(expanded: boolean): void;
    };
  },
  mode: OutputMode,
): void {
  const previousMode = outputMode;
  outputMode = mode;
  setStatus(ctx);
  refreshToolRows(ctx);
  ctx.ui.notify(`${TOOL_SCOPE} output: ${previousMode} → ${outputMode}`, "info");
}

function parseMode(value: string): OutputMode | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "hidden" || normalized === "compact" || normalized === "full")
    return normalized;
  return undefined;
}

export default function (pi: ExtensionAPI) {
  registerBashToolPlugin(pi, {
    id: "tool-output-mode",
    wrapRenderResult: (next) => (result, options, theme, context) => {
      if (outputMode === "hidden") {
        return new Container();
      }

      return next(result, { ...options, expanded: outputMode === "full" }, theme, context);
    },
  });

  for (const shortcut of SHORTCUTS) {
    pi.registerShortcut(shortcut, {
      description: `Cycle ${TOOL_SCOPE} output: hidden → compact → full`,
      handler(ctx) {
        applyOutputMode(ctx, nextMode(outputMode));
      },
    });
  }

  pi.registerCommand(COMMAND, {
    description: `Cycle or set ${TOOL_SCOPE} output mode: hidden, compact, full`,
    async handler(args, ctx) {
      const requestedMode = args.trim() ? parseMode(args) : nextMode(outputMode);
      if (!requestedMode) {
        ctx.ui.notify(`Usage: /${COMMAND} [hidden|compact|full]`, "warning");
        return;
      }

      applyOutputMode(ctx, requestedMode);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    setStatus(ctx);
    ensureBashToolRegistered(pi, ctx.cwd);

    const grep = createGrepToolDefinition(ctx.cwd);
    pi.registerTool({
      ...grep,
      renderResult(result, options, theme, context) {
        if (outputMode === "hidden") {
          return new Container();
        }

        return (
          grep.renderResult?.(
            result,
            { ...options, expanded: outputMode === "full" },
            theme,
            context,
          ) ?? new Container()
        );
      },
    });

    const find = createFindToolDefinition(ctx.cwd);
    pi.registerTool({
      ...find,
      renderResult(result, options, theme, context) {
        if (outputMode === "hidden") {
          return new Container();
        }

        return (
          find.renderResult?.(
            result,
            { ...options, expanded: outputMode === "full" },
            theme,
            context,
          ) ?? new Container()
        );
      },
    });

    const ls = createLsToolDefinition(ctx.cwd);
    pi.registerTool({
      ...ls,
      renderResult(result, options, theme, context) {
        if (outputMode === "hidden") {
          return new Container();
        }

        return (
          ls.renderResult?.(
            result,
            { ...options, expanded: outputMode === "full" },
            theme,
            context,
          ) ?? new Container()
        );
      },
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    releaseBashToolOwner(pi);
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
