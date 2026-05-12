export type FilesystemAccessKind = "read" | "write";

export interface SandboxFilesystemViolation {
  path: string;
  access: FilesystemAccessKind;
}

function parseSandboxPaths(pathText: string): string[] {
  const matches = pathText.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\S+/g) ?? [];
  return matches
    .map((match) => {
      const trimmed = match.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        return trimmed.slice(1, -1);
      }
      return trimmed;
    })
    .filter((match) => match.startsWith("/"));
}

export function parseSandboxFilesystemViolationLine(
  line: string,
): SandboxFilesystemViolation | null {
  const directMatch = line.match(/\bdeny(?:\(\d+\))?\s+(file-(read|write)[^\s]*)\s+(.+)$/);
  if (directMatch) {
    const [path] = parseSandboxPaths(directMatch[3]);
    if (!path) return null;
    return { path, access: directMatch[2] as FilesystemAccessKind };
  }

  const forbiddenLinkMatch = line.match(
    /\bdeny(?:\(\d+\))?\s+forbidden-link-priv<(file-(read|write)[^>]*)>\s+(.+)$/,
  );
  if (!forbiddenLinkMatch) return null;

  const [sourcePath] = parseSandboxPaths(forbiddenLinkMatch[3]);
  if (!sourcePath) return null;
  return {
    path: sourcePath,
    access: forbiddenLinkMatch[2] as FilesystemAccessKind,
  };
}
