import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseHTML } from 'linkedom';

function stampSource() {
  const src = readFileSync(new URL('../src/simphtml.ts', import.meta.url), 'utf8');
  const match = src.match(/export const jsStampPiRefs = String\.raw`([\s\S]*?)`;/);
  assert.ok(match, 'jsStampPiRefs source not found');
  return match[1];
}

test('scan stamps data-pi on interactive nodes only', () => {
  const { document } = parseHTML(`<html><body>
    <button>Go</button>
    <input type="text" name="q">
    <input type="hidden" name="tok">
    <div>plain</div>
    <a href="/x">link</a>
  </body></html>`);
  const count = new Function('document', `${stampSource()}\nreturn stampPiRefs();`)(document);
  assert.equal(count, 3);
  assert.equal(document.querySelector('button').getAttribute('data-pi'), 'e1');
  assert.equal(document.querySelector('input[name="q"]').getAttribute('data-pi'), 'e2');
  assert.equal(document.querySelector('input[type="hidden"]').getAttribute('data-pi'), null);
  assert.equal(document.querySelector('div').getAttribute('data-pi'), null);
  assert.equal(document.querySelector('a').getAttribute('data-pi'), 'e3');
});
