export type SearchProvider = "auto" | "tinyfish" | "exa";
export type ResolvedSearchProvider = "tinyfish" | "exa";
export type FetchProvider = "local" | "tinyfish";
export type ContentProvider = "tinyfish" | "local" | "github";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  answer: string;
  results: SearchResult[];
  provider: ResolvedSearchProvider;
}

export interface SearchOptions {
  provider?: SearchProvider;
  includeContent?: boolean;
  numResults?: number;
  signal?: AbortSignal;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  error: string | null;
  links?: string[];
  finalUrl?: string | null;
  provider?: ContentProvider;
}

export interface FetchOptions {
  forceClone?: boolean;
  provider?: FetchProvider;
  timeoutMs?: number;
}
