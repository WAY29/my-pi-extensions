---
name: agent-browser
description: Guide real Chrome browser work inside Pi after the session is explicitly armed. Use when the user wants to inspect or automate a page that is already open in their real Chrome with real login state, cookies, tabs, screenshots, or CDP-backed page actions. First ensure the browser session is armed with /browser-on or /skill:agent-browser, then prefer the browser_* tools over generic web scraping.
---

# Agent Browser

Use this skill only for the user's real Chrome session, not for generic web research.

## Rules

1. First verify setup with `browser_status` if browser connectivity is unclear.
2. If the session is not armed, ask the user to run `/browser-on` or run this skill explicitly.
3. Prefer read-oriented actions first: list tabs, switch tab, scan page, capture page screenshot.
4. Use raw JS or raw CDP only when simpler navigation or scan tools are insufficient.
5. Tell the user before any action that could change page state.
6. If a browser tool reports missing extension, missing tab connection, or blocked action, stop and explain the next manual step.

## Suggested workflow

1. Check status.
2. If needed, switch to the correct tab.
3. Read the page with `browser_scan_page`.
4. Only then do targeted actions like navigate, JS, cookies, screenshot, or CDP.

## Install help

If setup is incomplete, tell the user to run:
- `/browser-install`
- `/browser-doctor`

## User note

This skill exists to reduce token overhead in sessions that do not need browser automation. The browser tools should stay inactive until explicitly armed for the session.
