# pi-any-access

Focused web search and content access for Pi with **Tinyfish-first** search/fetch, **zero-config Exa** fallback, and **GitHub repo cloning**.

## What it is

`any-access` is a **replacement** for `pi-web-access` when you want a smaller, more focused surface:

- `web_search`
- `code_search`
- `fetch_content`
- `get_search_content`
- GitHub repo-aware fetching
- TUI progress + activity widget

## What it is not

This v1 intentionally does **not** include:

- YouTube support
- local video/file support
- PDF extraction
- Gemini / Perplexity providers
- browser curator UI

## Important: do not enable with pi-web-access

`any-access` and `pi-web-access` should **not** be enabled at the same time.

They both want to provide overlapping tools like:

- `web_search`
- `fetch_content`
- `get_search_content`

If you already use `pi-web-access`, disable or remove it before enabling `any-access`.

## Install

### Local development install

```bash
cd any-access
npm install
npm run build
pi install /absolute/path/to/any-access
```

Because `dist/` is committed and `pi.extensions` points to `./dist/index.js`, git/path installs can also work without a local build if the package artifact already includes `dist`.

## Configuration

Configuration lives in:

```text
~/.pi/agent/any-access.json
```

Example:

```json
{
  "tinyfishApiKey": "sk-tinyfish-...",
  "exaApiKey": "exa-...",
  "providerPriority": ["tinyfish", "exa"],
  "searchLocation": "US",
  "searchLanguage": "en"
}
```

### Fields

#### `tinyfishApiKey`

- Type: `string`
- Required for Tinyfish search/fetch
- Read **only** from `~/.pi/agent/any-access.json`

#### `exaApiKey`

- Type: `string`
- Optional
- Advanced usage only
- If omitted, Exa still works through the Exa MCP zero-config path
- Environment variable `EXA_API_KEY` also works and takes precedence

#### `providerPriority`

- Type: `("tinyfish" | "exa")[]`
- Default: `["tinyfish", "exa"]`
- Only affects `web_search({ provider: "auto" })`

#### `searchLocation`

- Type: `string`
- Default: `"US"`
- Used for Tinyfish Search locale targeting

#### `searchLanguage`

- Type: `string`
- Default: `"en"`
- Used for Tinyfish Search language targeting

## Tool behavior

## `web_search`

Parameters:

- `query`
- `queries`
- `provider`: `auto | tinyfish | exa`
- `includeContent`
- `numResults`

Behavior:

- `provider: "auto"` follows `providerPriority`
- Tinyfish is used first when configured
- Exa is used when Tinyfish is unavailable or not preferred
- `numResults`:
  - Tinyfish: local truncation to top N results
  - Exa: native result count request
- `includeContent: true`:
  - Tinyfish path: search first, then fetch returned URLs
  - Exa path: uses inline content when available, then fetches missing URLs if needed

## `code_search`

Parameters:

- `query`
- `maxTokens`

Behavior:

- Prefers Exa code-context MCP (`get_code_context_exa`)
- Falls back to Exa web search if that MCP tool is unavailable
- Best for API usage, official docs, code examples, and implementation references

## `fetch_content`

Parameters:

- `url`
- `urls`
- `provider`: `local | tinyfish` (default: `local`)
- `forceClone`

Behavior:

1. GitHub URLs go through GitHub-specific handling
2. Normal HTTP/HTTPS URLs are fetched **per URL** with bounded parallelism, closer to `pi-web-access`
3. Default provider is `local`
4. If `provider: "tinyfish"` is specified, each URL tries Tinyfish first, then falls back to local HTTP + Readability + Jina Reader on per-URL failure
5. If `provider: "tinyfish"` is specified without `tinyfishApiKey`, the fetch returns an explicit configuration error

### Links behavior

When `provider: "tinyfish"` is used, Tinyfish Fetch is called with `links: true`.

Those links are:

- stored in cached content
- exposed through tool `details`
- **not** appended to the main text body

`image_links` are intentionally disabled in v1.

## `get_search_content`

Use it to retrieve stored full content from earlier `web_search` or `fetch_content` calls.

Examples:

```ts
get_search_content({ responseId: "abc123", urlIndex: 0 })
get_search_content({ responseId: "abc123", queryIndex: 1 })
```

## GitHub repo handling

GitHub behavior keeps the core `pi-web-access` workflow:

- detect GitHub repo URLs
- clone repos locally when practical
- return repo tree + README for root URLs
- return directory listings for `/tree/...`
- return file contents for `/blob/...`
- cache clones for the session
- fallback to API-only view for oversized repos
- support `forceClone: true`

## Provider and fallback logic

### Search

```text
web_search(provider:auto)
  -> providerPriority order from config
  -> typically tinyfish first, then exa
```

### Fetch

```text
fetch_content(url, provider:local)
  -> GitHub URL? clone/api GitHub flow
  -> HTTP/HTTPS URL? local HTTP -> Readability -> Jina Reader

fetch_content(url, provider:tinyfish)
  -> GitHub URL? clone/api GitHub flow
  -> HTTP/HTTPS URL? Tinyfish Fetch (single URL)
  -> Tinyfish per-URL failure? local HTTP -> Readability -> Jina Reader
```

## UI

This package keeps UI intentionally small:

- tool progress updates in TUI
- activity widget toggle: `Ctrl+Shift+W`

The activity widget shows recent API/fetch activity and status.

## Build and dist

This package is developed from `src/` and built into `dist/`:

```bash
npm run build
```

The published/installable extension entry is:

```json
{
  "pi": {
    "extensions": ["./dist/index.js"]
  }
}
```

This keeps installation simple while still letting the code use the TypeScript Tinyfish SDK cleanly.

## Validation

Suggested local validation:

```bash
npm run check
npm run build
npm test
```
