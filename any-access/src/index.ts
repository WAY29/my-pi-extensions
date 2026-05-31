import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { activityMonitor, type ActivityEntry } from "./activity.js";
import { executeCodeSearch } from "./code-search.js";
import { extractContent, fetchAllContent } from "./extract.js";
import { clearCloneCache } from "./github-extract.js";
import { search } from "./search.js";
import {
  clearResults,
  generateId,
  getResult,
  restoreFromSession,
  SESSION_ENTRY_TYPE,
  storeResult,
  type QueryResultData,
  type StoredSearchData,
} from "./storage.js";
import type { ExtractedContent, SearchProvider } from "./types.js";
import { resolveFetchProvider } from "./fetch-provider.js";
import { truncateContent, uniqueStrings } from "./utils.js";

const ACTIVITY_SHORTCUT = "ctrl+shift+w";
const ACTIVITY_WIDGET_KEY = "any-access-activity";
const MAX_INLINE_CONTENT = 30_000;

let widgetVisible = false;
let widgetUnsubscribe: (() => void) | null = null;
const pendingFetches = new Map<string, AbortController>();
let sessionActive = false;

function normalizeQueryList(values: unknown[]): string[] {
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) normalized.push(trimmed);
  }
  return normalized;
}

function formatSearchSummary(results: QueryResultData[]): string {
  const blocks: string[] = [];
  for (const data of results) {
    const lines: string[] = [];
    if (results.length > 1) lines.push(`## Query: \"${data.query}\"`, "");
    if (data.error) {
      lines.push(`Error: ${data.error}`);
      blocks.push(lines.join("\n"));
      continue;
    }
    if (data.answer) {
      lines.push(data.answer, "", "---", "", "**Sources:**");
    } else {
      lines.push("**Sources:**");
    }
    for (let i = 0; i < data.results.length; i++) {
      const source = data.results[i];
      lines.push(`${i + 1}. ${source.title}`, `   ${source.url}`);
      if (source.snippet) lines.push(`   ${source.snippet}`);
      lines.push("");
    }
    blocks.push(lines.join("\n").trim());
  }
  return blocks.join("\n\n").trim();
}

function formatFullResults(queryData: QueryResultData): string {
  const lines: string[] = [`## Results for: \"${queryData.query}\"`, ""];
  if (queryData.answer) {
    lines.push(queryData.answer, "", "---", "");
  }
  if (queryData.error) {
    lines.push(`Error: ${queryData.error}`);
    return lines.join("\n");
  }
  for (const source of queryData.results) {
    lines.push(`### ${source.title}`, source.url, "");
    if (source.snippet) lines.push(source.snippet, "");
  }
  return lines.join("\n").trim();
}

function hasFullInlineCoverage(urls: string[], inlineContent: ExtractedContent[] | undefined): boolean {
  if (!inlineContent || inlineContent.length === 0) return false;
  const coveredUrls = new Set(inlineContent.filter((item) => !item.error).map((item) => item.url));
  return urls.every((url) => coveredUrls.has(url));
}

function mergeFetchedContent(
  urls: string[],
  inlineContent: ExtractedContent[],
  fetchedContent: ExtractedContent[],
): ExtractedContent[] {
  const merged = new Map<string, ExtractedContent>();
  for (const content of inlineContent) merged.set(content.url, content);
  for (const content of fetchedContent) merged.set(content.url, content);
  return urls.map((url) => merged.get(url) ?? { url, title: url, content: "", error: "Content not fetched" });
}

function buildActivityWidget(ctx: ExtensionContext): string[] {
  const theme = ctx.ui.theme;
  const entries = activityMonitor.getEntries();
  const lines: string[] = [theme.fg("accent", "─── Any Access Activity " + "─".repeat(35))];

  if (entries.length === 0) {
    lines.push(theme.fg("muted", "  No activity yet"));
  } else {
    for (const entry of entries) {
      lines.push("  " + formatEntryLine(entry, theme));
    }
  }

  lines.push(theme.fg("accent", "─".repeat(60)));
  return lines;
}

function formatEntryLine(
  entry: ActivityEntry,
  theme: ExtensionContext["ui"]["theme"],
): string {
  const typeStr = entry.type === "api" ? "API" : "GET";
  const target = entry.type === "api"
    ? `\"${truncateToWidth(entry.query || "", 28, "")}\"`
    : truncateToWidth(entry.url?.replace(/^https?:\/\//, "") || "", 30, "");
  const duration = entry.endTime
    ? `${((entry.endTime - entry.startTime) / 1000).toFixed(1)}s`
    : `${((Date.now() - entry.startTime) / 1000).toFixed(1)}s`;

  let statusStr: string;
  let indicator: string;
  if (entry.error) {
    statusStr = "err";
    indicator = theme.fg("error", "✗");
  } else if (entry.status === null) {
    statusStr = "...";
    indicator = theme.fg("warning", "⋯");
  } else if (entry.status === 0) {
    statusStr = "abort";
    indicator = theme.fg("muted", "○");
  } else {
    statusStr = String(entry.status);
    indicator = entry.status >= 200 && entry.status < 300 ? theme.fg("success", "✓") : theme.fg("error", "✗");
  }

  return `${typeStr.padEnd(4)} ${target.padEnd(32)} ${statusStr.padStart(5)} ${duration.padStart(5)} ${indicator}`;
}

function updateWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(ACTIVITY_WIDGET_KEY, buildActivityWidget(ctx));
}

function handleSessionChange(ctx: ExtensionContext): void {
  restoreFromSession(ctx);
  clearCloneCache();
  activityMonitor.clear();
  widgetUnsubscribe?.();
  widgetUnsubscribe = null;
  if (widgetVisible && ctx.hasUI) {
    widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
    updateWidget(ctx);
  }
}

function persistStoredResult(pi: ExtensionAPI, data: StoredSearchData): void {
  storeResult(data.id, data);
  pi.appendEntry(SESSION_ENTRY_TYPE, data);
}

export default function anyAccessExtension(pi: ExtensionAPI) {
  function abortPendingFetches(): void {
    for (const controller of pendingFetches.values()) {
      controller.abort();
    }
    pendingFetches.clear();
  }

  function startBackgroundFetch(urls: string[], inlineContent: ExtractedContent[]): string | null {
    if (urls.length === 0) return null;

    const fetchId = generateId();
    const controller = new AbortController();
    pendingFetches.set(fetchId, controller);

    const coveredUrls = new Set(inlineContent.filter((item) => !item.error).map((item) => item.url));
    const missingUrls = urls.filter((url) => !coveredUrls.has(url));

    (async () => {
      let fetchedMissing: ExtractedContent[] = [];
      if (missingUrls.length > 0) {
        fetchedMissing = await fetchAllContent(missingUrls, controller.signal, { provider: "local" });
      }
      const merged = mergeFetchedContent(urls, inlineContent, fetchedMissing);
      if (!sessionActive || !pendingFetches.has(fetchId)) return;

      const data: StoredSearchData = {
        id: fetchId,
        type: "fetch",
        timestamp: Date.now(),
        urls: merged,
      };
      persistStoredResult(pi, data);

      const ok = merged.filter((item) => !item.error).length;
      pi.sendMessage(
        {
          customType: "any-access-content-ready",
          content: `Content fetched for ${ok}/${merged.length} URLs [${fetchId}]. Full page content now available.`,
          display: true,
        },
        { triggerTurn: true },
      );
    })().catch((err) => {
      if (!sessionActive || !pendingFetches.has(fetchId)) return;
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = (err instanceof Error && err.name === "AbortError") || message.toLowerCase().includes("abort");
      if (!isAbort) {
        pi.sendMessage(
          {
            customType: "any-access-fetch-error",
            content: `Content fetch failed [${fetchId}]: ${message}`,
            display: true,
          },
          { triggerTurn: false },
        );
      }
    }).finally(() => {
      pendingFetches.delete(fetchId);
    });

    return fetchId;
  }
  pi.on("session_start", async (_event, ctx) => {
    sessionActive = true;
    handleSessionChange(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    abortPendingFetches();
    handleSessionChange(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    sessionActive = false;
    abortPendingFetches();
    widgetUnsubscribe?.();
    widgetUnsubscribe = null;
    widgetVisible = false;
    ctx.ui.setWidget(ACTIVITY_WIDGET_KEY, undefined);
    clearCloneCache();
    clearResults();
    activityMonitor.clear();
  });

  pi.registerShortcut(ACTIVITY_SHORTCUT, {
    description: "Toggle any-access activity",
    handler: async (ctx) => {
      widgetVisible = !widgetVisible;
      if (widgetVisible) {
        widgetUnsubscribe = activityMonitor.onUpdate(() => updateWidget(ctx));
        updateWidget(ctx);
      } else {
        widgetUnsubscribe?.();
        widgetUnsubscribe = null;
        ctx.ui.setWidget(ACTIVITY_WIDGET_KEY, undefined);
      }
    },
  });

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web using Tinyfish or Exa. Tinyfish is preferred when configured; otherwise Exa is used. Returns a synthesized answer with source citations. When includeContent is true, full page content is fetched for the returned sources and stored for get_search_content.",
    promptSnippet: "Use for web research questions. Prefer {queries:[...]} with 2-4 varied angles over a single query for broader coverage.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Single search query. For research tasks, prefer 'queries' with multiple varied angles instead." })),
      queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple queries searched in sequence, each returning its own synthesized answer. Prefer this for research — vary phrasing, scope, and angle across 2-4 queries to maximize coverage." })),
      provider: Type.Optional(StringEnum(["auto", "tinyfish", "exa"], { description: "Search provider (default: auto)" })),
      includeContent: Type.Optional(Type.Boolean({ description: "Fetch full page content for returned sources" })),
      numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum results per query (default: 5)" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const rawQueryList: unknown[] = Array.isArray(params.queries)
        ? params.queries
        : (params.query !== undefined ? [params.query] : []);
      const queryList = normalizeQueryList(rawQueryList);
      if (queryList.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No query provided. Use 'query' or 'queries'." }],
          details: { error: "No query provided" },
        };
      }

      const includeContent = params.includeContent ?? false;
      const requestedProvider = (typeof params.provider === "string"
        && (params.provider === "auto" || params.provider === "tinyfish" || params.provider === "exa"))
        ? params.provider as SearchProvider
        : undefined;
      const queryResults: QueryResultData[] = [];
      const allUrls: string[] = [];
      const allInlineContent: ExtractedContent[] = [];

      for (let i = 0; i < queryList.length; i++) {
        const query = queryList[i];
        onUpdate?.({
          content: [{ type: "text", text: `Searching ${i + 1}/${queryList.length}: \"${query}\"...` }],
          details: { phase: "searching", progress: i / queryList.length, currentQuery: query },
        });

        try {
          const result = await search(query, {
            provider: requestedProvider,
            includeContent,
            numResults: params.numResults,
            signal,
          });

          queryResults.push({
            query,
            answer: result.answer,
            results: result.results,
            error: null,
            provider: result.provider,
          });

          for (const source of result.results) {
            if (!allUrls.includes(source.url)) allUrls.push(source.url);
          }

          if (result.inlineContent) {
            allInlineContent.push(...result.inlineContent);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          queryResults.push({
            query,
            answer: "",
            results: [],
            error: message,
            provider: requestedProvider && requestedProvider !== "auto"
              ? requestedProvider
              : undefined,
          });
        }
      }

      const inlineReady = includeContent && allUrls.length > 0
        ? hasFullInlineCoverage(allUrls, allInlineContent)
        : false;

      const searchId = generateId();
      persistStoredResult(pi, {
        id: searchId,
        type: "search",
        timestamp: Date.now(),
        queries: queryResults,
      });

      let fetchId: string | undefined;
      if (includeContent && allUrls.length > 0) {
        if (inlineReady) {
          const fetchedContent = mergeFetchedContent(allUrls, allInlineContent, []);
          fetchId = generateId();
          persistStoredResult(pi, {
            id: fetchId,
            type: "fetch",
            timestamp: Date.now(),
            urls: fetchedContent,
          });
        } else {
          fetchId = startBackgroundFetch(allUrls, allInlineContent) ?? undefined;
        }
      }

      const successfulQueries = queryResults.filter((item) => !item.error).length;
      const totalResults = queryResults.reduce((sum, item) => sum + item.results.length, 0);
      let output = formatSearchSummary(queryResults);
      if (fetchId && inlineReady) {
        output += `\n\n---\nFull content for ${allUrls.length} sources available [${fetchId}]. Use get_search_content({ responseId: \"${fetchId}\", urlIndex: 0 }) for full content.`;
      } else if (fetchId) {
        output += `\n\n---\nContent fetching in background [${fetchId}]. You will be notified when full content is ready.`;
      }

      return {
        content: [{ type: "text", text: output.trim() || "No results found." }],
        details: {
          queries: queryList,
          queryCount: queryList.length,
          successfulQueries,
          totalResults,
          includeContent,
          searchId,
          fetchId,
        },
      };
    },
    renderCall(args, theme) {
      const input = args as { query?: unknown; queries?: unknown };
      const rawQueryList: unknown[] = Array.isArray(input.queries)
        ? input.queries
        : (input.query !== undefined ? [input.query] : []);
      const queryList = normalizeQueryList(rawQueryList);
      if (queryList.length === 0) {
        return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"), 0, 0);
      }
      if (queryList.length === 1) {
        const display = queryList[0].length > 60 ? queryList[0].slice(0, 57) + "..." : queryList[0];
        return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `\"${display}\"`), 0, 0);
      }
      const lines = [theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `${queryList.length} queries`)];
      for (const query of queryList.slice(0, 5)) {
        const display = query.length > 50 ? query.slice(0, 47) + "..." : query;
        lines.push(theme.fg("muted", `  \"${display}\"`));
      }
      if (queryList.length > 5) lines.push(theme.fg("muted", `  ... and ${queryList.length - 5} more`));
      return new Text(lines.join("\n"), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as {
        queryCount?: number;
        successfulQueries?: number;
        totalResults?: number;
        error?: string;
        phase?: string;
        progress?: number;
        currentQuery?: string;
        fetchId?: string;
      };

      if (isPartial) {
        const progress = details?.progress ?? 0;
        const bar = "█".repeat(Math.floor(progress * 10)) + "░".repeat(10 - Math.floor(progress * 10));
        const label = details?.currentQuery || details?.phase || "searching";
        return new Text(theme.fg("accent", `[${bar}] ${label}`), 0, 0);
      }

      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      let status = theme.fg("success", `${details?.successfulQueries ?? 0}/${details?.queryCount ?? 0} queries, ${details?.totalResults ?? 0} sources`);
      if (details?.fetchId) status += theme.fg("muted", " (content ready)");
      if (!expanded) return new Text(status, 0, 0);

      const textContent = result.content.find((item) => item.type === "text")?.text || "";
      const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
      return new Text(status + "\n" + theme.fg("dim", preview), 0, 0);
    },
  });

  pi.registerTool({
    name: "code_search",
    label: "Code Search",
    description: "Search for code examples, documentation, and API references. Returns relevant code snippets and docs from GitHub, Stack Overflow, and official documentation. Use for any programming question — API usage, library examples, debugging help.",
    promptSnippet: "Use for programming/API/library questions to retrieve concrete examples and docs before implementing or debugging code.",
    parameters: Type.Object({
      query: Type.String({ description: "Programming question, API, library, or debugging topic to search for" }),
      maxTokens: Type.Optional(Type.Integer({
        minimum: 1000,
        maximum: 50000,
        description: "Maximum tokens of code/documentation context to return (default: 5000)",
      })),
    }),
    async execute(toolCallId, params, signal) {
      return await executeCodeSearch(toolCallId, params, signal);
    },
    renderCall(args, theme) {
      const { query } = args as { query?: string };
      const display = !query ? "(no query)" : query.length > 70 ? query.slice(0, 67) + "..." : query;
      return new Text(theme.fg("toolTitle", theme.bold("code_search ")) + theme.fg("accent", display), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as { query?: string; maxTokens?: number; error?: string };
      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      const summary = theme.fg("success", "code context returned") + theme.fg("muted", ` (${details?.maxTokens ?? 5000} tokens max)`);
      if (!expanded) return new Text(summary, 0, 0);

      const textContent = result.content.find((item) => item.type === "text")?.text || "";
      const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
      return new Text(summary + "\n" + theme.fg("dim", preview), 0, 0);
    },
  });

  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description: "Fetch HTTP/HTTPS URL(s) and extract readable content as markdown. Supports GitHub repository URLs with clone-aware repo browsing. Content is stored and can be retrieved with get_search_content.",
    promptSnippet: "Use to extract readable content from HTTP/HTTPS pages or GitHub repos.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
      urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs to fetch" })),
      provider: Type.Optional(StringEnum(["local", "tinyfish"], { description: "Fetch provider strategy (default: local)" })),
      forceClone: Type.Optional(Type.Boolean({ description: "Force cloning large GitHub repositories that exceed the size threshold" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const urlList = params.urls ?? (params.url ? [params.url] : []);
      if (urlList.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No URL provided." }],
          details: { error: "No URL provided" },
        };
      }

      const requestedProvider = resolveFetchProvider(params.provider);

      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${urlList.length} URL(s) via ${requestedProvider}...` }],
        details: { phase: "fetch", progress: 0, requestedProvider },
      });

      const fetchResults = await fetchAllContent(urlList, signal, {
        forceClone: params.forceClone,
        provider: requestedProvider,
      });
      const successful = fetchResults.filter((result) => !result.error).length;
      const totalChars = fetchResults.reduce((sum, result) => sum + result.content.length, 0);

      const responseId = generateId();
      persistStoredResult(pi, {
        id: responseId,
        type: "fetch",
        timestamp: Date.now(),
        urls: fetchResults,
      });

      if (urlList.length === 1) {
        const result = fetchResults[0];
        if (result.error) {
          return {
            content: [{ type: "text", text: `Error: ${result.error}` }],
            details: { urls: urlList, urlCount: 1, successful: 0, error: result.error, responseId, links: result.links ?? [], requestedProvider },
          };
        }

        const truncated = truncateContent(result.content, MAX_INLINE_CONTENT);
        let output = truncated.text;
        if (truncated.truncated) {
          output += `\n\n---\nShowing ${MAX_INLINE_CONTENT} of ${result.content.length} chars. Use get_search_content({ responseId: \"${responseId}\", urlIndex: 0 }) for full content.`;
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            urls: urlList,
            urlCount: 1,
            successful: 1,
            totalChars: result.content.length,
            title: result.title,
            responseId,
            truncated: truncated.truncated,
            links: result.links ?? [],
            requestedProvider,
          },
        };
      }

      let output = "## Fetched URLs\n\n";
      for (const result of fetchResults) {
        if (result.error) {
          output += `- ${result.url}: Error - ${result.error}\n`;
        } else {
          output += `- ${result.title || result.url} (${result.content.length} chars)\n`;
        }
      }
      output += `\n---\nUse get_search_content({ responseId: \"${responseId}\", urlIndex: 0 }) to retrieve full content.`;

      return {
        content: [{ type: "text", text: output }],
        details: { urls: urlList, urlCount: urlList.length, successful, totalChars, responseId, requestedProvider },
      };
    },
    renderCall(args, theme) {
      const { url, urls, provider } = args as { url?: string; urls?: string[]; provider?: string };
      const urlList = urls ?? (url ? [url] : []);
      if (urlList.length === 0) {
        return new Text(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("error", "(no URL)"), 0, 0);
      }
      if (urlList.length === 1) {
        const display = urlList[0].length > 60 ? urlList[0].slice(0, 57) + "..." : urlList[0];
        const suffix = provider ? theme.fg("muted", ` (${provider})`) : "";
        return new Text(theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", display) + suffix, 0, 0);
      }
      const lines = [theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", `${urlList.length} URLs`) + (provider ? theme.fg("muted", ` (${provider})`) : "")];
      for (const urlValue of urlList.slice(0, 5)) {
        const display = urlValue.length > 60 ? urlValue.slice(0, 57) + "..." : urlValue;
        lines.push(theme.fg("muted", `  ${display}`));
      }
      if (urlList.length > 5) lines.push(theme.fg("muted", `  ... and ${urlList.length - 5} more`));
      return new Text(lines.join("\n"), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as {
        urlCount?: number;
        successful?: number;
        totalChars?: number;
        error?: string;
        title?: string;
        truncated?: boolean;
        phase?: string;
        progress?: number;
        requestedProvider?: string;
      };

      if (isPartial) {
        const progress = details?.progress ?? 0;
        const bar = "█".repeat(Math.floor(progress * 10)) + "░".repeat(10 - Math.floor(progress * 10));
        return new Text(theme.fg("accent", `[${bar}] ${details?.phase || "fetching"}`), 0, 0);
      }

      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      if (details?.urlCount === 1) {
        let status = theme.fg("success", details.title || "Content") + theme.fg("muted", ` (${details.totalChars ?? 0} chars)`);
        if (details.requestedProvider) status += theme.fg("muted", ` via ${details.requestedProvider}`);
        if (details.truncated) status += theme.fg("warning", " [truncated]");
        if (!expanded) return new Text(status, 0, 0);
        const textContent = result.content.find((item) => item.type === "text")?.text || "";
        const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
        return new Text(status + "\n" + theme.fg("dim", preview), 0, 0);
      }

      const status = theme.fg((details?.successful ?? 0) > 0 ? "success" : "error", `${details?.successful}/${details?.urlCount} URLs`) + theme.fg("muted", ` (content stored${details?.requestedProvider ? ` via ${details.requestedProvider}` : ""})`);
      if (!expanded) return new Text(status, 0, 0);
      const textContent = result.content.find((item) => item.type === "text")?.text || "";
      const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
      return new Text(status + "\n" + theme.fg("dim", preview), 0, 0);
    },
  });

  pi.registerTool({
    name: "get_search_content",
    label: "Get Search Content",
    description: "Retrieve full content from a previous web_search or fetch_content call.",
    promptSnippet: "Use after web_search/fetch_content when full stored content is needed via responseId plus query/url selectors.",
    parameters: Type.Object({
      responseId: Type.String({ description: "The responseId from web_search or fetch_content" }),
      query: Type.Optional(Type.String({ description: "Get content for this query (web_search)" })),
      queryIndex: Type.Optional(Type.Number({ description: "Get content for query at index" })),
      url: Type.Optional(Type.String({ description: "Get content for this URL" })),
      urlIndex: Type.Optional(Type.Number({ description: "Get content for URL at index" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
      const data = getResult(params.responseId);
      if (!data) {
        return {
          content: [{ type: "text", text: `Error: No stored results for \"${params.responseId}\"` }],
          details: { error: "Not found", responseId: params.responseId },
        };
      }

      if (data.type === "search" && data.queries) {
        let queryData: QueryResultData | undefined;
        if (params.query !== undefined) {
          queryData = data.queries.find((item) => item.query === params.query);
          if (!queryData) {
            const available = data.queries.map((item) => `\"${item.query}\"`).join(", ");
            return {
              content: [{ type: "text", text: `Query \"${params.query}\" not found. Available: ${available}` }],
              details: { error: "Query not found" },
            };
          }
        } else if (params.queryIndex !== undefined) {
          queryData = data.queries[params.queryIndex];
          if (!queryData) {
            return {
              content: [{ type: "text", text: `Index ${params.queryIndex} out of range (0-${data.queries.length - 1})` }],
              details: { error: "Index out of range" },
            };
          }
        } else {
          const available = data.queries.map((item, index) => `${index}: \"${item.query}\"`).join(", ");
          return {
            content: [{ type: "text", text: `Specify query or queryIndex. Available: ${available}` }],
            details: { error: "No query specified" },
          };
        }

        return {
          content: [{ type: "text", text: formatFullResults(queryData) }],
          details: { query: queryData.query, resultCount: queryData.results.length },
        };
      }

      if (data.type === "fetch" && data.urls) {
        let urlData: ExtractedContent | undefined;
        if (params.url !== undefined) {
          urlData = data.urls.find((item) => item.url === params.url);
          if (!urlData) {
            const available = data.urls.map((item) => item.url).join("\n  ");
            return {
              content: [{ type: "text", text: `URL not found. Available:\n  ${available}` }],
              details: { error: "URL not found" },
            };
          }
        } else if (params.urlIndex !== undefined) {
          urlData = data.urls[params.urlIndex];
          if (!urlData) {
            return {
              content: [{ type: "text", text: `Index ${params.urlIndex} out of range (0-${data.urls.length - 1})` }],
              details: { error: "Index out of range" },
            };
          }
        } else {
          const available = data.urls.map((item, index) => `${index}: ${item.url}`).join("\n  ");
          return {
            content: [{ type: "text", text: `Specify url or urlIndex. Available:\n  ${available}` }],
            details: { error: "No URL specified" },
          };
        }

        if (urlData.error) {
          return {
            content: [{ type: "text", text: `Error for ${urlData.url}: ${urlData.error}` }],
            details: { error: urlData.error, url: urlData.url, links: urlData.links ?? [] },
          };
        }

        return {
          content: [{ type: "text", text: `# ${urlData.title}\n\n${urlData.content}` }],
          details: {
            url: urlData.url,
            title: urlData.title,
            contentLength: urlData.content.length,
            links: urlData.links ?? [],
          },
        };
      }

      return {
        content: [{ type: "text", text: "Invalid stored data format" }],
        details: { error: "Invalid data" },
      };
    },
    renderCall(args, theme) {
      const { responseId, query, queryIndex, url, urlIndex } = args as {
        responseId: string;
        query?: string;
        queryIndex?: number;
        url?: string;
        urlIndex?: number;
      };
      let target = "";
      if (query) target = `query=\"${query}\"`;
      else if (queryIndex !== undefined) target = `queryIndex=${queryIndex}`;
      else if (url) target = url.length > 30 ? url.slice(0, 27) + "..." : url;
      else if (urlIndex !== undefined) target = `urlIndex=${urlIndex}`;
      else target = responseId.slice(0, 8);
      return new Text(theme.fg("toolTitle", theme.bold("get_content ")) + theme.fg("accent", target), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as {
        error?: string;
        query?: string;
        title?: string;
        resultCount?: number;
        contentLength?: number;
      };

      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }

      const status = details?.query
        ? theme.fg("success", `\"${details.query}\"`) + theme.fg("muted", ` (${details.resultCount} results)`)
        : theme.fg("success", details?.title || "Content") + theme.fg("muted", ` (${details?.contentLength ?? 0} chars)`);
      if (!expanded) return new Text(status, 0, 0);
      const textContent = result.content.find((item) => item.type === "text")?.text || "";
      const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
      return new Text(status + "\n" + theme.fg("dim", preview), 0, 0);
    },
  });
}
