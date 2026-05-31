import { activityMonitor } from "./activity.js";
import { getExaApiKey, loadConfig } from "./config.js";
import type { ExtractedContent, SearchOptions, SearchResponse, SearchResult } from "./types.js";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const DEFAULT_NUM_RESULTS = 5;

interface ExaApiResponse {
  results?: Array<{
    title?: string;
    url?: string;
    text?: string;
    highlights?: unknown;
  }>;
}

interface ExaMcpRpcResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

type McpParsedResult = { title: string; url: string; content: string };

export interface ExaSearchExecution extends SearchResponse {
  inlineContent?: ExtractedContent[];
}

function normalizeHighlights(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function clampNumResults(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_NUM_RESULTS;
  return Math.max(1, Math.min(20, Math.floor(value)));
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(60000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function buildAnswerFromResults(results: Array<{ title: string; url: string; content: string }>): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const content = item.content.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!content) continue;
    parts.push(`${content}\nSource: ${item.title || `Source ${i + 1}`} (${item.url})`);
  }
  return parts.join("\n\n");
}

function mapResults(results: Array<{ title: string; url: string; content: string }>): SearchResult[] {
  return results.map((result, index) => ({
    title: result.title || `Source ${index + 1}`,
    url: result.url,
    snippet: result.content.replace(/\s+/g, " ").trim().slice(0, 240),
  }));
}

function mapInlineContent(results: Array<{ title: string; url: string; content: string }>): ExtractedContent[] {
  return results
    .filter((result) => result.content.trim().length > 0)
    .map((result) => ({
      url: result.url,
      title: result.title,
      content: result.content,
      error: null,
      provider: "local",
    }));
}

export async function callExaMcp(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    }),
    signal: requestSignal(signal),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Exa MCP error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const body = await response.text();
  const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));

  let parsed: ExaMcpRpcResponse | null = null;
  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const candidate = JSON.parse(payload) as ExaMcpRpcResponse;
      if (candidate?.result || candidate?.error) {
        parsed = candidate;
        break;
      }
    } catch {
    }
  }

  if (!parsed) {
    try {
      const candidate = JSON.parse(body) as ExaMcpRpcResponse;
      if (candidate?.result || candidate?.error) parsed = candidate;
    } catch {
    }
  }

  if (!parsed) throw new Error("Exa MCP returned an empty response");
  if (parsed.error) {
    const code = typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : "";
    throw new Error(`Exa MCP error${code}: ${parsed.error.message || "Unknown error"}`);
  }
  if (parsed.result?.isError) {
    const text = parsed.result.content?.find((item) => item.type === "text" && typeof item.text === "string")?.text?.trim();
    throw new Error(text || "Exa MCP returned an error");
  }

  const text = parsed.result?.content?.find((item) => item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0)?.text;
  if (!text) throw new Error("Exa MCP returned empty content");
  return text;
}

function parseMcpResults(text: string): McpParsedResult[] | null {
  const blocks = text.split(/(?=^Title: )/m).filter((block) => block.trim().length > 0);
  const parsed = blocks.map((block) => {
    const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
    const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
    let content = "";
    const textStart = block.indexOf("\nText: ");
    if (textStart >= 0) {
      content = block.slice(textStart + 7).trim();
    } else {
      const highlightsStart = block.match(/\nHighlights:\s*\n/);
      if (highlightsStart?.index != null) {
        content = block.slice(highlightsStart.index + highlightsStart[0].length).trim();
      }
    }
    content = content.replace(/\n---\s*$/, "").trim();
    return { title, url, content };
  }).filter((result) => result.url.length > 0);
  return parsed.length > 0 ? parsed : null;
}

async function searchWithExaMcp(query: string, options: SearchOptions = {}): Promise<ExaSearchExecution> {
  const activityId = activityMonitor.logStart({ type: "api", query });
  try {
    const text = await callExaMcp("web_search_exa", {
      query,
      numResults: clampNumResults(options.numResults),
      livecrawl: "fallback",
      type: "auto",
      contextMaxCharacters: options.includeContent ? 50000 : 3000,
    }, options.signal);
    const parsed = parseMcpResults(text);
    activityMonitor.logComplete(activityId, 200);
    const normalized = parsed ?? [];
    const answer = buildAnswerFromResults(normalized);
    const results = mapResults(normalized);
    return {
      answer,
      results,
      provider: "exa",
      inlineContent: options.includeContent ? mapInlineContent(normalized) : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    throw err;
  }
}

async function searchWithExaApi(query: string, options: SearchOptions = {}): Promise<ExaSearchExecution> {
  const activityId = activityMonitor.logStart({ type: "api", query });
  const apiKey = getExaApiKey(loadConfig());
  if (!apiKey) {
    throw new Error("Exa API key not configured");
  }

  try {
    const response = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: clampNumResults(options.numResults),
        contents: {
          text: options.includeContent ? true : { maxCharacters: 3000 },
          highlights: true,
        },
      }),
      signal: requestSignal(options.signal),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Exa API error ${response.status}: ${errorText.slice(0, 300)}`);
    }

    const data = await response.json() as ExaApiResponse;
    activityMonitor.logComplete(activityId, response.status);
    const normalized = (data.results ?? [])
      .filter((item): item is NonNullable<ExaApiResponse["results"]>[number] & { url: string } => !!item?.url)
      .map((item) => ({
        title: item.title || "",
        url: item.url,
        content: normalizeHighlights(item.highlights).join(" ") || item.text || "",
      }));

    return {
      answer: buildAnswerFromResults(normalized),
      results: mapResults(normalized),
      provider: "exa",
      inlineContent: options.includeContent ? mapInlineContent(normalized) : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    throw err;
  }
}

export function isExaAvailable(): boolean {
  return true;
}

export async function searchWithExa(query: string, options: SearchOptions = {}): Promise<ExaSearchExecution> {
  const apiKey = getExaApiKey(loadConfig());
  if (apiKey) {
    return await searchWithExaApi(query, options);
  }
  return await searchWithExaMcp(query, options);
}
