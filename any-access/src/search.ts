import { hasTinyfishApiKey, loadConfig, type AnyAccessConfig } from "./config.js";
import { isExaAvailable, searchWithExa, type ExaSearchExecution } from "./exa.js";
import { searchWithTinyfish } from "./tinyfish.js";
import type { ExtractedContent, ResolvedSearchProvider, SearchOptions, SearchProvider, SearchResponse } from "./types.js";
import { errorMessage } from "./utils.js";

export interface SearchExecutionResult extends SearchResponse {
  inlineContent?: ExtractedContent[];
}

interface SearchProviderAvailability {
  tinyfish: boolean;
  exa: boolean;
}

function currentAvailability(config: AnyAccessConfig): SearchProviderAvailability {
  return {
    tinyfish: hasTinyfishApiKey(config),
    exa: isExaAvailable(),
  };
}

export function resolveSearchProviderOrder(
  requested: SearchProvider | undefined,
  availability: SearchProviderAvailability,
  config: AnyAccessConfig,
): ResolvedSearchProvider[] {
  const provider = requested ?? "auto";
  if (provider === "tinyfish") return ["tinyfish"];
  if (provider === "exa") return ["exa"];

  return config.providerPriority.filter((candidate) => availability[candidate]);
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchExecutionResult> {
  const config = loadConfig();
  const availability = currentAvailability(config);
  const providerOrder = resolveSearchProviderOrder(options.provider, availability, config);
  if (providerOrder.length === 0) {
    throw new Error("No search providers available. Configure tinyfishApiKey or use Exa.");
  }

  const errors: string[] = [];

  for (const provider of providerOrder) {
    try {
      if (provider === "tinyfish") {
        return await searchWithTinyfish(query, options, config);
      }
      const exaResult: ExaSearchExecution = await searchWithExa(query, options);
      return exaResult;
    } catch (err) {
      if (options.provider && options.provider !== "auto") throw err;
      errors.push(`${provider}: ${errorMessage(err)}`);
    }
  }

  throw new Error(errors.join(" | ") || "Search failed");
}
