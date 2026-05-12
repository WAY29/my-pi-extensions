import type { AssistantMessage } from "@earendil-works/pi-ai";
import { copyToClipboard, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const extensionConfig = {
  showStatusHint: true,
  statusIcon: "⎘",
  shortcut: Key.ctrlAlt("c"),
  previewWidth: 60,
  copyAllSeparator: "\n\n",
  maxAssistantMessagesToScan: 5,
} as const;

const shortcutHint = formatShortcutHint(extensionConfig.shortcut);
const PATCHED = Symbol.for("pi.code-block-enhancer.patched");
const LEGACY_HIDE_PATCHED = Symbol.for("pi.hide-code-fence-markers.patched");
const ENHANCE_CONTEXT: EnhancementContext = {
  active: false,
  currentIndex: 0,
  totalBlocks: 0,
};
const ANSI_DIM = "\x1b[2m";
const ANSI_RESET = "\x1b[0m";
const FENCED_CODE_BLOCK_PATTERN = /^```([^\n`]*)\r?\n([\s\S]*?)^```[ \t]*$/gm;

interface CodeBlock {
  index: number;
  language: string;
  code: string;
  preview: string;
}

interface CopyContext {
  hasUI: boolean;
  sessionManager: ExtensionContext["sessionManager"];
  ui: ExtensionContext["ui"];
}

interface ParsedCopyRequest {
  kind: "single" | "all";
  fenced: boolean;
  selector?: string;
}

type MarkdownInternals = {
  text?: string;
  theme: {
    codeBlock: (text: string) => string;
    codeBlockBorder: (text: string) => string;
    highlightCode?: (code: string, lang?: string) => string[];
    codeBlockIndent?: string;
  };
};

type MarkdownToken = {
  type?: string;
  text?: string;
  lang?: string;
  tokens?: MarkdownToken[];
};

type RenderToken = (this: MarkdownInternals, token: MarkdownToken, width: number, nextTokenType?: string, styleContext?: unknown) => string[];
type RenderListItem = (this: MarkdownInternals, tokens: MarkdownToken[], parentDepth: number, styleContext?: unknown) => string[];
type RenderMarkdown = (this: MarkdownInternals, width: number) => string[];

interface EnhancementContext {
  active: boolean;
  currentIndex: number;
  totalBlocks: number;
  currentWidth?: number;
}

function formatShortcutHint(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => (part.length === 1 ? part.toUpperCase() : `${part[0]!.toUpperCase()}${part.slice(1)}`))
    .join("+");
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim();
}

function cloneFencePattern(): RegExp {
  return new RegExp(FENCED_CODE_BLOCK_PATTERN.source, FENCED_CODE_BLOCK_PATTERN.flags);
}

function countFencedCodeBlocks(text: string): number {
  let count = 0;
  const pattern = cloneFencePattern();
  while (pattern.exec(text)) count++;
  return count;
}

function getCodeBlocksFromRecentAssistantMessages(ctx: CopyContext): {
  blocks: CodeBlock[] | null;
  scannedAssistantMessages: number;
} {
  const branch = ctx.sessionManager.getBranch();
  let scannedAssistantMessages = 0;

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;

    const message = entry.message as AssistantMessage;
    if (message.stopReason !== "stop") continue;

    const text = getAssistantText(message);
    if (text.length === 0) continue;

    scannedAssistantMessages++;
    const blocks = extractCodeBlocks(text);
    if (blocks.length > 0) {
      return { blocks, scannedAssistantMessages };
    }

    if (scannedAssistantMessages >= extensionConfig.maxAssistantMessagesToScan) break;
  }

  return { blocks: null, scannedAssistantMessages };
}

function getPreview(code: string): string {
  const lines = code.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const firstVisibleLine = lines.find((line) => line.trim().length > 0) ?? lines[0] ?? "";
  if (firstVisibleLine.length === 0) return "(empty block)";

  const trimmedLine = firstVisibleLine.trimEnd();
  const maxWidth = extensionConfig.previewWidth;
  const linePreview = trimmedLine.length > maxWidth ? `${trimmedLine.slice(0, maxWidth - 1)}…` : trimmedLine;
  return lines.length > 1 ? `${linePreview} ⏎ …` : linePreview;
}

function extractCodeBlocks(text: string): CodeBlock[] {
  const extracted: Array<Pick<CodeBlock, "language" | "code">> = [];
  const fencePattern = cloneFencePattern();

  let match: RegExpExecArray | null = fencePattern.exec(text);
  while (match) {
    const infoString = match[1]?.trim() ?? "";
    const language = infoString.split(/\s+/)[0] || "text";
    const code = match[2]?.replace(/\r\n/g, "\n") ?? "";

    extracted.push({ language, code });
    match = fencePattern.exec(text);
  }

  return extracted.reverse().map((block, index) => ({
    index: index + 1,
    language: block.language,
    code: block.code,
    preview: getPreview(block.code),
  }));
}

function parseCopyRequest(input?: string): { request?: ParsedCopyRequest; error?: string } {
  const tokens = (input ?? "")
    .trim()
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return { request: { kind: "single", fenced: false } };
  }

  let fenced = false;
  const remaining = tokens.filter((token) => {
    if (token === "fenced") {
      fenced = true;
      return false;
    }
    return true;
  });

  if (remaining.length === 0) {
    return { request: { kind: "single", fenced } };
  }

  if (remaining.length > 1) {
    return {
      error: "Too many arguments. Use /copy-code, /copy-code 2, /copy-code all, or /copy-code fenced 2.",
    };
  }

  const token = remaining[0]!;
  if (token === "all") {
    return { request: { kind: "all", fenced } };
  }

  return { request: { kind: "single", fenced, selector: token } };
}

function resolveRequestedBlock(selector: string | undefined, blocks: CodeBlock[]) {
  const normalized = selector?.trim().toLowerCase();

  if (!normalized) {
    return blocks.length === 1 ? { block: blocks[0] } : { requiresPicker: true };
  }

  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized);
    if (index >= 1 && index <= blocks.length) {
      return { block: blocks[index - 1] };
    }
    return { error: `Code block ${index} does not exist. Found ${blocks.length} block(s).` };
  }

  if (normalized === "first" || normalized === "f") return { block: blocks[0] };
  if (normalized === "last" || normalized === "l") return { block: blocks[blocks.length - 1] };

  return { error: `Unknown code block selector "${selector}". Use a number, first/f, or last/l.` };
}

function formatSingleBlockForClipboard(block: CodeBlock, fenced: boolean): string {
  if (!fenced) return block.code;

  const body = block.code.endsWith("\n") ? block.code : `${block.code}\n`;
  const language = block.language === "text" ? "" : block.language;
  return `\`\`\`${language}\n${body}\`\`\``;
}

function formatAllBlocksForClipboard(blocks: CodeBlock[], fenced: boolean): string {
  return blocks.map((block) => formatSingleBlockForClipboard(block, fenced)).join(extensionConfig.copyAllSeparator);
}

async function selectCodeBlock(ctx: CopyContext, blocks: CodeBlock[]): Promise<CodeBlock | null> {
  return ctx.ui.custom<CodeBlock | null>((tui, theme, _kb, done) => {
    let optionIndex = 0;
    let cachedLines: string[] | undefined;

    function refresh() {
      cachedLines = undefined;
      tui.requestRender();
    }

    function choose(index: number) {
      if (index >= 0 && index < blocks.length) {
        done(blocks[index]);
      }
    }

    function handleInput(data: string) {
      if (matchesKey(data, Key.up)) {
        optionIndex = Math.max(0, optionIndex - 1);
        refresh();
        return;
      }

      if (matchesKey(data, Key.down)) {
        optionIndex = Math.min(blocks.length - 1, optionIndex + 1);
        refresh();
        return;
      }

      if (matchesKey(data, Key.enter)) {
        choose(optionIndex);
        return;
      }

      if (matchesKey(data, Key.escape)) {
        done(null);
        return;
      }

      if (/^[1-9]$/.test(data)) {
        choose(Number(data) - 1);
      }
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;

      const lines: string[] = [];
      const add = (text: string) => lines.push(truncateToWidth(text, width));

      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("text", " Copy which code block?"));
      lines.push("");

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const selected = i === optionIndex;
        const prefix = selected ? theme.fg("accent", "> ") : "  ";
        const label = `${block.index}. ${block.preview}`;
        add(selected ? prefix + theme.fg("accent", label) : `  ${theme.fg("text", label)}`);
      }

      lines.push("");
      add(theme.fg("dim", " 1-9 choose • ↑↓ navigate • Enter select • Esc cancel"));
      add(theme.fg("accent", "─".repeat(width)));

      cachedLines = lines;
      return lines;
    }

    return {
      render,
      invalidate: () => {
        cachedLines = undefined;
      },
      handleInput,
    };
  });
}

function notify(ctx: CopyContext, message: string, level: "info" | "warning" | "error") {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

function updateCopyCodeStatus(ctx: CopyContext) {
  if (!ctx.hasUI) return;

  if (!extensionConfig.showStatusHint) {
    ctx.ui.setStatus("copy-code", undefined);
    return;
  }

  const { blocks } = getCodeBlocksFromRecentAssistantMessages(ctx);
  if (!blocks || blocks.length === 0) {
    ctx.ui.setStatus("copy-code", undefined);
    return;
  }

  const message =
    blocks.length === 1
      ? `${extensionConfig.statusIcon} 1 code block • ${shortcutHint} to copy`
      : `${extensionConfig.statusIcon} ${blocks.length} code blocks • /copy-code • ${shortcutHint}`;

  ctx.ui.setStatus("copy-code", ctx.ui.theme.fg("accent", message));
}

function getSingleBlockCopiedMessage(block: CodeBlock, blockCount: number, fenced: boolean): string {
  if (blockCount === 1) {
    return fenced ? "Copied fenced code block." : "Copied code block.";
  }

  return fenced ? `Copied fenced block ${block.index} of ${blockCount}.` : `Copied block ${block.index} of ${blockCount}.`;
}

function getAllBlocksCopiedMessage(blockCount: number, fenced: boolean): string {
  return fenced ? `Copied all ${blockCount} fenced code blocks.` : `Copied all ${blockCount} code blocks.`;
}

function dim(text: string): string {
  return `${ANSI_DIM}${text}${ANSI_RESET}`;
}

function padToWidth(text: string, width: number): string {
  const visible = visibleWidth(text);
  return visible >= width ? text : `${text}${" ".repeat(width - visible)}`;
}

function framedCodeLine(content: string, innerWidth: number, border: (text: string) => string): string {
  return `${border("│ ")}${truncateToWidth(content, innerWidth, "", true)}${border(" │")}`;
}

function renderCodeBlock(instance: MarkdownInternals, token: MarkdownToken, width: number, nextTokenType?: string): string[] {
  const safeWidth = Number.isFinite(width) ? Math.max(4, width) : 80;
  const innerWidth = Math.max(1, safeWidth - 4);
  const border = instance.theme.codeBlockBorder;
  const code = token.text ?? "";
  const lang = token.lang || undefined;
  const blockIndex = ENHANCE_CONTEXT.active ? Math.max(1, ENHANCE_CONTEXT.currentIndex) : 1;
  if (ENHANCE_CONTEXT.active && ENHANCE_CONTEXT.currentIndex > 0) {
    ENHANCE_CONTEXT.currentIndex--;
  }

  const label = dim(`#${blockIndex}`);
  const labelWidth = visibleWidth(label);
  const topFillWidth = Math.max(0, safeWidth - 2 - labelWidth);
  const topBorder = `${border("┌")}${border("─".repeat(topFillWidth))}${label}${border("┐")}`;
  const bottomBorder = `${border("└")}${border("─".repeat(Math.max(0, safeWidth - 2)))}${border("┘")}`;

  const lines: string[] = [truncateToWidth(topBorder, safeWidth, "", true)];
  const highlightedLines = instance.theme.highlightCode
    ? instance.theme.highlightCode(code, lang)
    : code.split("\n").map((line) => instance.theme.codeBlock(line));

  for (const highlightedLine of highlightedLines) {
    const wrapped = wrapTextWithAnsi(highlightedLine, innerWidth);
    for (const line of wrapped.length > 0 ? wrapped : [""]) {
      lines.push(framedCodeLine(line, innerWidth, border));
    }
  }

  lines.push(bottomBorder);
  if (nextTokenType && nextTokenType !== "space") {
    lines.push("");
  }

  return lines;
}

function withEnhancementContext(instance: MarkdownInternals, render: () => string[]): string[] {
  const previous = { ...ENHANCE_CONTEXT };

  ENHANCE_CONTEXT.active = true;
  ENHANCE_CONTEXT.totalBlocks = countFencedCodeBlocks(instance.text ?? "");
  ENHANCE_CONTEXT.currentIndex = ENHANCE_CONTEXT.totalBlocks;

  try {
    return render();
  } finally {
    ENHANCE_CONTEXT.active = previous.active;
    ENHANCE_CONTEXT.currentIndex = previous.currentIndex;
    ENHANCE_CONTEXT.totalBlocks = previous.totalBlocks;
    ENHANCE_CONTEXT.currentWidth = previous.currentWidth;
  }
}

export function patchMarkdownCodeBlocks(): boolean {
  const proto = Markdown.prototype as unknown as {
    render?: RenderMarkdown;
    renderToken?: RenderToken;
    renderListItem?: RenderListItem;
  } & Record<PropertyKey, unknown>;

  if (proto[PATCHED] === true) return true;

  const originalRender = proto.render;
  const originalRenderToken = proto.renderToken;
  const originalRenderListItem = proto.renderListItem;

  if (typeof originalRender !== "function" || typeof originalRenderToken !== "function" || typeof originalRenderListItem !== "function") {
    return false;
  }

  proto.render = function (width: number): string[] {
    return withEnhancementContext(this, () => originalRender.call(this, width));
  };

  proto.renderToken = function (token: MarkdownToken, width: number, nextTokenType?: string, styleContext?: unknown): string[] {
    const previousWidth = ENHANCE_CONTEXT.currentWidth;
    ENHANCE_CONTEXT.currentWidth = width;

    try {
      if (token?.type === "code") {
        return renderCodeBlock(this, token, width, nextTokenType);
      }

      return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
    } finally {
      ENHANCE_CONTEXT.currentWidth = previousWidth;
    }
  };

  proto.renderListItem = function (tokens: MarkdownToken[], parentDepth: number, styleContext?: unknown): string[] {
    const lines: string[] = [];

    for (const token of tokens) {
      if (token.type === "code") {
        const listCodeWidth = Math.max(4, (ENHANCE_CONTEXT.currentWidth ?? 80) - 2);
        lines.push(...renderCodeBlock(this, token, listCodeWidth));
        continue;
      }

      lines.push(...originalRenderListItem.call(this, [token], parentDepth, styleContext));
    }

    return lines;
  };

  proto[PATCHED] = true;
  proto[LEGACY_HIDE_PATCHED] = true;
  return true;
}

export default function codeBlockEnhancer(pi: ExtensionAPI) {
  const patched = patchMarkdownCodeBlocks();

  async function copyTextToClipboard(ctx: CopyContext, text: string, message: string): Promise<void> {
    try {
      await copyToClipboard(text);
      notify(ctx, message, "info");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      notify(ctx, `Failed to copy code block: ${errorMessage}`, "error");
    }
  }

  async function copyCodeFromLatestAssistant(ctx: CopyContext, rawRequest?: string): Promise<void> {
    const parsed = parseCopyRequest(rawRequest);
    if (parsed.error) {
      notify(ctx, parsed.error, "warning");
      return;
    }

    const request = parsed.request!;

    const { blocks, scannedAssistantMessages } = getCodeBlocksFromRecentAssistantMessages(ctx);
    if (!blocks) {
      if (scannedAssistantMessages === 0) {
        notify(ctx, "No completed assistant message found.", "warning");
      } else {
        notify(
          ctx,
          `No code blocks found in the last ${scannedAssistantMessages} assistant message${scannedAssistantMessages === 1 ? "" : "s"}.`,
          "warning",
        );
      }
      return;
    }

    if (request.kind === "all") {
      const text = formatAllBlocksForClipboard(blocks, request.fenced);
      await copyTextToClipboard(ctx, text, getAllBlocksCopiedMessage(blocks.length, request.fenced));
      return;
    }

    const resolved = resolveRequestedBlock(request.selector, blocks);
    if (resolved.error) {
      notify(ctx, resolved.error, "warning");
      return;
    }

    let block = resolved.block ?? null;
    if (!block && resolved.requiresPicker) {
      if (!ctx.hasUI) {
        notify(ctx, "Multiple code blocks found. Use /copy-code <number>, /copy-code all, or /copy-code last.", "warning");
        return;
      }

      block = await selectCodeBlock(ctx, blocks);
      if (!block) {
        notify(ctx, "Copy cancelled.", "info");
        return;
      }
    }

    if (!block) return;

    const text = formatSingleBlockForClipboard(block, request.fenced);
    const message = getSingleBlockCopiedMessage(block, blocks.length, request.fenced);
    await copyTextToClipboard(ctx, text, message);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!patched) {
      ctx.ui.notify("code-block-enhancer: unsupported pi-tui Markdown internals", "warning");
    }
    updateCopyCodeStatus(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    updateCopyCodeStatus(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    updateCopyCodeStatus(ctx);
  });

  pi.registerCommand("copy-code", {
    description: "Copy code blocks from the latest assistant message",
    getArgumentCompletions: (prefix) => {
      const lower = prefix.toLowerCase().trimStart();
      const topLevel = ["all", "fenced", "first", "last"];
      const fencedTargets = ["all", "first", "last"];

      if (lower.startsWith("fenced ")) {
        const rest = lower.slice("fenced ".length);
        const matches = fencedTargets
          .filter((option) => option.startsWith(rest))
          .map((option) => ({ value: `fenced ${option}`, label: `fenced ${option}` }));
        return matches.length > 0 ? matches : null;
      }

      const matches = topLevel
        .filter((option) => option.startsWith(lower))
        .map((option) => ({ value: option, label: option }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      await copyCodeFromLatestAssistant(ctx, args);
    },
  });

  pi.registerShortcut(extensionConfig.shortcut, {
    description: "Copy code block from latest assistant message",
    handler: async (ctx) => {
      await copyCodeFromLatestAssistant(ctx);
    },
  });
}
