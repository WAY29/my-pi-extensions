export function buildSearchResultsStoredNote(searchId: string): string {
  return `Search results stored [${searchId}]. Use get_search_content({ responseId: "${searchId}", queryIndex: 0 }) to inspect a query's full results again.`;
}

export function buildSearchNeedsContentNote(): string {
  return "Full page content was not fetched for these search results. If you need page text from the sources above, rerun web_search with includeContent: true, then use get_search_content instead of fetching the same URLs one by one.";
}

export function buildContentReadyNote(fetchId: string, sourceCount: number): string {
  return `Full page content for ${sourceCount} sources available [${fetchId}]. Use get_search_content({ responseId: "${fetchId}", urlIndex: 0 }) for full content.`;
}

export function buildBackgroundFetchStartedNote(fetchId: string): string {
  return `Content fetching in background [${fetchId}]. Wait for the content-ready message, then use get_search_content({ responseId: "${fetchId}", urlIndex: 0 }) for full page content.`;
}

export function buildBackgroundFetchReadyMessage(fetchId: string, ok: number, total: number): string {
  return `Content fetched for ${ok}/${total} URLs [${fetchId}]. Full page content is now available. If page text is still needed, call get_search_content({ responseId: "${fetchId}", urlIndex: 0 }).`;
}

export function buildAnyAccessPromptAddendum(): string {
  return [
    "Any-access workflow guidance:",
    "- When using web_search and you expect to need source page text, set includeContent: true in the initial web_search call.",
    "- After web_search returns a stored responseId/searchId/fetchId or a content-ready message, prefer get_search_content over fetch_content for those same search-result URLs.",
    "- Use fetch_content for direct URL fetches the user explicitly asked for, or for URLs that did not already come from a web_search result set with stored content.",
    "- If the task requires compiling multiple items or cross-checking several sources, call get_search_content for as many relevant query/url entries as needed instead of stopping after only the first one.",
  ].join("\n");
}
