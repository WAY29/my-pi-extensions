---
name: agent-browser
description: Control the user's real Chrome session (open tabs, login state, cookies, screenshots, CDP). If browser_* tools are already in the tool list, the session is already armed — use them immediately and do not ask for /browser-on. Only ask the user to run /browser-on when those tools are missing. Prefer browser_* over generic web scraping.
---

# Agent Browser

Use this skill only for the user's real Chrome session, not for generic web research.

## Rules

1. Never bring Chrome to the foreground. Never switch tabs. Never move the user's OS cursor or type on the OS keyboard.
2. Target a tab with `session_id`. Background tabs are the normal case.
3. Presence of `browser_*` tools means this session is already armed. Do not ask the user to run `/browser-on`. If those tools are missing, then ask the user to run `/browser-on` (or `/skill:agent-browser`). Use `browser_status` only for setup/diagnostics (extension, ports, connected tabs), never as a permission check.
4. `browser_scan_page` first. Interactive nodes are tagged `data-pi="e12"`. Pass that `ref` to click / hover / scroll / type / press. Re-scan after navigation or DOM changes; refs expire.
5. Prefer those action tools over `browser_execute_js`. Use JS only for drag, canvas, or page-specific APIs.
6. Tell the user before any action that could change page state.
7. If a browser tool reports missing extension, missing tab connection, or blocked action, stop and explain the next manual step.

## Suggested workflow

1. `browser_list_tabs` and pick the `session_id`.
2. `browser_scan_page` with that `session_id`.
3. Act with `ref` values from that scan, same `session_id`.
4. Screenshot or raw JS/CDP only when needed.

## Install help

If setup is incomplete, tell the user to run:
- `/browser-install`
- `/browser-doctor`

## User note

This skill exists to reduce token overhead in sessions that do not need browser automation. Browser tools stay inactive until `/browser-on` or `/skill:agent-browser`. Once they appear in the tool list, treat that as permission granted.
