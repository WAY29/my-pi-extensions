---
name: ketch
description: Web research with the ketch CLI via bash — search, scrape, code search, library docs, and crawl. Use whenever the task needs live web info, looking up a URL, searching public OSS code online, reading library docs from the network, or scraping/crawling pages. Prefer this over curl/wget against search engines, ad-hoc browser scraping, or inventing web results. Trigger on phrases like search the web, look up online, what does the docs say online, scrape this URL, research X, find how others implement Y on GitHub, even if the user never names ketch.
compatibility: Requires bash and the ketch binary on PATH (`go install github.com/1broseidon/ketch@latest` or `brew install 1broseidon/tap/ketch`). Config lives in the ketch config file (`ketch config path`); search backend is operator-configured (e.g. Firecrawl).
---

# ketch — agent web research

Call the **ketch CLI through bash**. Do not wrap it in a custom tool, script, or second abstraction — flags and exit codes are the interface.

## Why direct CLI

ketch is stateless and flag-rich (`--json`, `--scrape`, `--limit`, `--multi`, backends, cookie files, etc.). Re-wrapping it loses that surface. Shell out and use flags as documented by `ketch <cmd> -h`.

## Workflow

1. **Discover** — `ketch search "<query>" --json` (add `--limit N` or `--scrape` when useful).
2. **Read** — `ketch scrape <url> --json` on promising hits (or `--max-chars N` to cap tokens).
3. **Specialize** when the job is not generic web search:
   - public code: `ketch code "<pattern>" --json` (`--lang go`, `--regex` as needed)
   - library docs: `ketch docs "<topic>" --json` (or `--library <id>`)
   - multi-page site: `ketch crawl <url>` (see `ketch crawl -h`)
4. **Cite** result URLs when stating web facts.
5. If something fails (missing key, bad backend), run `ketch doctor` / `ketch config` and fix or report — do not invent results.

## Common commands

```sh
ketch search "query" --json
ketch search "query" --json --limit 10
ketch search "query" --json --scrape          # search + full content per hit
ketch scrape https://example.com --json
ketch scrape url1 url2 --json --max-chars 8000
ketch code "http.NewRequestWithContext" --lang go --json
ketch docs "react useEffect cleanup" --json
ketch crawl https://example.com/docs --depth 2
ketch config                                  # effective config + backends
ketch doctor                                  # live health check
```

Prefer `--json` for structured parsing. Run `ketch <command> -h` when you need a flag not listed here — the live help is authoritative.

## Do / don't

| Do | Don't |
|----|--------|
| `ketch search` / `ketch scrape` via bash | Fake citations or invent page contents |
| Use flags from `ketch … -h` | Re-implement search with curl + HTML hacks |
| Scrape only the URLs you need | Dump huge pages without `--max-chars` when a summary query would do |
| Trust exit codes (2 input, 3 not found, 4 upstream, 5 precondition) | Ignore failures and continue as if data arrived |

## Setup (only if missing)

```sh
command -v ketch || go install github.com/1broseidon/ketch@latest
ketch config          # inspect backend / API keys
ketch doctor          # verify search/scrape health
```

If `ketch` is not on PATH, check `~/.local/bin` or set `KETCH_BIN` only as a last resort when invoking the absolute path in bash.
