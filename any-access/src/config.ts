import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ResolvedSearchProvider } from "./types.js";

export const CONFIG_PATH = join(homedir(), ".pi", "agent", "any-access.json");

export interface AnyAccessConfig {
  tinyfishApiKey?: string;
  exaApiKey?: string;
  providerPriority: ResolvedSearchProvider[];
  searchLocation: string;
  searchLanguage: string;
}

const DEFAULT_PROVIDER_PRIORITY: ResolvedSearchProvider[] = ["tinyfish", "exa"];

export const DEFAULT_CONFIG: AnyAccessConfig = {
  providerPriority: DEFAULT_PROVIDER_PRIORITY,
  searchLocation: "US",
  searchLanguage: "en",
};

let cachedConfig: AnyAccessConfig | null = null;

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeProviderPriority(value: unknown): ResolvedSearchProvider[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<ResolvedSearchProvider>();
  const ordered: ResolvedSearchProvider[] = [];

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

export function resolveConfig(raw: unknown): AnyAccessConfig {
  const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    tinyfishApiKey: normalizeOptionalString(data.tinyfishApiKey),
    exaApiKey: normalizeOptionalString(data.exaApiKey),
    providerPriority: normalizeProviderPriority(data.providerPriority),
    searchLocation: (normalizeOptionalString(data.searchLocation) ?? DEFAULT_CONFIG.searchLocation).toUpperCase(),
    searchLanguage: (normalizeOptionalString(data.searchLanguage) ?? DEFAULT_CONFIG.searchLanguage).toLowerCase(),
  };
}

export function parseConfigText(text: string, source: string = CONFIG_PATH): AnyAccessConfig {
  try {
    const parsed = JSON.parse(text) as unknown;
    return resolveConfig(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${source}: ${message}`);
  }
}

export function loadConfig(): AnyAccessConfig {
  if (cachedConfig) return cachedConfig;
  if (!existsSync(CONFIG_PATH)) {
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }

  const text = readFileSync(CONFIG_PATH, "utf-8");
  cachedConfig = parseConfigText(text, CONFIG_PATH);
  return cachedConfig;
}

export function clearConfigCache(): void {
  cachedConfig = null;
}

export function getTinyfishApiKey(config: AnyAccessConfig = loadConfig()): string | null {
  return config.tinyfishApiKey ?? null;
}

export function hasTinyfishApiKey(config: AnyAccessConfig = loadConfig()): boolean {
  return !!getTinyfishApiKey(config);
}

export function getExaApiKey(config: AnyAccessConfig = loadConfig()): string | null {
  const envKey = normalizeOptionalString(process.env.EXA_API_KEY);
  return envKey ?? config.exaApiKey ?? null;
}

export function hasExaApiKey(config: AnyAccessConfig = loadConfig()): boolean {
  return !!getExaApiKey(config);
}
