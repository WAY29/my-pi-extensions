import assert from 'node:assert/strict';
import test from 'node:test';
import { collectBrowserRuns, messagesFromSessionBranch } from '../src/browser-tree.ts';

function assistant(content: unknown[]) {
  return { role: 'assistant', content };
}

function toolCall(id: string, name: string) {
  return { type: 'toolCall', id, name };
}

function text(value: string) {
  return { type: 'text', text: value };
}

function thinking(value: string) {
  return { type: 'thinking', thinking: value };
}

test('groups sequential browser tools across toolResult messages', () => {
  const runs = collectBrowserRuns([
    assistant([toolCall('click', 'browser_click')]),
    { role: 'toolResult', toolCallId: 'click' },
    assistant([toolCall('scan', 'browser_scan_page')]),
  ]);
  assert.deepEqual(runs, [['click', 'scan']]);
});

test('groups parallel browser tools in one assistant message', () => {
  const runs = collectBrowserRuns([
    assistant([toolCall('a', 'browser_click'), toolCall('b', 'browser_scan_page')]),
  ]);
  assert.deepEqual(runs, [['a', 'b']]);
});

test('splits on visible assistant text', () => {
  const runs = collectBrowserRuns([
    assistant([toolCall('a', 'browser_click')]),
    { role: 'toolResult', toolCallId: 'a' },
    assistant([text('next I will scan'), toolCall('b', 'browser_scan_page')]),
  ]);
  assert.deepEqual(runs, [['a'], ['b']]);
});

test('splits on user messages', () => {
  const runs = collectBrowserRuns([
    assistant([toolCall('a', 'browser_click')]),
    { role: 'user', content: [text('keep going')] },
    assistant([toolCall('b', 'browser_scan_page')]),
  ]);
  assert.deepEqual(runs, [['a'], ['b']]);
});

test('splits on non-browser tool calls', () => {
  const runs = collectBrowserRuns([
    assistant([toolCall('a', 'browser_click'), toolCall('bash', 'bash'), toolCall('b', 'browser_scan_page')]),
  ]);
  assert.deepEqual(runs, [['a'], ['b']]);
});

test('splits on thinking between tools', () => {
  const runs = collectBrowserRuns([
    assistant([toolCall('a', 'browser_click'), thinking('hmm'), toolCall('b', 'browser_scan_page')]),
  ]);
  assert.deepEqual(runs, [['a'], ['b']]);
});

test('appends in-flight sequential scan onto the previous click run', () => {
  const messages = messagesFromSessionBranch(
    [
      { type: 'message', message: assistant([toolCall('click', 'browser_click')]) },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'click' } },
    ],
    assistant([toolCall('scan', 'browser_scan_page')]),
  );
  assert.deepEqual(collectBrowserRuns(messages), [['click', 'scan']]);
});

test('replaces in-flight assistant message by overlapping tool ids', () => {
  const stale = assistant([toolCall('click', 'browser_click')]);
  const extra = assistant([toolCall('click', 'browser_click'), toolCall('scan', 'browser_scan_page')]);
  const messages = messagesFromSessionBranch([{ type: 'message', message: stale }], extra);
  assert.deepEqual(collectBrowserRuns(messages), [['click', 'scan']]);
});
