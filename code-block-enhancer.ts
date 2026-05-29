import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  buildSessionContext,
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, Markdown, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const extensionConfig = {
  showStatusHint: true,
  statusIcon: "⎘",
  shortcut: Key.ctrlAlt("c"),
  previewWidth: 60,
  copyAllSeparator: "\n\n",
} as const;

const shortcutHint = formatShortcutHint(extensionConfig.shortcut);
const PATCHED = Symbol.for("pi.code-block-enhancer.patched");
const LEGACY_HIDE_PATCHED = Symbol.for("pi.hide-code-fence-markers.patched");
const ASSISTANT_MESSAGE_PATCHED = Symbol.for("pi.code-block-enhancer.assistant-message-patched");
const BRANCH_SUMMARY_PATCHED = Symbol.for("pi.code-block-enhancer.branch-summary-patched");
const COMPACTION_SUMMARY_PATCHED = Symbol.for("pi.code-block-enhancer.compaction-summary-patched");
const ORIGINAL_MARKDOWN_RENDER = Symbol.for("pi.code-block-enhancer.original-markdown-render");
const ORIGINAL_MARKDOWN_RENDER_TOKEN = Symbol.for("pi.code-block-enhancer.original-markdown-render-token");
const ORIGINAL_MARKDOWN_RENDER_LIST_ITEM = Symbol.for("pi.code-block-enhancer.original-markdown-render-list-item");
const ORIGINAL_ASSISTANT_MESSAGE_RENDER = Symbol.for("pi.code-block-enhancer.original-assistant-message-render");
const ORIGINAL_BRANCH_SUMMARY_RENDER = Symbol.for("pi.code-block-enhancer.original-branch-summary-render");
const ORIGINAL_COMPACTION_SUMMARY_RENDER = Symbol.for("pi.code-block-enhancer.original-compaction-summary-render");
const ENHANCE_CONTEXT: EnhancementContext = {
  active: false,
  currentIndex: 0,
  totalBlocks: 0,
};
const ANSI_DIM = "\x1b[2m";
const ANSI_RESET = "\x1b[0m";
const FENCE_OPEN_PATTERN = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

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
  cachedText?: string;
  cachedWidth?: number;
  cachedLines?: string[];
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

interface RenderAssignment {
  id: string;
  blockCount: number;
  startIndex: number;
}

interface MessageContentAssignment extends RenderAssignment {
  text: string;
  contentIndex: number;
}

interface CodeBlockSnapshot {
  blocks: CodeBlock[];
  assignmentsByText: Map<string, RenderAssignment[]>;
  messageAssignmentsByKey: Map<string, MessageContentAssignment[]>;
  messageAssignmentsByRef: WeakMap<AssistantMessage, MessageContentAssignment[]>;
}

interface AssignedRenderRange extends RenderAssignment {
  version: number;
}

interface SessionCodeBlockState extends CodeBlockSnapshot {
  version: number;
}

const SESSION_CODE_BLOCK_STATE: SessionCodeBlockState = {
  version: 0,
  blocks: [],
  assignmentsByText: new Map(),
  messageAssignmentsByKey: new Map(),
  messageAssignmentsByRef: new WeakMap(),
};
const MARKDOWN_RENDER_ASSIGNMENTS = new WeakMap<object, AssignedRenderRange>();
const DIRECT_MARKDOWN_RENDER_ASSIGNMENTS = new WeakMap<object, AssignedRenderRange>();
const MARKDOWN_RENDER_RANGE_KEYS = new WeakMap<object, string>();
const CLAIMED_RENDER_ASSIGNMENTS = new Set<string>();
let renderAssignmentPassActive = false;

function formatShortcutHint(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => (part.length === 1 ? part.toUpperCase() : `${part[0]!.toUpperCase()}${part.slice(1)}`))
    .join("+");
}

function normalizeMarkdownText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => normalizeMarkdownText(content.text))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function countFencedCodeBlocks(text: string): number {
  return extractCodeBlocks(text).length;
}

function appendTextCodeBlocks(
  rawText: string,
  blocks: CodeBlock[],
  assignmentsByText: Map<string, RenderAssignment[]>,
  nextIndex: number,
  contentIndex = -1,
): { nextIndex: number; assignment?: MessageContentAssignment } {
  const text = normalizeMarkdownText(rawText);
  if (!text) return { nextIndex };

  const extracted = extractCodeBlocks(text);
  if (extracted.length === 0) return { nextIndex };

  const startIndex = nextIndex;
  for (const block of extracted) {
    blocks.push({
      ...block,
      index: nextIndex++,
    });
  }

  const assignment: MessageContentAssignment = {
    id: `block-range-${startIndex}`,
    startIndex,
    blockCount: extracted.length,
    text,
    contentIndex,
  };

  const existing = assignmentsByText.get(text);
  if (existing) existing.push(assignment);
  else assignmentsByText.set(text, [assignment]);

  return { nextIndex, assignment };
}

function getVisibleSessionMessages(ctx: Pick<CopyContext, "sessionManager">): ReturnType<typeof buildSessionContext>["messages"] {
  return buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages;
}

function shouldAppendLiveAssistantMessage(ctx: Pick<CopyContext, "sessionManager">, message: AssistantMessage): boolean {
  const targetText = getAssistantText(message);
  if (!targetText) return false;

  return !getVisibleSessionMessages(ctx).some((contextMessage) => {
    if (contextMessage.role !== "assistant") return false;

    const assistantMessage = contextMessage as AssistantMessage;
    if (assistantMessage.stopReason !== "stop") return false;

    return assistantMessage === message || (assistantMessage.timestamp === message.timestamp && getAssistantText(assistantMessage) === targetText);
  });
}

function getAssistantMessageKey(message: AssistantMessage): string {
  return `${message.timestamp}:${getAssistantText(message)}`;
}

function getBranchSummaryMarkdownText(summary: string): string {
  return `**Branch Summary**\n\n${summary}`;
}

function getCompactionSummaryMarkdownText(summary: string, tokensBefore: number): string {
  return `**Compacted from ${tokensBefore.toLocaleString()} tokens**\n\n${summary}`;
}

function buildSessionCodeBlockSnapshot(
  ctx: Pick<CopyContext, "sessionManager">,
  liveAssistantMessage?: AssistantMessage,
): CodeBlockSnapshot {
  const assignmentsByText = new Map<string, RenderAssignment[]>();
  const messageAssignmentsByKey = new Map<string, MessageContentAssignment[]>();
  const messageAssignmentsByRef = new WeakMap<AssistantMessage, MessageContentAssignment[]>();
  const blocks: CodeBlock[] = [];
  let nextIndex = 1;

  const appendMessageAssignments = (message: AssistantMessage) => {
    const messageAssignments: MessageContentAssignment[] = [];

    for (let contentIndex = 0; contentIndex < message.content.length; contentIndex++) {
      const content = message.content[contentIndex];
      if (content.type !== "text") continue;
      const result = appendTextCodeBlocks(content.text, blocks, assignmentsByText, nextIndex, contentIndex);
      nextIndex = result.nextIndex;
      if (result.assignment) messageAssignments.push(result.assignment);
    }

    if (messageAssignments.length === 0) return;

    const key = getAssistantMessageKey(message);
    messageAssignmentsByKey.set(key, messageAssignments);
    messageAssignmentsByRef.set(message, messageAssignments);
  };

  for (const message of getVisibleSessionMessages(ctx)) {
    if (message.role === "assistant") {
      const assistantMessage = message as AssistantMessage;
      if (assistantMessage.stopReason !== "stop") continue;
      appendMessageAssignments(assistantMessage);
      continue;
    }

    if (message.role === "branchSummary" && typeof message.summary === "string") {
      const result = appendTextCodeBlocks(getBranchSummaryMarkdownText(message.summary), blocks, assignmentsByText, nextIndex);
      nextIndex = result.nextIndex;
      continue;
    }

    if (message.role === "compactionSummary" && typeof message.summary === "string") {
      const tokensBefore = typeof message.tokensBefore === "number" ? message.tokensBefore : 0;
      const result = appendTextCodeBlocks(
        getCompactionSummaryMarkdownText(message.summary, tokensBefore),
        blocks,
        assignmentsByText,
        nextIndex,
      );
      nextIndex = result.nextIndex;
    }
  }

  if (liveAssistantMessage && shouldAppendLiveAssistantMessage(ctx, liveAssistantMessage)) {
    appendMessageAssignments(liveAssistantMessage);
  }

  return { blocks, assignmentsByText, messageAssignmentsByKey, messageAssignmentsByRef };
}

function rebuildSessionCodeBlockState(ctx: Pick<CopyContext, "sessionManager">, liveAssistantMessage?: AssistantMessage): void {
  const snapshot = buildSessionCodeBlockSnapshot(ctx, liveAssistantMessage);
  SESSION_CODE_BLOCK_STATE.version++;
  SESSION_CODE_BLOCK_STATE.blocks = snapshot.blocks;
  SESSION_CODE_BLOCK_STATE.assignmentsByText = snapshot.assignmentsByText;
  SESSION_CODE_BLOCK_STATE.messageAssignmentsByKey = snapshot.messageAssignmentsByKey;
  SESSION_CODE_BLOCK_STATE.messageAssignmentsByRef = snapshot.messageAssignmentsByRef;
  CLAIMED_RENDER_ASSIGNMENTS.clear();
}

function beginRenderAssignmentPass(): void {
  if (renderAssignmentPassActive) return;

  CLAIMED_RENDER_ASSIGNMENTS.clear();
  renderAssignmentPassActive = true;
  queueMicrotask(() => {
    renderAssignmentPassActive = false;
  });
}

function bindDirectRenderAssignment(instance: object, assignment: RenderAssignment): void {
  DIRECT_MARKDOWN_RENDER_ASSIGNMENTS.set(instance, {
    version: SESSION_CODE_BLOCK_STATE.version,
    id: assignment.id,
    startIndex: assignment.startIndex,
    blockCount: assignment.blockCount,
  });
}

function clearMarkdownRenderCache(instance: MarkdownInternals): void {
  instance.cachedText = undefined;
  instance.cachedWidth = undefined;
  instance.cachedLines = undefined;
}

function resolveAssignedRenderRange(instance: MarkdownInternals): AssignedRenderRange | undefined {
  const direct = DIRECT_MARKDOWN_RENDER_ASSIGNMENTS.get(instance as object);
  if (direct && direct.version === SESSION_CODE_BLOCK_STATE.version) {
    CLAIMED_RENDER_ASSIGNMENTS.add(direct.id);
    MARKDOWN_RENDER_ASSIGNMENTS.set(instance as object, direct);
    return direct;
  }

  const cached = MARKDOWN_RENDER_ASSIGNMENTS.get(instance as object);
  if (cached && cached.version === SESSION_CODE_BLOCK_STATE.version) {
    CLAIMED_RENDER_ASSIGNMENTS.add(cached.id);
    return cached;
  }

  const text = normalizeMarkdownText(instance.text ?? "");
  if (!text) {
    MARKDOWN_RENDER_ASSIGNMENTS.delete(instance as object);
    return undefined;
  }

  const assignments = SESSION_CODE_BLOCK_STATE.assignmentsByText.get(text);
  if (!assignments || assignments.length === 0) {
    MARKDOWN_RENDER_ASSIGNMENTS.delete(instance as object);
    return undefined;
  }

  const match =
    (cached ? assignments.find((assignment) => assignment.id === cached.id) : undefined) ??
    (assignments.length === 1 ? assignments[0] : assignments.find((assignment) => !CLAIMED_RENDER_ASSIGNMENTS.has(assignment.id)) ?? assignments[0]);

  const resolved: AssignedRenderRange = {
    version: SESSION_CODE_BLOCK_STATE.version,
    id: match.id,
    startIndex: match.startIndex,
    blockCount: match.blockCount,
  };

  MARKDOWN_RENDER_ASSIGNMENTS.set(instance as object, resolved);
  CLAIMED_RENDER_ASSIGNMENTS.add(match.id);
  return resolved;
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

function parseOpeningFenceLine(line: string): { indent: string; marker: string; info: string } | undefined {
  const match = FENCE_OPEN_PATTERN.exec(line);
  if (!match) return undefined;

  const indent = match[1] ?? "";
  const marker = match[2] ?? "";
  const info = match[3] ?? "";
  if (marker.startsWith("`") && info.includes("`")) return undefined;

  return { indent, marker, info };
}

function isClosingFenceLine(line: string, marker: string): boolean {
  const fenceChar = marker[0];
  if (!fenceChar) return false;

  const candidate = line.trimStart();
  let markerLength = 0;
  while (candidate[markerLength] === fenceChar) markerLength++;

  return markerLength >= marker.length && /^[ \t]*$/.test(candidate.slice(markerLength));
}

function stripFenceIndent(line: string, indent: string): string {
  let stripped = line;
  for (const indentChar of indent) {
    if (stripped.startsWith(indentChar)) {
      stripped = stripped.slice(indentChar.length);
      continue;
    }
    break;
  }
  return stripped;
}

function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const opening = parseOpeningFenceLine(lines[i] ?? "");
    if (!opening) continue;

    const codeLines: string[] = [];
    i++;
    for (; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (isClosingFenceLine(line, opening.marker)) break;
      codeLines.push(stripFenceIndent(line, opening.indent));
    }

    const infoString = opening.info.trim();
    const language = infoString.split(/\s+/)[0] || "text";
    const code = codeLines.join("\n");
    blocks.push({
      index: blocks.length + 1,
      language,
      code,
      preview: getPreview(code),
    });
  }

  return blocks;
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
    let optionIndex = Math.max(0, blocks.length - 1);
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

  const blocks = SESSION_CODE_BLOCK_STATE.blocks;
  if (blocks.length === 0) {
    ctx.ui.setStatus("copy-code", undefined);
    return;
  }

  const message =
    blocks.length === 1
      ? `${extensionConfig.statusIcon} 1 session code block • ${shortcutHint} to copy`
      : `${extensionConfig.statusIcon} ${blocks.length} session code blocks • /copy-code • ${shortcutHint}`;

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
    ENHANCE_CONTEXT.currentIndex++;
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

function isMarkdownLike(value: unknown): value is MarkdownInternals & object {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as {
    render?: unknown;
    renderToken?: unknown;
    theme?: { codeBlock?: unknown; codeBlockBorder?: unknown } | null;
  };

  return (
    typeof candidate.render === "function" &&
    typeof candidate.renderToken === "function" &&
    typeof candidate.theme?.codeBlock === "function" &&
    typeof candidate.theme?.codeBlockBorder === "function"
  );
}

function assignMessageMarkdownRanges(
  message: AssistantMessage,
  markdowns: Array<MarkdownInternals & object>,
  hideThinkingBlock: boolean,
): void {
  const assignments =
    SESSION_CODE_BLOCK_STATE.messageAssignmentsByRef.get(message) ??
    SESSION_CODE_BLOCK_STATE.messageAssignmentsByKey.get(getAssistantMessageKey(message));
  if (!assignments || assignments.length === 0) return;

  const assignmentsByContentIndex = new Map(assignments.map((assignment) => [assignment.contentIndex, assignment] as const));
  const boundAssignmentIds = new Set<string>();
  let markdownIndex = 0;

  for (let contentIndex = 0; contentIndex < message.content.length && markdownIndex < markdowns.length; contentIndex++) {
    const content = message.content[contentIndex];

    if (content.type === "text" && content.text.trim()) {
      const markdown = markdowns[markdownIndex++]!;
      const assignment = assignmentsByContentIndex.get(contentIndex);
      if (!assignment) continue;
      bindDirectRenderAssignment(markdown, assignment);
      boundAssignmentIds.add(assignment.id);
      continue;
    }

    if (content.type === "thinking" && content.thinking.trim() && !hideThinkingBlock) {
      markdownIndex++;
    }
  }

  if (boundAssignmentIds.size === assignments.length) return;

  let fallbackMarkdownIndex = 0;
  for (const assignment of assignments) {
    if (boundAssignmentIds.has(assignment.id)) continue;

    while (fallbackMarkdownIndex < markdowns.length) {
      const markdown = markdowns[fallbackMarkdownIndex++]!;
      const text = normalizeMarkdownText(markdown.text ?? "");
      if (text !== assignment.text) continue;
      bindDirectRenderAssignment(markdown, assignment);
      boundAssignmentIds.add(assignment.id);
      break;
    }
  }
}

function patchAssistantMessageComponent(): boolean {
  const proto = AssistantMessageComponent.prototype as unknown as Record<PropertyKey, unknown> & {
    render?: (width: number) => string[];
    contentContainer?: { children?: object[] };
    hideThinkingBlock?: boolean;
    lastMessage?: AssistantMessage;
  };

  if (typeof proto[ORIGINAL_ASSISTANT_MESSAGE_RENDER] !== "function") {
    proto[ORIGINAL_ASSISTANT_MESSAGE_RENDER] = proto.render;
  }

  const originalRender = proto[ORIGINAL_ASSISTANT_MESSAGE_RENDER];
  if (typeof originalRender !== "function") return false;

  proto.render = function (width: number): string[] {
    const children = this.contentContainer?.children;
    const message = this.lastMessage;
    if (message && Array.isArray(children) && children.length > 0) {
      const markdowns = children.filter(isMarkdownLike);
      if (markdowns.length > 0) {
        assignMessageMarkdownRanges(message, markdowns, this.hideThinkingBlock === true);
      }
    }

    return originalRender.call(this, width);
  };

  proto[ASSISTANT_MESSAGE_PATCHED] = true;
  return true;
}

function patchSummaryMessageComponent(
  component: typeof BranchSummaryMessageComponent | typeof CompactionSummaryMessageComponent,
  marker: symbol,
  originalRenderMarker: symbol,
  getText: (message: { summary: string; tokensBefore?: number }) => string,
): boolean {
  const proto = component.prototype as unknown as Record<PropertyKey, unknown> & {
    render?: (width: number) => string[];
    children?: object[];
    message?: { summary: string; tokensBefore?: number };
  };

  if (typeof proto[originalRenderMarker] !== "function") {
    proto[originalRenderMarker] = proto.render;
  }

  const originalRender = proto[originalRenderMarker];
  if (typeof originalRender !== "function") return false;

  proto.render = function (width: number): string[] {
    const message = this.message;
    const children = this.children;
    if (message && Array.isArray(children) && children.length > 0) {
      const markdowns = children.filter(isMarkdownLike);
      const assignment = SESSION_CODE_BLOCK_STATE.assignmentsByText.get(normalizeMarkdownText(getText(message)))?.[0];
      if (assignment) {
        for (const markdown of markdowns) {
          bindDirectRenderAssignment(markdown, assignment);
        }
      }
    }

    return originalRender.call(this, width);
  };

  proto[marker] = true;
  return true;
}

function withEnhancementContext(instance: MarkdownInternals, render: () => string[]): string[] {
  const previous = { ...ENHANCE_CONTEXT };
  const assigned = resolveAssignedRenderRange(instance);
  const fallbackBlockCount = assigned ? 0 : countFencedCodeBlocks(instance.text ?? "");
  const startIndex = assigned ? assigned.startIndex : 1;
  const blockCount = assigned?.blockCount ?? fallbackBlockCount;
  const rangeKey = `${startIndex}:${blockCount}`;
  const instanceKey = instance as object;
  const previousRangeKey = MARKDOWN_RENDER_RANGE_KEYS.get(instanceKey);

  if (assigned && previousRangeKey === undefined && Array.isArray(instance.cachedLines) && instance.cachedLines.length > 0) {
    clearMarkdownRenderCache(instance);
  } else if (previousRangeKey !== undefined && previousRangeKey !== rangeKey) {
    clearMarkdownRenderCache(instance);
  }
  MARKDOWN_RENDER_RANGE_KEYS.set(instanceKey, rangeKey);

  ENHANCE_CONTEXT.active = true;
  ENHANCE_CONTEXT.totalBlocks = blockCount;
  ENHANCE_CONTEXT.currentIndex = startIndex;

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

  if (typeof proto[ORIGINAL_MARKDOWN_RENDER] !== "function") {
    proto[ORIGINAL_MARKDOWN_RENDER] = proto.render;
  }
  if (typeof proto[ORIGINAL_MARKDOWN_RENDER_TOKEN] !== "function") {
    proto[ORIGINAL_MARKDOWN_RENDER_TOKEN] = proto.renderToken;
  }
  if (typeof proto.renderListItem === "function" && typeof proto[ORIGINAL_MARKDOWN_RENDER_LIST_ITEM] !== "function") {
    proto[ORIGINAL_MARKDOWN_RENDER_LIST_ITEM] = proto.renderListItem;
  }

  const originalRender = proto[ORIGINAL_MARKDOWN_RENDER];
  const originalRenderToken = proto[ORIGINAL_MARKDOWN_RENDER_TOKEN];
  const originalRenderListItem = proto[ORIGINAL_MARKDOWN_RENDER_LIST_ITEM];

  if (typeof originalRender !== "function" || typeof originalRenderToken !== "function") {
    return false;
  }

  proto.render = function (width: number): string[] {
    beginRenderAssignmentPass();
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

  // pi-tui <= older versions rendered list items through renderListItem().
  // Newer versions render list item tokens via renderToken() inside renderList(),
  // so the renderToken patch above is already enough and no extra hook exists.
  if (typeof originalRenderListItem === "function") {
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
  }

  proto[PATCHED] = true;
  proto[LEGACY_HIDE_PATCHED] = true;
  return true;
}

export default function codeBlockEnhancer(pi: ExtensionAPI) {
  const patched = patchMarkdownCodeBlocks();
  const assistantPatched = patchAssistantMessageComponent();
  const branchSummaryPatched = patchSummaryMessageComponent(
    BranchSummaryMessageComponent,
    BRANCH_SUMMARY_PATCHED,
    ORIGINAL_BRANCH_SUMMARY_RENDER,
    (message) => getBranchSummaryMarkdownText(message.summary),
  );
  const compactionSummaryPatched = patchSummaryMessageComponent(
    CompactionSummaryMessageComponent,
    COMPACTION_SUMMARY_PATCHED,
    ORIGINAL_COMPACTION_SUMMARY_RENDER,
    (message) => getCompactionSummaryMarkdownText(message.summary, message.tokensBefore ?? 0),
  );

  async function copyTextToClipboard(ctx: CopyContext, text: string, message: string): Promise<void> {
    try {
      await copyToClipboard(text);
      notify(ctx, message, "info");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      notify(ctx, `Failed to copy code block: ${errorMessage}`, "error");
    }
  }

  async function copyCodeFromSession(ctx: CopyContext, rawRequest?: string): Promise<void> {
    const parsed = parseCopyRequest(rawRequest);
    if (parsed.error) {
      notify(ctx, parsed.error, "warning");
      return;
    }

    const request = parsed.request!;
    const blocks = SESSION_CODE_BLOCK_STATE.blocks;
    if (blocks.length === 0) {
      notify(ctx, "No code blocks found in the current session.", "warning");
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
    if (!patched || !assistantPatched || !branchSummaryPatched || !compactionSummaryPatched) {
      ctx.ui.notify("code-block-enhancer: unsupported pi-tui Markdown internals", "warning");
    }
    rebuildSessionCodeBlockState(ctx);
    updateCopyCodeStatus(ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const message = event.message as AssistantMessage;
    rebuildSessionCodeBlockState(ctx, message);
    updateCopyCodeStatus(ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const message = event.message as AssistantMessage;
    if (message.stopReason !== "stop") return;

    rebuildSessionCodeBlockState(ctx, message);
    updateCopyCodeStatus(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    rebuildSessionCodeBlockState(ctx);
    updateCopyCodeStatus(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    rebuildSessionCodeBlockState(ctx);
    updateCopyCodeStatus(ctx);
  });

  const registerCopyCodeCommand = (name: string) => {
    pi.registerCommand(name, {
      description: "Copy code blocks from the current session",
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
        await copyCodeFromSession(ctx, args);
      },
    });
  };

  registerCopyCodeCommand("copy-code");
  registerCopyCodeCommand("code-copy");

  pi.registerShortcut(extensionConfig.shortcut, {
    description: "Copy code block from current session",
    handler: async (ctx) => {
      await copyCodeFromSession(ctx);
    },
  });
}
