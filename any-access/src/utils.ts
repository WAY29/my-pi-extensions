export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isAbortError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return message.includes("abort") || message.includes("cancel");
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    unique.push(item);
  }
  return unique;
}

export async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();

  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
    }),
  ]);
}

export function abortError(): Error {
  return new DOMException("Aborted", "AbortError");
}

export function extractHeadingTitle(text: string): string | null {
  const match = text.match(/^#{1,2}\s+(.+)/m);
  if (!match) return null;
  const cleaned = match[1].replace(/\*+/g, "").trim();
  return cleaned || null;
}

export function extractTextTitle(text: string, url: string): string {
  try {
    return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
  } catch {
    return extractHeadingTitle(text) ?? url;
  }
}

export function truncateContent(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars) + "\n\n[Content truncated...]", truncated: true };
}
