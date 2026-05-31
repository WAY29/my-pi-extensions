import { FetchFormat, TinyFish } from "@tiny-fish/sdk";
import { activityMonitor } from "./activity.js";
import { getTinyfishApiKey, hasTinyfishApiKey, loadConfig, type AnyAccessConfig } from "./config.js";
import type { ExtractedContent, SearchOptions, SearchResponse, SearchResult } from "./types.js";
import { abortable } from "./utils.js";

const DEFAULT_NUM_RESULTS = 5;
const TINYFISH_SEARCH_TIMEOUT_MS = 10_000;
const TINYFISH_FETCH_TIMEOUT_MS = 150_000;
const MAX_BATCH_URLS = 10;

function clampNumResults(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_NUM_RESULTS;
  return Math.max(1, Math.min(20, Math.floor(value)));
}

function buildAnswerFromResults(results: SearchResult[]): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const snippet = result.snippet.replace(/\s+/g, " ").trim();
    if (!snippet) continue;
    parts.push(`${snippet}\nSource: ${result.title || `Source ${i + 1}`} (${result.url})`);
  }
  return parts.join("\n\n");
}

function createTinyFishClient(config: AnyAccessConfig, timeout: number): TinyFish {
  const apiKey = getTinyfishApiKey(config);
  if (!apiKey) {
    throw new Error(`Tinyfish API key not found. Create ~/.pi/agent/any-access.json with { \"tinyfishApiKey\": \"your-key\" }.`);
  }
  return new TinyFish({ apiKey, timeout });
}

export function isTinyfishAvailable(config: AnyAccessConfig = loadConfig()): boolean {
  return hasTinyfishApiKey(config);
}

export async function searchWithTinyfish(query: string, options: SearchOptions = {}, config: AnyAccessConfig = loadConfig()): Promise<SearchResponse> {
  const activityId = activityMonitor.logStart({ type: "api", query });
  try {
    const client = createTinyFishClient(config, TINYFISH_SEARCH_TIMEOUT_MS);
    const response = await abortable(client.search.query({
      query,
      location: config.searchLocation,
      language: config.searchLanguage,
    }), options.signal);

    const results = response.results
      .slice(0, clampNumResults(options.numResults))
      .map((result): SearchResult => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
      }));

    activityMonitor.logComplete(activityId, 200);
    return {
      answer: buildAnswerFromResults(results),
      results,
      provider: "tinyfish",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    throw err;
  }
}

export async function fetchUrlsWithTinyfish(urls: string[], signal?: AbortSignal, config: AnyAccessConfig = loadConfig()): Promise<ExtractedContent[]> {
  if (urls.length === 0) return [];
  if (urls.length > MAX_BATCH_URLS) {
    throw new Error(`Tinyfish fetch batch must contain at most ${MAX_BATCH_URLS} URLs`);
  }

  const activityId = activityMonitor.logStart({ type: "fetch", url: `tinyfish:${urls.length}` });
  try {
    const client = createTinyFishClient(config, TINYFISH_FETCH_TIMEOUT_MS);
    const response = await abortable(client.fetch.getContents({
      urls,
      format: FetchFormat.Markdown,
      links: true,
      image_links: false,
    }), signal);

    const byUrl = new Map<string, ExtractedContent>();

    for (const result of response.results) {
      const text = typeof result.text === "string"
        ? result.text
        : result.text == null
          ? ""
          : JSON.stringify(result.text, null, 2);

      byUrl.set(result.url, {
        url: result.url,
        title: result.title || result.final_url || result.url,
        content: text,
        error: text.length > 0 ? null : "Empty content",
        links: result.links,
        finalUrl: result.final_url,
        provider: "tinyfish",
      });
    }

    for (const error of response.errors) {
      if (!byUrl.has(error.url)) {
        byUrl.set(error.url, {
          url: error.url,
          title: error.url,
          content: "",
          error: error.error,
          provider: "tinyfish",
        });
      }
    }

    const ordered = urls.map((url): ExtractedContent => byUrl.get(url) ?? {
      url,
      title: url,
      content: "",
      error: "Tinyfish fetch returned no result for URL",
      provider: "tinyfish",
    });

    activityMonitor.logComplete(activityId, 200);
    return ordered;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    throw err;
  }
}
