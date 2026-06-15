export type ReadBlockReason = "denyRead";

export function getReadBlockReason(
  path: string,
  denyRead: string[],
  allowRead: string[],
  sessionAllowRead: string[],
  matchesPattern: (path: string, patterns: string[]) => boolean,
): ReadBlockReason | null {
  if (matchesPattern(path, sessionAllowRead)) return null;
  if (matchesPattern(path, allowRead)) return null;
  return matchesPattern(path, denyRead) ? "denyRead" : null;
}
