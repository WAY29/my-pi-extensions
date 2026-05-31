import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtractedContent, SearchResult } from "./types.js";

const CACHE_TTL_MS = 60 * 60 * 1000;
export const SESSION_ENTRY_TYPE = "any-access-results";

export interface QueryResultData {
  query: string;
  answer: string;
  results: SearchResult[];
  error: string | null;
  provider?: string;
}

export interface StoredSearchData {
  id: string;
  type: "search" | "fetch";
  timestamp: number;
  queries?: QueryResultData[];
  urls?: ExtractedContent[];
}

const storedResults = new Map<string, StoredSearchData>();

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function storeResult(id: string, data: StoredSearchData): void {
  storedResults.set(id, data);
}

export function getResult(id: string): StoredSearchData | null {
  return storedResults.get(id) ?? null;
}

export function getAllResults(): StoredSearchData[] {
  return Array.from(storedResults.values());
}

export function deleteResult(id: string): boolean {
  return storedResults.delete(id);
}

export function clearResults(): void {
  storedResults.clear();
}

function isValidStoredData(data: unknown): data is StoredSearchData {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id) return false;
  if (candidate.type !== "search" && candidate.type !== "fetch") return false;
  if (typeof candidate.timestamp !== "number") return false;
  if (candidate.type === "search" && !Array.isArray(candidate.queries)) return false;
  if (candidate.type === "fetch" && !Array.isArray(candidate.urls)) return false;
  return true;
}

export function restoreFromSession(ctx: ExtensionContext): void {
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
