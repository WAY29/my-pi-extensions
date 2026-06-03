import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBackgroundFetchReadyMessage,
  buildBackgroundFetchStartedNote,
  buildContentReadyNote,
  buildSearchResultsStoredNote,
} from "../.tmp-test-dist/tool-output.js";

test("search stored note exposes responseId and get_search_content call", () => {
  const text = buildSearchResultsStoredNote("search123");
  assert.match(text, /search123/);
  assert.match(text, /get_search_content/);
  assert.match(text, /queryIndex: 0/);
});

test("content ready note exposes fetch responseId", () => {
  const text = buildContentReadyNote("fetch123", 4);
  assert.match(text, /fetch123/);
  assert.match(text, /4 sources/);
  assert.match(text, /urlIndex: 0/);
});

test("background fetch started note tells model exact next step", () => {
  const text = buildBackgroundFetchStartedNote("fetch456");
  assert.match(text, /fetch456/);
  assert.match(text, /Wait for the content-ready message/);
  assert.match(text, /get_search_content/);
});

test("background fetch ready message tells model to call get_search_content", () => {
  const text = buildBackgroundFetchReadyMessage("fetch789", 2, 3);
  assert.match(text, /fetch789/);
  assert.match(text, /2\/3 URLs/);
  assert.match(text, /get_search_content/);
});
