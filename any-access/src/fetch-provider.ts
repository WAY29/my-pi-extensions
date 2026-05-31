import type { FetchProvider } from "./types.js";

export function resolveFetchProvider(value: unknown): FetchProvider {
  return value === "tinyfish" ? "tinyfish" : "local";
}
