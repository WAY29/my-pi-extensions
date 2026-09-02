---
name: agent-browser
description: Guide real Chrome browser work inside Pi after the session is explicitly armed. Use when the user wants to inspect or automate a page that is already open in their real Chrome with real login state, cookies, tabs, screenshots, or CDP-backed page actions. First ensure the browser session is armed with /browser-on or /skill:agent-browser, then prefer the browser_* tools over generic web scraping.
---

# Agent Browser

Use this skill only for the user's real Chrome session, not for generic web research.

## Rules

1. Never bring Chrome to the foreground. Never switch tabs. Never move the user's OS cursor or type on the OS keyboard.
2. Target a tab with `session_id`. Background tabs are the normal case.
3. If `browser_status` is unclear, check it first. If the session is not armed, ask the user to run `/browser-on`.
4. Prefer `browser_click` / `browser_hover` / `browser_scroll` / `browser_type` / `browser_press` over `browser_execute_js`.
5. Use `browser_execute_js` only when those tools cannot do the job (drag, canvas paths, page-specific APIs).
6. Tell the user before any action that could change page state.
7. If a browser tool reports missing extension, missing tab connection, or blocked action, stop and explain the next manual step.

## Suggested workflow

1. `browser_list_tabs` and pick the `session_id`.
2. `browser_scan_page` with that `session_id`.
3. Act with click / hover / scroll / type / press on the same `session_id`.
4. Screenshot or raw JS/CDP only when needed.

## Install help

If setup is incomplete, tell the user to run:
- `/browser-install`
- `/browser-doctor`

## User note

This skill exists to reduce token overhead in sessions that do not need browser automation. The browser tools should stay inactive until explicitly armed for the session.
