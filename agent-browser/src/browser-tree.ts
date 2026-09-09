function getAssistantContent(message: unknown): unknown[] | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const candidate = message as { role?: unknown; content?: unknown };
  if (candidate.role !== 'assistant' || !Array.isArray(candidate.content)) return undefined;
  return candidate.content;
}

function isToolCallContent(content: unknown): content is { id?: unknown; name?: unknown } {
  return Boolean(content && typeof content === 'object' && (content as { type?: unknown }).type === 'toolCall');
}

function isBrowserToolCallContent(content: unknown): content is { id: string } {
  return (
    isToolCallContent(content) &&
    typeof content.name === 'string' &&
    content.name.startsWith('browser_') &&
    typeof content.id === 'string'
  );
}

function isVisibleAssistantContent(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false;
  const candidate = content as { type?: unknown; text?: unknown; thinking?: unknown };
  return (
    (candidate.type === 'text' && typeof candidate.text === 'string' && candidate.text.trim() !== '') ||
    (candidate.type === 'thinking' && typeof candidate.thinking === 'string' && candidate.thinking.trim() !== '')
  );
}

export function getBrowserToolCallIds(message: unknown): string[] {
  return getAssistantContent(message)?.filter(isBrowserToolCallContent).map((item) => item.id) ?? [];
}

export function collectBrowserRuns(messages: unknown[]): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 0) runs.push(run);
    run = [];
  };

  for (const message of messages) {
    const content = getAssistantContent(message);
    if (!content) {
      const role = message && typeof message === 'object' ? (message as { role?: unknown }).role : undefined;
      if (role !== 'toolResult') flush();
      continue;
    }
    for (const item of content) {
      if (isBrowserToolCallContent(item)) {
        run.push(item.id);
        continue;
      }
      if (isToolCallContent(item) || isVisibleAssistantContent(item)) flush();
    }
  }
  flush();
  return runs;
}

export function messagesFromSessionBranch(entries: unknown[], extraMessage?: unknown): unknown[] {
  const messages: unknown[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as { type?: unknown; message?: unknown };
    if (candidate.type !== 'message' || !candidate.message || typeof candidate.message !== 'object') continue;
    messages.push(candidate.message);
  }

  if (!extraMessage || typeof extraMessage !== 'object') return messages;

  const extraIds = new Set(getBrowserToolCallIds(extraMessage));
  if (extraIds.size > 0) {
    const idx = messages.findIndex((message) => getBrowserToolCallIds(message).some((id) => extraIds.has(id)));
    if (idx >= 0) messages[idx] = extraMessage;
    else messages.push(extraMessage);
    return messages;
  }

  if (!messages.includes(extraMessage) && (extraMessage as { role?: unknown }).role === 'assistant') {
    messages.push(extraMessage);
  }
  return messages;
}
