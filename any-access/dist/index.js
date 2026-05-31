import { StringEnum } from '@earendil-works/pi-ai';
import { Text, truncateToWidth } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { rmSync, existsSync, readFileSync, statSync, realpathSync, readdirSync, openSync, readSync, closeSync } from 'fs';
import { homedir } from 'os';
import { join, extname, resolve, sep } from 'path';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import pLimit from 'p-limit';
import TurndownService from 'turndown';
import { execFile } from 'child_process';
import { TinyFish, FetchFormat } from '@tiny-fish/sdk';

// src/index.ts

// src/activity.ts
var ActivityMonitor = class {
  entries = [];
  maxEntries = 10;
  listeners = /* @__PURE__ */ new Set();
  nextId = 1;
  logStart(partial) {
    const id = `act-${this.nextId++}`;
    const entry = {
      ...partial,
      id,
      startTime: Date.now(),
      status: null
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    this.notify();
    return id;
  }
  logComplete(id, status) {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    entry.endTime = Date.now();
    entry.status = status;
    this.notify();
  }
  logError(id, error) {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    entry.endTime = Date.now();
    entry.error = error;
    this.notify();
  }
  getEntries() {
    return this.entries;
  }
  onUpdate(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  clear() {
    this.entries = [];
    this.notify();
  }
  notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
      }
    }
  }
};
var activityMonitor = new ActivityMonitor();
var CONFIG_PATH = join(homedir(), ".pi", "agent", "any-access.json");
var DEFAULT_PROVIDER_PRIORITY = ["tinyfish", "exa"];
var DEFAULT_CONFIG = {
  providerPriority: DEFAULT_PROVIDER_PRIORITY,
  searchLocation: "US",
  searchLanguage: "en"
};
var cachedConfig = null;
function normalizeOptionalString(value) {
  if (typeof value !== "string") return void 0;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : void 0;
}
function normalizeProviderPriority(value) {
  const raw = Array.isArray(value) ? value : [];
  const seen = /* @__PURE__ */ new Set();
  const ordered = [];
  for (const item of raw) {
    if (item !== "tinyfish" && item !== "exa") continue;
    if (seen.has(item)) continue;
    seen.add(item);
    ordered.push(item);
  }
  for (const fallback of DEFAULT_PROVIDER_PRIORITY) {
    if (seen.has(fallback)) continue;
    seen.add(fallback);
    ordered.push(fallback);
  }
  return ordered;
}
function resolveConfig(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    tinyfishApiKey: normalizeOptionalString(data.tinyfishApiKey),
    exaApiKey: normalizeOptionalString(data.exaApiKey),
    providerPriority: normalizeProviderPriority(data.providerPriority),
    searchLocation: (normalizeOptionalString(data.searchLocation) ?? DEFAULT_CONFIG.searchLocation).toUpperCase(),
    searchLanguage: (normalizeOptionalString(data.searchLanguage) ?? DEFAULT_CONFIG.searchLanguage).toLowerCase()
  };
}
function parseConfigText(text, source = CONFIG_PATH) {
  try {
    const parsed = JSON.parse(text);
    return resolveConfig(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${source}: ${message}`);
  }
}
function loadConfig() {
  if (cachedConfig) return cachedConfig;
  if (!existsSync(CONFIG_PATH)) {
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }
  const text = readFileSync(CONFIG_PATH, "utf-8");
  cachedConfig = parseConfigText(text, CONFIG_PATH);
  return cachedConfig;
}
function getTinyfishApiKey(config = loadConfig()) {
  return config.tinyfishApiKey ?? null;
}
function hasTinyfishApiKey(config = loadConfig()) {
  return !!getTinyfishApiKey(config);
}
function getExaApiKey(config = loadConfig()) {
  const envKey = normalizeOptionalString(process.env.EXA_API_KEY);
  return envKey ?? config.exaApiKey ?? null;
}

// src/exa.ts
var EXA_SEARCH_URL = "https://api.exa.ai/search";
var EXA_MCP_URL = "https://mcp.exa.ai/mcp";
var DEFAULT_NUM_RESULTS = 5;
function normalizeHighlights(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
function clampNumResults(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_NUM_RESULTS;
  return Math.max(1, Math.min(20, Math.floor(value)));
}
function requestSignal(signal) {
  const timeout = AbortSignal.timeout(6e4);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function buildAnswerFromResults(results) {
  const parts = [];
  for (let i = 0; i < results.length; i++) {
    const item = results[i];
    const content = item.content.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!content) continue;
    parts.push(`${content}
Source: ${item.title || `Source ${i + 1}`} (${item.url})`);
  }
  return parts.join("\n\n");
}
function mapResults(results) {
  return results.map((result, index) => ({
    title: result.title || `Source ${index + 1}`,
    url: result.url,
    snippet: result.content.replace(/\s+/g, " ").trim().slice(0, 240)
  }));
}
function mapInlineContent(results) {
  return results.filter((result) => result.content.trim().length > 0).map((result) => ({
    url: result.url,
    title: result.title,
    content: result.content,
    error: null,
    provider: "local"
  }));
}
async function callExaMcp(toolName, args, signal) {
  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    }),
    signal: requestSignal(signal)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Exa MCP error ${response.status}: ${errorText.slice(0, 300)}`);
  }
  const body = await response.text();
  const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));
  let parsed = null;
  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const candidate = JSON.parse(payload);
      if (candidate?.result || candidate?.error) {
        parsed = candidate;
        break;
      }
    } catch {
    }
  }
  if (!parsed) {
    try {
      const candidate = JSON.parse(body);
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
    const text2 = parsed.result.content?.find((item) => item.type === "text" && typeof item.text === "string")?.text?.trim();
    throw new Error(text2 || "Exa MCP returned an error");
  }
  const text = parsed.result?.content?.find((item) => item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0)?.text;
  if (!text) throw new Error("Exa MCP returned empty content");
  return text;
}
function parseMcpResults(text) {
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
async function searchWithExaMcp(query, options = {}) {
  const activityId = activityMonitor.logStart({ type: "api", query });
  try {
    const text = await callExaMcp("web_search_exa", {
      query,
      numResults: clampNumResults(options.numResults),
      livecrawl: "fallback",
      type: "auto",
      contextMaxCharacters: options.includeContent ? 5e4 : 3e3
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
      inlineContent: options.includeContent ? mapInlineContent(normalized) : void 0
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    throw err;
  }
}
async function searchWithExaApi(query, options = {}) {
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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: clampNumResults(options.numResults),
        contents: {
          text: options.includeContent ? true : { maxCharacters: 3e3 },
          highlights: true
        }
      }),
      signal: requestSignal(options.signal)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Exa API error ${response.status}: ${errorText.slice(0, 300)}`);
    }
    const data = await response.json();
    activityMonitor.logComplete(activityId, response.status);
    const normalized = (data.results ?? []).filter((item) => !!item?.url).map((item) => ({
      title: item.title || "",
      url: item.url,
      content: normalizeHighlights(item.highlights).join(" ") || item.text || ""
    }));
    return {
      answer: buildAnswerFromResults(normalized),
      results: mapResults(normalized),
      provider: "exa",
      inlineContent: options.includeContent ? mapInlineContent(normalized) : void 0
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    throw err;
  }
}
function isExaAvailable() {
  return true;
}
async function searchWithExa(query, options = {}) {
  const apiKey = getExaApiKey(loadConfig());
  if (apiKey) {
    return await searchWithExaApi(query, options);
  }
  return await searchWithExaMcp(query, options);
}

// src/code-search.ts
var CODE_CONTEXT_TOOL = "get_code_context_exa";
var WEB_SEARCH_TOOL = "web_search_exa";
var DEFAULT_MAX_TOKENS = 5e3;
var codeContextToolMissing = false;
function isMissingMcpToolError(message) {
  const normalized = message.toLowerCase();
  return normalized.includes("tool") && normalized.includes("not found");
}
function buildFallbackQuery(query) {
  const normalized = query.toLowerCase();
  const hasCodeTerms = /\b(api|code|docs?|documentation|example|github|implementation|library|source|stackoverflow|stack overflow)\b/.test(normalized);
  return hasCodeTerms ? query : `${query} code examples documentation GitHub Stack Overflow official docs`;
}
function maxTokensToResultCount(maxTokens) {
  return Math.min(20, Math.max(5, Math.ceil(maxTokens / 1e3)));
}
function trimApproxTokens(text, maxTokens) {
  const maxCharacters = Math.max(1e3, maxTokens * 4);
  if (text.length <= maxCharacters) return text;
  return `${text.slice(0, maxCharacters).trimEnd()}

[Truncated by code_search to approximately ${maxTokens} tokens.]`;
}
async function executeFallbackSearch(query, maxTokens, signal) {
  const text = await callExaMcp(
    WEB_SEARCH_TOOL,
    {
      query: buildFallbackQuery(query),
      numResults: maxTokensToResultCount(maxTokens),
      livecrawl: "fallback",
      type: "auto",
      contextMaxCharacters: Math.min(5e4, Math.max(1e3, maxTokens * 4))
    },
    signal
  );
  return trimApproxTokens(text, maxTokens);
}
async function executeCodeSearch(_toolCallId, params, signal) {
  const query = params.query.trim();
  if (!query) {
    return {
      content: [{ type: "text", text: "Error: No query provided." }],
      details: { query: "", maxTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS, error: "No query provided" }
    };
  }
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  const activityId = activityMonitor.logStart({ type: "api", query });
  try {
    let mode = "web-search-fallback";
    let text;
    if (codeContextToolMissing) {
      text = await executeFallbackSearch(query, maxTokens, signal);
    } else {
      try {
        text = await callExaMcp(
          CODE_CONTEXT_TOOL,
          {
            query,
            tokensNum: maxTokens
          },
          signal
        );
        mode = "code-context";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isMissingMcpToolError(message)) throw err;
        codeContextToolMissing = true;
        text = await executeFallbackSearch(query, maxTokens, signal);
      }
    }
    activityMonitor.logComplete(activityId, 200);
    return {
      content: [{ type: "text", text }],
      details: { query, maxTokens, mode }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) {
      activityMonitor.logComplete(activityId, 0);
      throw err;
    }
    activityMonitor.logError(activityId, message);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      details: { query, maxTokens, error: message }
    };
  }
}
var MAX_TREE_ENTRIES = 200;
var MAX_INLINE_FILE_CHARS = 1e5;
var ghAvailable = null;
var ghHintShown = false;
async function checkGhAvailable() {
  if (ghAvailable !== null) return ghAvailable;
  return await new Promise((resolve) => {
    execFile("gh", ["--version"], { timeout: 5e3 }, (err) => {
      ghAvailable = !err;
      resolve(ghAvailable);
    });
  });
}
function showGhHint() {
  if (ghHintShown) return;
  ghHintShown = true;
  console.error("[any-access] Install `gh` CLI for better GitHub repo access including private repos.");
}
async function checkRepoSize(owner, repo) {
  if (!await checkGhAvailable()) return null;
  return await new Promise((resolve) => {
    execFile("gh", ["api", `repos/${owner}/${repo}`, "--jq", ".size"], { timeout: 1e4 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const kb = parseInt(stdout.trim(), 10);
      resolve(Number.isNaN(kb) ? null : kb);
    });
  });
}
async function getDefaultBranch(owner, repo) {
  if (!await checkGhAvailable()) return null;
  return await new Promise((resolve) => {
    execFile("gh", ["api", `repos/${owner}/${repo}`, "--jq", ".default_branch"], { timeout: 1e4 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const branch = stdout.trim();
      resolve(branch || null);
    });
  });
}
async function fetchTreeViaApi(owner, repo, ref) {
  if (!await checkGhAvailable()) return null;
  return await new Promise((resolve) => {
    execFile(
      "gh",
      ["api", `repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, "--jq", ".tree[].path"],
      { timeout: 15e3, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const paths = stdout.trim().split("\n").filter(Boolean);
        if (paths.length === 0) {
          resolve(null);
          return;
        }
        const truncated = paths.length > MAX_TREE_ENTRIES;
        const display = paths.slice(0, MAX_TREE_ENTRIES).join("\n");
        resolve(truncated ? display + `
... (${paths.length} total entries)` : display);
      }
    );
  });
}
async function fetchReadmeViaApi(owner, repo, ref) {
  if (!await checkGhAvailable()) return null;
  return await new Promise((resolve) => {
    execFile(
      "gh",
      ["api", `repos/${owner}/${repo}/readme?ref=${ref}`, "--jq", ".content"],
      { timeout: 1e4 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          const decoded = Buffer.from(stdout.trim(), "base64").toString("utf-8");
          resolve(decoded.length > 8192 ? decoded.slice(0, 8192) + "\n\n[README truncated at 8K chars]" : decoded);
        } catch {
          resolve(null);
        }
      }
    );
  });
}
async function fetchFileViaApi(owner, repo, path, ref) {
  if (!await checkGhAvailable()) return null;
  return await new Promise((resolve) => {
    execFile(
      "gh",
      ["api", `repos/${owner}/${repo}/contents/${path}?ref=${ref}`, "--jq", ".content"],
      { timeout: 1e4, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          resolve(Buffer.from(stdout.trim(), "base64").toString("utf-8"));
        } catch {
          resolve(null);
        }
      }
    );
  });
}
async function fetchViaApi(url, owner, repo, info, sizeNote) {
  const ref = info.ref || await getDefaultBranch(owner, repo);
  if (!ref) return null;
  const lines = [];
  if (sizeNote) {
    lines.push(sizeNote);
    lines.push("");
  }
  if (info.type === "blob" && info.path) {
    const content = await fetchFileViaApi(owner, repo, info.path, ref);
    if (!content) return null;
    lines.push(`## ${info.path}`);
    if (content.length > MAX_INLINE_FILE_CHARS) {
      lines.push(content.slice(0, MAX_INLINE_FILE_CHARS));
      lines.push("\n[File truncated at 100K chars]");
    } else {
      lines.push(content);
    }
    return {
      url,
      title: `${owner}/${repo} - ${info.path}`,
      content: lines.join("\n"),
      error: null,
      provider: "github"
    };
  }
  const [tree, readme] = await Promise.all([
    fetchTreeViaApi(owner, repo, ref),
    fetchReadmeViaApi(owner, repo, ref)
  ]);
  if (!tree && !readme) return null;
  if (tree) {
    lines.push("## Structure");
    lines.push(tree);
    lines.push("");
  }
  if (readme) {
    lines.push("## README.md");
    lines.push(readme);
    lines.push("");
  }
  lines.push("This is an API-only view. Clone the repo or use `read`/`bash` for deeper exploration.");
  return {
    url,
    title: info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`,
    content: lines.join("\n"),
    error: null,
    provider: "github"
  };
}

// src/github-extract.ts
var BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".tiff",
  ".tif",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".flv",
  ".wmv",
  ".wav",
  ".ogg",
  ".webm",
  ".flac",
  ".aac",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".zst",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".a",
  ".lib",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".sqlite",
  ".db",
  ".sqlite3",
  ".pyc",
  ".pyo",
  ".class",
  ".jar",
  ".war",
  ".iso",
  ".img",
  ".dmg"
]);
var NOISE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  "vendor",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "target",
  ".gradle",
  ".idea",
  ".vscode"
]);
var MAX_INLINE_FILE_CHARS2 = 1e5;
var MAX_TREE_ENTRIES2 = 200;
var DEFAULT_MAX_REPO_SIZE_MB = 350;
var DEFAULT_CLONE_TIMEOUT_SECONDS = 30;
var DEFAULT_CLONE_PATH = "/tmp/pi-github-repos";
var cloneCache = /* @__PURE__ */ new Map();
var NON_CODE_SEGMENTS = /* @__PURE__ */ new Set([
  "issues",
  "pull",
  "pulls",
  "discussions",
  "releases",
  "wiki",
  "actions",
  "settings",
  "security",
  "projects",
  "graphs",
  "compare",
  "commits",
  "tags",
  "branches",
  "stargazers",
  "watchers",
  "network",
  "forks",
  "milestone",
  "labels",
  "packages",
  "codespaces",
  "contribute",
  "community",
  "sponsors",
  "invitations",
  "notifications",
  "insights"
]);
function parseGitHubUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;
  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  if (segments.length < 2) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, "");
  if (NON_CODE_SEGMENTS.has(segments[2]?.toLowerCase())) return null;
  if (segments.length === 2) {
    return { owner, repo, refIsFullSha: false, type: "root" };
  }
  const action = segments[2];
  if (action !== "blob" && action !== "tree") return null;
  if (segments.length < 4) return null;
  const ref = segments[3];
  const refIsFullSha = /^[0-9a-f]{40}$/.test(ref);
  const path = segments.slice(4).join("/");
  return {
    owner,
    repo,
    ref,
    refIsFullSha,
    path,
    type: action
  };
}
function cacheKey(owner, repo, ref) {
  return ref ? `${owner}/${repo}@${ref}` : `${owner}/${repo}`;
}
function cloneDir(owner, repo, ref) {
  const dirName = ref ? `${repo}@${ref}` : repo;
  return join(DEFAULT_CLONE_PATH, owner, dirName);
}
function execClone(args, localPath, timeoutMs, signal) {
  return new Promise((resolve) => {
    const child = execFile(args[0], args.slice(1), { timeout: timeoutMs }, (err) => {
      if (err) {
        try {
          rmSync(localPath, { recursive: true, force: true });
        } catch {
        }
        resolve(null);
        return;
      }
      resolve(localPath);
    });
    if (signal) {
      const onAbort = () => child.kill();
      signal.addEventListener("abort", onAbort, { once: true });
      child.on("exit", () => signal.removeEventListener("abort", onAbort));
    }
  });
}
async function cloneRepo(owner, repo, ref, signal) {
  const localPath = cloneDir(owner, repo, ref);
  try {
    rmSync(localPath, { recursive: true, force: true });
  } catch {
  }
  const timeoutMs = DEFAULT_CLONE_TIMEOUT_SECONDS * 1e3;
  const hasGh = await checkGhAvailable();
  if (hasGh) {
    const args2 = ["gh", "repo", "clone", `${owner}/${repo}`, localPath, "--", "--depth", "1", "--single-branch"];
    if (ref) args2.push("--branch", ref);
    return await execClone(args2, localPath, timeoutMs, signal);
  }
  showGhHint();
  const gitUrl = `https://github.com/${owner}/${repo}.git`;
  const args = ["git", "clone", "--depth", "1", "--single-branch"];
  if (ref) args.push("--branch", ref);
  args.push(gitUrl, localPath);
  return await execClone(args, localPath, timeoutMs, signal);
}
function isBinaryFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  let fd;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(512);
    const bytesRead = readSync(fd, buf, 0, 512, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
  return false;
}
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function resolveWithinRepo(rootPath, relativePath) {
  const normalizedRoot = resolve(rootPath);
  const candidate = resolve(normalizedRoot, relativePath);
  if (candidate !== normalizedRoot) {
    const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
    if (!candidate.startsWith(rootPrefix)) return null;
  }
  if (!existsSync(candidate)) return candidate;
  try {
    const realRoot = realpathSync(normalizedRoot);
    const realCandidate = realpathSync(candidate);
    if (realCandidate === realRoot) return candidate;
    const realRootPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    return realCandidate.startsWith(realRootPrefix) ? candidate : null;
  } catch {
    return null;
  }
}
function readTextFile(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
function buildTree(rootPath) {
  const entries = [];
  function walk(dir, relPath) {
    if (entries.length >= MAX_TREE_ENTRIES2) return;
    let items;
    try {
      items = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const item of items) {
      if (entries.length >= MAX_TREE_ENTRIES2) return;
      if (item === ".git") continue;
      const rel = relPath ? `${relPath}/${item}` : item;
      const safePath = resolveWithinRepo(rootPath, rel);
      if (!safePath) {
        entries.push(`${rel}  [outside repo skipped]`);
        continue;
      }
      let stat;
      try {
        stat = statSync(safePath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (NOISE_DIRS.has(item)) {
          entries.push(`${rel}/  [skipped]`);
          continue;
        }
        entries.push(`${rel}/`);
        walk(safePath, rel);
      } else {
        entries.push(rel);
      }
    }
  }
  walk(rootPath, "");
  if (entries.length >= MAX_TREE_ENTRIES2) {
    entries.push(`... (truncated at ${MAX_TREE_ENTRIES2} entries)`);
  }
  return entries.join("\n");
}
function buildDirListing(rootPath, subPath) {
  const targetPath = resolveWithinRepo(rootPath, subPath);
  if (!targetPath) return "(path escapes repository root)";
  let items;
  try {
    items = readdirSync(targetPath).sort();
  } catch {
    return "(directory not readable)";
  }
  const lines = [];
  for (const item of items) {
    if (item === ".git") continue;
    const rel = subPath ? `${subPath}/${item}` : item;
    const safePath = resolveWithinRepo(rootPath, rel);
    if (!safePath) {
      lines.push(`  ${item}  (outside repo)`);
      continue;
    }
    try {
      const stat = statSync(safePath);
      lines.push(stat.isDirectory() ? `  ${item}/` : `  ${item}  (${formatFileSize(stat.size)})`);
    } catch {
      lines.push(`  ${item}  (unreadable)`);
    }
  }
  return lines.join("\n");
}
function readReadme(localPath) {
  const candidates = ["README.md", "readme.md", "README", "README.txt", "README.rst"];
  for (const name of candidates) {
    const readmePath = join(localPath, name);
    if (!existsSync(readmePath)) continue;
    try {
      const content = readFileSync(readmePath, "utf-8");
      return content.length > 8192 ? content.slice(0, 8192) + "\n\n[README truncated at 8K chars]" : content;
    } catch {
    }
  }
  return null;
}
function generateContent(localPath, info) {
  const lines = [];
  lines.push(`Repository cloned to: ${localPath}`);
  lines.push("");
  if (info.type === "root") {
    lines.push("## Structure");
    lines.push(buildTree(localPath));
    lines.push("");
    const readme = readReadme(localPath);
    if (readme) {
      lines.push("## README.md");
      lines.push(readme);
      lines.push("");
    }
    lines.push("Use `read` and `bash` tools at the path above to explore further.");
    return lines.join("\n");
  }
  if (info.type === "tree") {
    const dirPath = info.path || "";
    const fullDirPath = resolveWithinRepo(localPath, dirPath);
    if (!fullDirPath || !existsSync(fullDirPath)) {
      lines.push(`Path \`${dirPath}\` not found in clone. Showing repository root instead.`);
      lines.push("");
      lines.push("## Structure");
      lines.push(buildTree(localPath));
    } else {
      lines.push(`## ${dirPath || "/"}`);
      lines.push(buildDirListing(localPath, dirPath));
    }
    lines.push("");
    lines.push("Use `read` and `bash` tools at the path above to explore further.");
    return lines.join("\n");
  }
  const filePath = info.path || "";
  const fullFilePath = resolveWithinRepo(localPath, filePath);
  if (!fullFilePath || !existsSync(fullFilePath)) {
    lines.push(`Path \`${filePath}\` not found in clone. Showing repository root instead.`);
    lines.push("");
    lines.push("## Structure");
    lines.push(buildTree(localPath));
    lines.push("");
    lines.push("Use `read` and `bash` tools at the path above to explore further.");
    return lines.join("\n");
  }
  let stat;
  try {
    stat = statSync(fullFilePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(`Could not inspect \`${filePath}\`: ${message}`);
    lines.push("");
    lines.push("Use `read` and `bash` tools at the path above to explore further.");
    return lines.join("\n");
  }
  if (stat.isDirectory()) {
    lines.push(`## ${filePath || "/"}`);
    lines.push(buildDirListing(localPath, filePath));
    lines.push("");
    lines.push("Use `read` and `bash` tools at the path above to explore further.");
    return lines.join("\n");
  }
  if (isBinaryFile(fullFilePath)) {
    const ext = extname(filePath).replace(".", "");
    lines.push(`## ${filePath}`);
    lines.push(`Binary file (${ext}, ${formatFileSize(stat.size)}). Use \`read\` or \`bash\` tools at the path above to inspect.`);
    return lines.join("\n");
  }
  const content = readTextFile(fullFilePath);
  if (content === null) {
    lines.push(`Could not read \`${filePath}\` as UTF-8 text.`);
    lines.push("");
    lines.push("Use `read` and `bash` tools at the path above to explore further.");
    return lines.join("\n");
  }
  lines.push(`## ${filePath}`);
  if (content.length > MAX_INLINE_FILE_CHARS2) {
    lines.push(content.slice(0, MAX_INLINE_FILE_CHARS2));
    lines.push("");
    lines.push(`[File truncated at 100K chars. Full file: ${fullFilePath}]`);
  } else {
    lines.push(content);
  }
  lines.push("");
  lines.push("Use `read` and `bash` tools at the path above to explore further.");
  return lines.join("\n");
}
async function awaitCachedClone(cached, url, owner, repo, info, signal) {
  if (signal?.aborted) return null;
  const result = await cached.clonePromise;
  if (signal?.aborted) return null;
  if (result) {
    return {
      url,
      title: info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`,
      content: generateContent(result, info),
      error: null,
      provider: "github"
    };
  }
  return await fetchViaApi(url, owner, repo, info);
}
async function extractGitHub(url, signal, forceClone) {
  const info = parseGitHubUrl(url);
  if (!info) return null;
  if (signal?.aborted) return null;
  const { owner, repo } = info;
  const key = cacheKey(owner, repo, info.ref);
  const cached = cloneCache.get(key);
  if (cached) return await awaitCachedClone(cached, url, owner, repo, info, signal);
  if (info.refIsFullSha) {
    return await fetchViaApi(url, owner, repo, info, "Note: Commit SHA URLs use the GitHub API instead of cloning.");
  }
  const activityId = activityMonitor.logStart({ type: "fetch", url: `github.com/${owner}/${repo}` });
  if (!forceClone) {
    const sizeKB = await checkRepoSize(owner, repo);
    if (signal?.aborted) {
      activityMonitor.logComplete(activityId, 0);
      return null;
    }
    if (sizeKB !== null) {
      const sizeMB = sizeKB / 1024;
      if (sizeMB > DEFAULT_MAX_REPO_SIZE_MB) {
        const sizeNote = `Note: Repository is ${Math.round(sizeMB)}MB (threshold: ${DEFAULT_MAX_REPO_SIZE_MB}MB). Showing API-fetched content instead of full clone. Ask the user if they'd like to clone the full repo -- if yes, call fetch_content again with the same URL and add forceClone: true to the params.`;
        const apiView = await fetchViaApi(url, owner, repo, info, sizeNote);
        if (apiView) {
          activityMonitor.logComplete(activityId, 200);
          return apiView;
        }
        activityMonitor.logError(activityId, "api fallback unavailable for oversized repository");
        return null;
      }
    }
  }
  if (signal?.aborted) {
    activityMonitor.logComplete(activityId, 0);
    return null;
  }
  const cachedAfterSizeCheck = cloneCache.get(key);
  if (cachedAfterSizeCheck) {
    const cachedResult = await awaitCachedClone(cachedAfterSizeCheck, url, owner, repo, info, signal);
    if (signal?.aborted) activityMonitor.logComplete(activityId, 0);
    else if (cachedResult) activityMonitor.logComplete(activityId, 200);
    else activityMonitor.logError(activityId, "clone failed");
    return cachedResult;
  }
  const clonePromise = cloneRepo(owner, repo, info.ref, signal);
  cloneCache.set(key, { localPath: cloneDir(owner, repo, info.ref), clonePromise });
  const result = await clonePromise;
  if (signal?.aborted) {
    if (!result) cloneCache.delete(key);
    activityMonitor.logComplete(activityId, 0);
    return null;
  }
  if (!result) {
    cloneCache.delete(key);
    const apiFallback = await fetchViaApi(url, owner, repo, info);
    if (apiFallback) {
      activityMonitor.logComplete(activityId, 200);
      return apiFallback;
    }
    activityMonitor.logError(activityId, "clone and API fallback failed");
    return null;
  }
  activityMonitor.logComplete(activityId, 200);
  return {
    url,
    title: info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`,
    content: generateContent(result, info),
    error: null,
    provider: "github"
  };
}
function clearCloneCache() {
  for (const entry of cloneCache.values()) {
    try {
      rmSync(entry.localPath, { recursive: true, force: true });
    } catch {
    }
  }
  cloneCache.clear();
}

// src/utils.ts
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
function isAbortError(err) {
  const message = errorMessage(err).toLowerCase();
  return message.includes("abort") || message.includes("cancel");
}
async function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  return await Promise.race([
    promise,
    new Promise((_, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
    })
  ]);
}
function abortError() {
  return new DOMException("Aborted", "AbortError");
}
function extractHeadingTitle(text) {
  const match = text.match(/^#{1,2}\s+(.+)/m);
  if (!match) return null;
  const cleaned = match[1].replace(/\*+/g, "").trim();
  return cleaned || null;
}
function extractTextTitle(text, url) {
  try {
    return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
  } catch {
    return extractHeadingTitle(text) ?? url;
  }
}
function truncateContent(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars) + "\n\n[Content truncated...]", truncated: true };
}

// src/tinyfish.ts
var DEFAULT_NUM_RESULTS2 = 5;
var TINYFISH_SEARCH_TIMEOUT_MS = 1e4;
var TINYFISH_FETCH_TIMEOUT_MS = 15e4;
var MAX_BATCH_URLS = 10;
function clampNumResults2(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_NUM_RESULTS2;
  return Math.max(1, Math.min(20, Math.floor(value)));
}
function buildAnswerFromResults2(results) {
  const parts = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const snippet = result.snippet.replace(/\s+/g, " ").trim();
    if (!snippet) continue;
    parts.push(`${snippet}
Source: ${result.title || `Source ${i + 1}`} (${result.url})`);
  }
  return parts.join("\n\n");
}
function createTinyFishClient(config, timeout) {
  const apiKey = getTinyfishApiKey(config);
  if (!apiKey) {
    throw new Error(`Tinyfish API key not found. Create ~/.pi/agent/any-access.json with { "tinyfishApiKey": "your-key" }.`);
  }
  return new TinyFish({ apiKey, timeout });
}
async function searchWithTinyfish(query, options = {}, config = loadConfig()) {
  const activityId = activityMonitor.logStart({ type: "api", query });
  try {
    const client = createTinyFishClient(config, TINYFISH_SEARCH_TIMEOUT_MS);
    const response = await abortable(client.search.query({
      query,
      location: config.searchLocation,
      language: config.searchLanguage
    }), options.signal);
    const results = response.results.slice(0, clampNumResults2(options.numResults)).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet
    }));
    activityMonitor.logComplete(activityId, 200);
    return {
      answer: buildAnswerFromResults2(results),
      results,
      provider: "tinyfish"
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    throw err;
  }
}
async function fetchUrlsWithTinyfish(urls, signal, config = loadConfig()) {
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
      image_links: false
    }), signal);
    const byUrl = /* @__PURE__ */ new Map();
    for (const result of response.results) {
      const text = typeof result.text === "string" ? result.text : result.text == null ? "" : JSON.stringify(result.text, null, 2);
      byUrl.set(result.url, {
        url: result.url,
        title: result.title || result.final_url || result.url,
        content: text,
        error: text.length > 0 ? null : "Empty content",
        links: result.links,
        finalUrl: result.final_url,
        provider: "tinyfish"
      });
    }
    for (const error of response.errors) {
      if (!byUrl.has(error.url)) {
        byUrl.set(error.url, {
          url: error.url,
          title: error.url,
          content: "",
          error: error.error,
          provider: "tinyfish"
        });
      }
    }
    const ordered = urls.map((url) => byUrl.get(url) ?? {
      url,
      title: url,
      content: "",
      error: "Tinyfish fetch returned no result for URL",
      provider: "tinyfish"
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

// src/extract.ts
var DEFAULT_TIMEOUT_MS = 3e4;
var JINA_TIMEOUT_MS = 3e4;
var CONCURRENT_LIMIT = 3;
var MIN_USEFUL_CONTENT = 500;
var turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced"
});
var fetchLimit = pLimit(CONCURRENT_LIMIT);
function abortedResult(url) {
  return { url, title: "", content: "", error: "Aborted" };
}
function errorMessage2(err) {
  return err instanceof Error ? err.message : String(err);
}
function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
function unsupportedScopeResult(url) {
  return {
    url,
    title: "",
    content: "",
    error: "any-access v1 only supports HTTP/HTTPS URLs and GitHub repository URLs."
  };
}
function isLikelyJsRendered(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;
  const bodyHtml = bodyMatch[1];
  const textContent = bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const scriptCount = (html.match(/<script/gi) || []).length;
  return textContent.length < 500 && scriptCount > 3;
}
async function extractWithJinaReader(url, signal) {
  const activityId = activityMonitor.logStart({ type: "api", query: `jina: ${url}` });
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/markdown",
        "X-No-Cache": "true"
      },
      signal: AbortSignal.any([
        AbortSignal.timeout(JINA_TIMEOUT_MS),
        ...signal ? [signal] : []
      ])
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
      provider: "local"
    };
  } catch (err) {
    const message = errorMessage2(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    return null;
  }
}
async function extractViaHttp(url, signal, options) {
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
        "Cache-Control": "no-cache"
      }
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
    if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream") || contentType.includes("image/") || contentType.includes("audio/") || contentType.includes("video/") || contentType.includes("application/zip")) {
      activityMonitor.logComplete(activityId, response.status);
      return {
        url,
        title: "",
        content: "",
        error: `Unsupported content type: ${contentType.split(";")[0] || "unknown"}`,
        provider: "local"
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
        provider: "local"
      };
    }
    const { document } = parseHTML(text);
    const reader = new Readability(document);
    const article = reader.parse();
    if (!article) {
      activityMonitor.logComplete(activityId, response.status);
      return {
        url,
        title: "",
        content: "",
        error: isLikelyJsRendered(text) ? "Page appears to be JavaScript-rendered (content loads dynamically)" : "Could not extract readable content from HTML structure",
        provider: "local"
      };
    }
    const markdown = turndown.turndown(article.content);
    activityMonitor.logComplete(activityId, response.status);
    if (markdown.length < MIN_USEFUL_CONTENT) {
      return {
        url,
        title: article.title || "",
        content: markdown,
        error: isLikelyJsRendered(text) ? "Page appears to be JavaScript-rendered (content loads dynamically)" : "Extracted content appears incomplete",
        provider: "local"
      };
    }
    return {
      url,
      title: article.title || "",
      content: markdown,
      error: null,
      provider: "local"
    };
  } catch (err) {
    const message = errorMessage2(err);
    if (message.toLowerCase().includes("abort")) activityMonitor.logComplete(activityId, 0);
    else activityMonitor.logError(activityId, message);
    return { url, title: "", content: "", error: message, provider: "local" };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}
async function extractHttpWithFallback(url, signal, options) {
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
async function extractContent(url, signal, options) {
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
        error: "Tinyfish provider requested but tinyfishApiKey is not configured in ~/.pi/agent/any-access.json."
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
async function fetchAllContent(urls, signal, options) {
  return await Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));
}

// src/search.ts
function currentAvailability(config) {
  return {
    tinyfish: hasTinyfishApiKey(config),
    exa: isExaAvailable()
  };
}
function resolveSearchProviderOrder(requested, availability, config) {
  const provider = requested ?? "auto";
  if (provider === "tinyfish") return ["tinyfish"];
  if (provider === "exa") return ["exa"];
  return config.providerPriority.filter((candidate) => availability[candidate]);
}
async function search(query, options = {}) {
  const config = loadConfig();
  const availability = currentAvailability(config);
  const providerOrder = resolveSearchProviderOrder(options.provider, availability, config);
  if (providerOrder.length === 0) {
    throw new Error("No search providers available. Configure tinyfishApiKey or use Exa.");
  }
  const errors = [];
  for (const provider of providerOrder) {
    try {
      if (provider === "tinyfish") {
        return await searchWithTinyfish(query, options, config);
      }
      const exaResult = await searchWithExa(query, options);
      return exaResult;
    } catch (err) {
      if (options.provider && options.provider !== "auto") throw err;
      errors.push(`${provider}: ${errorMessage(err)}`);
    }
  }
  throw new Error(errors.join(" | ") || "Search failed");
}

// src/storage.ts
var CACHE_TTL_MS = 60 * 60 * 1e3;
var SESSION_ENTRY_TYPE = "any-access-results";
var storedResults = /* @__PURE__ */ new Map();
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function storeResult(id, data) {
  storedResults.set(id, data);
}
function getResult(id) {
  return storedResults.get(id) ?? null;
}
function clearResults() {
  storedResults.clear();
}
function isValidStoredData(data) {
  if (!data || typeof data !== "object") return false;
  const candidate = data;
  if (typeof candidate.id !== "string" || !candidate.id) return false;
  if (candidate.type !== "search" && candidate.type !== "fetch") return false;
  if (typeof candidate.timestamp !== "number") return false;
  if (candidate.type === "search" && !Array.isArray(candidate.queries)) return false;
  if (candidate.type === "fetch" && !Array.isArray(candidate.urls)) return false;
  return true;
}
function restoreFromSession(ctx) {
  storedResults.clear();
  const now = Date.now();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== SESSION_ENTRY_TYPE) continue;
    const data = entry.data;
    if (!isValidStoredData(data)) continue;
    if (now - data.timestamp >= CACHE_TTL_MS) continue;
    storedResults.set(data.id, data);
  }
}

// src/fetch-provider.ts
function resolveFetchProvider(value) {
  return value === "tinyfish" ? "tinyfish" : "local";
}

// src/index.ts
var ACTIVITY_SHORTCUT = "ctrl+shift+w";
var ACTIVITY_WIDGET_KEY = "any-access-activity";
var MAX_INLINE_CONTENT = 3e4;
var widgetVisible = false;
var widgetUnsubscribe = null;
var pendingFetches = /* @__PURE__ */ new Map();
var sessionActive = false;
function normalizeQueryList(values) {
  const normalized = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) normalized.push(trimmed);
  }
  return normalized;
}
function formatSearchSummary(results) {
  const blocks = [];
  for (const data of results) {
    const lines = [];
    if (results.length > 1) lines.push(`## Query: "${data.query}"`, "");
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
function formatFullResults(queryData) {
  const lines = [`## Results for: "${queryData.query}"`, ""];
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
function hasFullInlineCoverage(urls, inlineContent) {
  if (!inlineContent || inlineContent.length === 0) return false;
  const coveredUrls = new Set(inlineContent.filter((item) => !item.error).map((item) => item.url));
  return urls.every((url) => coveredUrls.has(url));
}
function mergeFetchedContent(urls, inlineContent, fetchedContent) {
  const merged = /* @__PURE__ */ new Map();
  for (const content of inlineContent) merged.set(content.url, content);
  for (const content of fetchedContent) merged.set(content.url, content);
  return urls.map((url) => merged.get(url) ?? { url, title: url, content: "", error: "Content not fetched" });
}
function buildActivityWidget(ctx) {
  const theme = ctx.ui.theme;
  const entries = activityMonitor.getEntries();
  const lines = [theme.fg("accent", "\u2500\u2500\u2500 Any Access Activity " + "\u2500".repeat(35))];
  if (entries.length === 0) {
    lines.push(theme.fg("muted", "  No activity yet"));
  } else {
    for (const entry of entries) {
      lines.push("  " + formatEntryLine(entry, theme));
    }
  }
  lines.push(theme.fg("accent", "\u2500".repeat(60)));
  return lines;
}
function formatEntryLine(entry, theme) {
  const typeStr = entry.type === "api" ? "API" : "GET";
  const target = entry.type === "api" ? `"${truncateToWidth(entry.query || "", 28, "")}"` : truncateToWidth(entry.url?.replace(/^https?:\/\//, "") || "", 30, "");
  const duration = entry.endTime ? `${((entry.endTime - entry.startTime) / 1e3).toFixed(1)}s` : `${((Date.now() - entry.startTime) / 1e3).toFixed(1)}s`;
  let statusStr;
  let indicator;
  if (entry.error) {
    statusStr = "err";
    indicator = theme.fg("error", "\u2717");
  } else if (entry.status === null) {
    statusStr = "...";
    indicator = theme.fg("warning", "\u22EF");
  } else if (entry.status === 0) {
    statusStr = "abort";
    indicator = theme.fg("muted", "\u25CB");
  } else {
    statusStr = String(entry.status);
    indicator = entry.status >= 200 && entry.status < 300 ? theme.fg("success", "\u2713") : theme.fg("error", "\u2717");
  }
  return `${typeStr.padEnd(4)} ${target.padEnd(32)} ${statusStr.padStart(5)} ${duration.padStart(5)} ${indicator}`;
}
function updateWidget(ctx) {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(ACTIVITY_WIDGET_KEY, buildActivityWidget(ctx));
}
function handleSessionChange(ctx) {
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
function persistStoredResult(pi, data) {
  storeResult(data.id, data);
  pi.appendEntry(SESSION_ENTRY_TYPE, data);
}
function anyAccessExtension(pi) {
  function abortPendingFetches() {
    for (const controller of pendingFetches.values()) {
      controller.abort();
    }
    pendingFetches.clear();
  }
  function startBackgroundFetch(urls, inlineContent) {
    if (urls.length === 0) return null;
    const fetchId = generateId();
    const controller = new AbortController();
    pendingFetches.set(fetchId, controller);
    const coveredUrls = new Set(inlineContent.filter((item) => !item.error).map((item) => item.url));
    const missingUrls = urls.filter((url) => !coveredUrls.has(url));
    (async () => {
      let fetchedMissing = [];
      if (missingUrls.length > 0) {
        fetchedMissing = await fetchAllContent(missingUrls, controller.signal, { provider: "local" });
      }
      const merged = mergeFetchedContent(urls, inlineContent, fetchedMissing);
      if (!sessionActive || !pendingFetches.has(fetchId)) return;
      const data = {
        id: fetchId,
        type: "fetch",
        timestamp: Date.now(),
        urls: merged
      };
      persistStoredResult(pi, data);
      const ok = merged.filter((item) => !item.error).length;
      pi.sendMessage(
        {
          customType: "any-access-content-ready",
          content: `Content fetched for ${ok}/${merged.length} URLs [${fetchId}]. Full page content now available.`,
          display: true
        },
        { triggerTurn: true }
      );
    })().catch((err) => {
      if (!sessionActive || !pendingFetches.has(fetchId)) return;
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && err.name === "AbortError" || message.toLowerCase().includes("abort");
      if (!isAbort) {
        pi.sendMessage(
          {
            customType: "any-access-fetch-error",
            content: `Content fetch failed [${fetchId}]: ${message}`,
            display: true
          },
          { triggerTurn: false }
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
    ctx.ui.setWidget(ACTIVITY_WIDGET_KEY, void 0);
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
        ctx.ui.setWidget(ACTIVITY_WIDGET_KEY, void 0);
      }
    }
  });
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web using Tinyfish or Exa. Tinyfish is preferred when configured; otherwise Exa is used. Returns a synthesized answer with source citations. When includeContent is true, full page content is fetched for the returned sources and stored for get_search_content.",
    promptSnippet: "Use for web research questions. Prefer {queries:[...]} with 2-4 varied angles over a single query for broader coverage.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Single search query. For research tasks, prefer 'queries' with multiple varied angles instead." })),
      queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple queries searched in sequence, each returning its own synthesized answer. Prefer this for research \u2014 vary phrasing, scope, and angle across 2-4 queries to maximize coverage." })),
      provider: Type.Optional(StringEnum(["auto", "tinyfish", "exa"], { description: "Search provider (default: auto)" })),
      includeContent: Type.Optional(Type.Boolean({ description: "Fetch full page content for returned sources" })),
      numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Maximum results per query (default: 5)" }))
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const rawQueryList = Array.isArray(params.queries) ? params.queries : params.query !== void 0 ? [params.query] : [];
      const queryList = normalizeQueryList(rawQueryList);
      if (queryList.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No query provided. Use 'query' or 'queries'." }],
          details: { error: "No query provided" }
        };
      }
      const includeContent = params.includeContent ?? false;
      const requestedProvider = typeof params.provider === "string" && (params.provider === "auto" || params.provider === "tinyfish" || params.provider === "exa") ? params.provider : void 0;
      const queryResults = [];
      const allUrls = [];
      const allInlineContent = [];
      for (let i = 0; i < queryList.length; i++) {
        const query = queryList[i];
        onUpdate?.({
          content: [{ type: "text", text: `Searching ${i + 1}/${queryList.length}: "${query}"...` }],
          details: { phase: "searching", progress: i / queryList.length, currentQuery: query }
        });
        try {
          const result = await search(query, {
            provider: requestedProvider,
            includeContent,
            numResults: params.numResults,
            signal
          });
          queryResults.push({
            query,
            answer: result.answer,
            results: result.results,
            error: null,
            provider: result.provider
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
            provider: requestedProvider && requestedProvider !== "auto" ? requestedProvider : void 0
          });
        }
      }
      const inlineReady = includeContent && allUrls.length > 0 ? hasFullInlineCoverage(allUrls, allInlineContent) : false;
      const searchId = generateId();
      persistStoredResult(pi, {
        id: searchId,
        type: "search",
        timestamp: Date.now(),
        queries: queryResults
      });
      let fetchId;
      if (includeContent && allUrls.length > 0) {
        if (inlineReady) {
          const fetchedContent = mergeFetchedContent(allUrls, allInlineContent, []);
          fetchId = generateId();
          persistStoredResult(pi, {
            id: fetchId,
            type: "fetch",
            timestamp: Date.now(),
            urls: fetchedContent
          });
        } else {
          fetchId = startBackgroundFetch(allUrls, allInlineContent) ?? void 0;
        }
      }
      const successfulQueries = queryResults.filter((item) => !item.error).length;
      const totalResults = queryResults.reduce((sum, item) => sum + item.results.length, 0);
      let output = formatSearchSummary(queryResults);
      if (fetchId && inlineReady) {
        output += `

---
Full content for ${allUrls.length} sources available [${fetchId}]. Use get_search_content({ responseId: "${fetchId}", urlIndex: 0 }) for full content.`;
      } else if (fetchId) {
        output += `

---
Content fetching in background [${fetchId}]. You will be notified when full content is ready.`;
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
          fetchId
        }
      };
    },
    renderCall(args, theme) {
      const input = args;
      const rawQueryList = Array.isArray(input.queries) ? input.queries : input.query !== void 0 ? [input.query] : [];
      const queryList = normalizeQueryList(rawQueryList);
      if (queryList.length === 0) {
        return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"), 0, 0);
      }
      if (queryList.length === 1) {
        const display = queryList[0].length > 60 ? queryList[0].slice(0, 57) + "..." : queryList[0];
        return new Text(theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `"${display}"`), 0, 0);
      }
      const lines = [theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `${queryList.length} queries`)];
      for (const query of queryList.slice(0, 5)) {
        const display = query.length > 50 ? query.slice(0, 47) + "..." : query;
        lines.push(theme.fg("muted", `  "${display}"`));
      }
      if (queryList.length > 5) lines.push(theme.fg("muted", `  ... and ${queryList.length - 5} more`));
      return new Text(lines.join("\n"), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details;
      if (isPartial) {
        const progress = details?.progress ?? 0;
        const bar = "\u2588".repeat(Math.floor(progress * 10)) + "\u2591".repeat(10 - Math.floor(progress * 10));
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
    }
  });
  pi.registerTool({
    name: "code_search",
    label: "Code Search",
    description: "Search for code examples, documentation, and API references. Returns relevant code snippets and docs from GitHub, Stack Overflow, and official documentation. Use for any programming question \u2014 API usage, library examples, debugging help.",
    promptSnippet: "Use for programming/API/library questions to retrieve concrete examples and docs before implementing or debugging code.",
    parameters: Type.Object({
      query: Type.String({ description: "Programming question, API, library, or debugging topic to search for" }),
      maxTokens: Type.Optional(Type.Integer({
        minimum: 1e3,
        maximum: 5e4,
        description: "Maximum tokens of code/documentation context to return (default: 5000)"
      }))
    }),
    async execute(toolCallId, params, signal) {
      return await executeCodeSearch(toolCallId, params, signal);
    },
    renderCall(args, theme) {
      const { query } = args;
      const display = !query ? "(no query)" : query.length > 70 ? query.slice(0, 67) + "..." : query;
      return new Text(theme.fg("toolTitle", theme.bold("code_search ")) + theme.fg("accent", display), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details;
      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }
      const summary = theme.fg("success", "code context returned") + theme.fg("muted", ` (${details?.maxTokens ?? 5e3} tokens max)`);
      if (!expanded) return new Text(summary, 0, 0);
      const textContent = result.content.find((item) => item.type === "text")?.text || "";
      const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
      return new Text(summary + "\n" + theme.fg("dim", preview), 0, 0);
    }
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
      forceClone: Type.Optional(Type.Boolean({ description: "Force cloning large GitHub repositories that exceed the size threshold" }))
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const urlList = params.urls ?? (params.url ? [params.url] : []);
      if (urlList.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No URL provided." }],
          details: { error: "No URL provided" }
        };
      }
      const requestedProvider = resolveFetchProvider(params.provider);
      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${urlList.length} URL(s) via ${requestedProvider}...` }],
        details: { phase: "fetch", progress: 0, requestedProvider }
      });
      const fetchResults = await fetchAllContent(urlList, signal, {
        forceClone: params.forceClone,
        provider: requestedProvider
      });
      const successful = fetchResults.filter((result) => !result.error).length;
      const totalChars = fetchResults.reduce((sum, result) => sum + result.content.length, 0);
      const responseId = generateId();
      persistStoredResult(pi, {
        id: responseId,
        type: "fetch",
        timestamp: Date.now(),
        urls: fetchResults
      });
      if (urlList.length === 1) {
        const result = fetchResults[0];
        if (result.error) {
          return {
            content: [{ type: "text", text: `Error: ${result.error}` }],
            details: { urls: urlList, urlCount: 1, successful: 0, error: result.error, responseId, links: result.links ?? [], requestedProvider }
          };
        }
        const truncated = truncateContent(result.content, MAX_INLINE_CONTENT);
        let output2 = truncated.text;
        if (truncated.truncated) {
          output2 += `

---
Showing ${MAX_INLINE_CONTENT} of ${result.content.length} chars. Use get_search_content({ responseId: "${responseId}", urlIndex: 0 }) for full content.`;
        }
        return {
          content: [{ type: "text", text: output2 }],
          details: {
            urls: urlList,
            urlCount: 1,
            successful: 1,
            totalChars: result.content.length,
            title: result.title,
            responseId,
            truncated: truncated.truncated,
            links: result.links ?? [],
            requestedProvider
          }
        };
      }
      let output = "## Fetched URLs\n\n";
      for (const result of fetchResults) {
        if (result.error) {
          output += `- ${result.url}: Error - ${result.error}
`;
        } else {
          output += `- ${result.title || result.url} (${result.content.length} chars)
`;
        }
      }
      output += `
---
Use get_search_content({ responseId: "${responseId}", urlIndex: 0 }) to retrieve full content.`;
      return {
        content: [{ type: "text", text: output }],
        details: { urls: urlList, urlCount: urlList.length, successful, totalChars, responseId, requestedProvider }
      };
    },
    renderCall(args, theme) {
      const { url, urls, provider } = args;
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
      const details = result.details;
      if (isPartial) {
        const progress = details?.progress ?? 0;
        const bar = "\u2588".repeat(Math.floor(progress * 10)) + "\u2591".repeat(10 - Math.floor(progress * 10));
        return new Text(theme.fg("accent", `[${bar}] ${details?.phase || "fetching"}`), 0, 0);
      }
      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }
      if (details?.urlCount === 1) {
        let status2 = theme.fg("success", details.title || "Content") + theme.fg("muted", ` (${details.totalChars ?? 0} chars)`);
        if (details.requestedProvider) status2 += theme.fg("muted", ` via ${details.requestedProvider}`);
        if (details.truncated) status2 += theme.fg("warning", " [truncated]");
        if (!expanded) return new Text(status2, 0, 0);
        const textContent2 = result.content.find((item) => item.type === "text")?.text || "";
        const preview2 = textContent2.length > 500 ? textContent2.slice(0, 500) + "..." : textContent2;
        return new Text(status2 + "\n" + theme.fg("dim", preview2), 0, 0);
      }
      const status = theme.fg((details?.successful ?? 0) > 0 ? "success" : "error", `${details?.successful}/${details?.urlCount} URLs`) + theme.fg("muted", ` (content stored${details?.requestedProvider ? ` via ${details.requestedProvider}` : ""})`);
      if (!expanded) return new Text(status, 0, 0);
      const textContent = result.content.find((item) => item.type === "text")?.text || "";
      const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
      return new Text(status + "\n" + theme.fg("dim", preview), 0, 0);
    }
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
      urlIndex: Type.Optional(Type.Number({ description: "Get content for URL at index" }))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const data = getResult(params.responseId);
      if (!data) {
        return {
          content: [{ type: "text", text: `Error: No stored results for "${params.responseId}"` }],
          details: { error: "Not found", responseId: params.responseId }
        };
      }
      if (data.type === "search" && data.queries) {
        let queryData;
        if (params.query !== void 0) {
          queryData = data.queries.find((item) => item.query === params.query);
          if (!queryData) {
            const available = data.queries.map((item) => `"${item.query}"`).join(", ");
            return {
              content: [{ type: "text", text: `Query "${params.query}" not found. Available: ${available}` }],
              details: { error: "Query not found" }
            };
          }
        } else if (params.queryIndex !== void 0) {
          queryData = data.queries[params.queryIndex];
          if (!queryData) {
            return {
              content: [{ type: "text", text: `Index ${params.queryIndex} out of range (0-${data.queries.length - 1})` }],
              details: { error: "Index out of range" }
            };
          }
        } else {
          const available = data.queries.map((item, index) => `${index}: "${item.query}"`).join(", ");
          return {
            content: [{ type: "text", text: `Specify query or queryIndex. Available: ${available}` }],
            details: { error: "No query specified" }
          };
        }
        return {
          content: [{ type: "text", text: formatFullResults(queryData) }],
          details: { query: queryData.query, resultCount: queryData.results.length }
        };
      }
      if (data.type === "fetch" && data.urls) {
        let urlData;
        if (params.url !== void 0) {
          urlData = data.urls.find((item) => item.url === params.url);
          if (!urlData) {
            const available = data.urls.map((item) => item.url).join("\n  ");
            return {
              content: [{ type: "text", text: `URL not found. Available:
  ${available}` }],
              details: { error: "URL not found" }
            };
          }
        } else if (params.urlIndex !== void 0) {
          urlData = data.urls[params.urlIndex];
          if (!urlData) {
            return {
              content: [{ type: "text", text: `Index ${params.urlIndex} out of range (0-${data.urls.length - 1})` }],
              details: { error: "Index out of range" }
            };
          }
        } else {
          const available = data.urls.map((item, index) => `${index}: ${item.url}`).join("\n  ");
          return {
            content: [{ type: "text", text: `Specify url or urlIndex. Available:
  ${available}` }],
            details: { error: "No URL specified" }
          };
        }
        if (urlData.error) {
          return {
            content: [{ type: "text", text: `Error for ${urlData.url}: ${urlData.error}` }],
            details: { error: urlData.error, url: urlData.url, links: urlData.links ?? [] }
          };
        }
        return {
          content: [{ type: "text", text: `# ${urlData.title}

${urlData.content}` }],
          details: {
            url: urlData.url,
            title: urlData.title,
            contentLength: urlData.content.length,
            links: urlData.links ?? []
          }
        };
      }
      return {
        content: [{ type: "text", text: "Invalid stored data format" }],
        details: { error: "Invalid data" }
      };
    },
    renderCall(args, theme) {
      const { responseId, query, queryIndex, url, urlIndex } = args;
      let target = "";
      if (query) target = `query="${query}"`;
      else if (queryIndex !== void 0) target = `queryIndex=${queryIndex}`;
      else if (url) target = url.length > 30 ? url.slice(0, 27) + "..." : url;
      else if (urlIndex !== void 0) target = `urlIndex=${urlIndex}`;
      else target = responseId.slice(0, 8);
      return new Text(theme.fg("toolTitle", theme.bold("get_content ")) + theme.fg("accent", target), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details;
      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }
      const status = details?.query ? theme.fg("success", `"${details.query}"`) + theme.fg("muted", ` (${details.resultCount} results)`) : theme.fg("success", details?.title || "Content") + theme.fg("muted", ` (${details?.contentLength ?? 0} chars)`);
      if (!expanded) return new Text(status, 0, 0);
      const textContent = result.content.find((item) => item.type === "text")?.text || "";
      const preview = textContent.length > 500 ? textContent.slice(0, 500) + "..." : textContent;
      return new Text(status + "\n" + theme.fg("dim", preview), 0, 0);
    }
  });
}

export { anyAccessExtension as default };
