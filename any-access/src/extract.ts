import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import pLimit from "p-limit";
import TurndownService from "turndown";
import { activityMonitor } from "./activity.js";
import { hasTinyfishApiKey, loadConfig } from "./config.js";
import { extractGitHub } from "./github-extract.js";
import { fetchUrlsWithTinyfish } from "./tinyfish.js";
import type { ExtractedContent, FetchOptions } from "./types.js";
import { extractHeadingTitle, extractTextTitle, isAbortError } from "./utils.js";

const DEFAULT_TIMEOUT_MS = 30000;
const JINA_TIMEOUT_MS = 30000;
const CONCURRENT_LIMIT = 3;
const MIN_USEFUL_CONTENT = 500;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const fetchLimit = pLimit(CONCURRENT_LIMIT);

function abortedResult(url: string): ExtractedContent {
  return { url, title: "", content: "", error: "Aborted" };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function unsupportedScopeResult(url: string): ExtractedContent {
  return {
    url,
    title: "",
    content: "",
    error: "any-access v1 only supports HTTP/HTTPS URLs and GitHub repository URLs.",
  };
}

function isLikelyJsRendered(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;

  const bodyHtml = bodyMatch[1];
  const textContent = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const scriptCount = (html.match(/<script/gi) || []).length;
  return textContent.length < 500 && scriptCount > 3;
}

async function extractWithJinaReader(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
  const activityId = activityMonitor.logStart({ type: "api", query: `jina: ${url}` });
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/markdown",
        "X-No-Cache": "true",
      },
      signal: AbortSignal.any([
        AbortSignal.timeout(JINA_TIMEOUT_MS),
        ...(signal ? [signal] : []),
      ]),
    });

    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      return null;
    }

    const content = await response.text();
    activityMonitor.logComplete(activityId, response.status);
    const marker = content.indexOf("Markdown Content:");
    if (marker < 0) return null;
    const markdown = content.slice(marker + 17).trim();
    if (markdown.length < 100 || markdown.startsWith("Loading...") || markdown.startsWith("Please enable JavaScript")) {
      return null;
    }

    return {
      url,
      title: extractHeadingTitle(markdown) ?? (new URL(url).pathname.split("/").pop() || url),
      content: markdown,
      error: null,
      provider: "local",
    };
  } catch (err) {
    const message = errorMessage(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    return null;
  }
}

async function extractViaHttp(url: string, signal?: AbortSignal, options?: FetchOptions): Promise<ExtractedContent> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const activityId = activityMonitor.logStart({ type: "fetch", url });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      activityMonitor.logComplete(activityId, response.status);
      return { url, title: "", content: "", error: `HTTP ${response.status}: ${response.statusText}`, provider: "local" };
    }

    const contentType = response.headers.get("content-type") || "";
    const contentLengthHeader = response.headers.get("content-length");
    const maxResponseSize = 5 * 1024 * 1024;
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (contentLength > maxResponseSize) {
        activityMonitor.logComplete(activityId, response.status);
        return { url, title: "", content: "", error: `Response too large (${Math.round(contentLength / 1024 / 1024)}MB)`, provider: "local" };
      }
    }

    if (
      contentType.includes("application/pdf") ||
      contentType.includes("application/octet-stream") ||
      contentType.includes("image/") ||
      contentType.includes("audio/") ||
      contentType.includes("video/") ||
      contentType.includes("application/zip")
    ) {
      activityMonitor.logComplete(activityId, response.status);
      return {
        url,
        title: "",
        content: "",
        error: `Unsupported content type: ${contentType.split(";")[0] || "unknown"}`,
        provider: "local",
      };
    }

    const text = await response.text();
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");

    if (!isHtml) {
      activityMonitor.logComplete(activityId, response.status);
      return {
        url,
        title: extractTextTitle(text, url),
        content: text,
        error: null,
        provider: "local",
      };
    }

    const { document } = parseHTML(text);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article) {
      activityMonitor.logComplete(activityId, response.status);
      return {
        url,
        title: "",
        content: "",
        error: isLikelyJsRendered(text)
          ? "Page appears to be JavaScript-rendered (content loads dynamically)"
          : "Could not extract readable content from HTML structure",
        provider: "local",
      };
    }

    const markdown = turndown.turndown(article.content);
    activityMonitor.logComplete(activityId, response.status);

    if (markdown.length < MIN_USEFUL_CONTENT) {
      return {
        url,
        title: article.title || "",
        content: markdown,
        error: isLikelyJsRendered(text)
          ? "Page appears to be JavaScript-rendered (content loads dynamically)"
          : "Extracted content appears incomplete",
        provider: "local",
      };
    }

    return {
      url,
      title: article.title || "",
      content: markdown,
      error: null,
      provider: "local",
    };
  } catch (err) {
    const message = errorMessage(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    return { url, title: "", content: "", error: message, provider: "local" };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function extractHttpWithFallback(url: string, signal?: AbortSignal, options?: FetchOptions): Promise<ExtractedContent> {
  if (!isHttpUrl(url)) return unsupportedScopeResult(url);

  const httpResult = await extractViaHttp(url, signal, options);
  if (!httpResult.error) return httpResult;
  if (httpResult.error.startsWith("Unsupported content type") || httpResult.error.startsWith("Response too large")) {
    return httpResult;
  }

  const jinaResult = await extractWithJinaReader(url, signal);
  if (jinaResult) return jinaResult;
  return httpResult;
}

export async function extractContent(url: string, signal?: AbortSignal, options?: FetchOptions): Promise<ExtractedContent> {
  if (signal?.aborted) return abortedResult(url);

  try {
    new URL(url);
  } catch {
    return unsupportedScopeResult(url);
  }

  const githubResult = await extractGitHub(url, signal, options?.forceClone);
  if (githubResult) return githubResult;
  if (!isHttpUrl(url)) return unsupportedScopeResult(url);

  const requestedProvider = options?.provider ?? "local";
  if (requestedProvider === "tinyfish") {
    if (!hasTinyfishApiKey(loadConfig())) {
      return {
        url,
        title: "",
        content: "",
        error: "Tinyfish provider requested but tinyfishApiKey is not configured in ~/.pi/agent/any-access.json.",
      };
    }

    try {
      const [tinyfishResult] = await fetchUrlsWithTinyfish([url], signal);
      if (tinyfishResult && !tinyfishResult.error) return tinyfishResult;
    } catch (err) {
      if (isAbortError(err)) return abortedResult(url);
    }
  }

  return await extractHttpWithFallback(url, signal, options);
}

export async function fetchAllContent(urls: string[], signal?: AbortSignal, options?: FetchOptions): Promise<ExtractedContent[]> {
  return await Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));
}
