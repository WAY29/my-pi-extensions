<div align="center">

# ◌ pi-glance

**A calm input surface for [pi](https://github.com/badlogic/pi-mono)**

Replace the default prompt with a rounded multiline editor
and an inline glance at model, context, tokens, cost, and Git.

[![npm](https://img.shields.io/npm/v/pi-glance?style=flat-square&color=blue)](https://www.npmjs.com/package/pi-glance)
[![license](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)](LICENSE)
[![pi](https://img.shields.io/badge/pi-package-7c3aed?style=flat-square)](https://github.com/badlogic/pi-mono)

</div>

---

## Install

From npm:

```bash
pi install npm:pi-glance
```

Or clone as a traditional pi extension directory:

```bash
git clone https://github.com/LinYS77/pi-glance.git ~/.pi/agent/extensions/pi-glance
```

Then restart pi or run `/reload`.

For development/testing:

```bash
pi -e /path/to/pi-glance
```

Local checks and Git diagnostics:

```bash
npm test
npm run test:git
npm run debug:git
```

## Use

```text
/glance
```

That's the only command — opens a calm settings pane with a real input-surface preview and a compact three-column settings grid.

## What you see


![pi-glance demo](https://raw.githubusercontent.com/LinYS77/pi-glance/main/assets/demo.gif)


| | | |
|---|---|---|
| 🖊️ | **Rounded editor** | Configurable 2 / 3 / 4 min rows, preserves all pi defaults |
| 🏷️ | **Project title** | Current folder name, or a safe `~/...` path when enabled |
| ✨ | **Session title** | After the first prompt, show a short generated title below the input box |
| 📊 | **Inline status** | Model · plan mode · context · tokens · cost · Git status — top-right |
| ⚙️ | **`/glance` pane** | General settings, segment order, and per-segment detail settings in a calm grid |
| 💤 | **Dim unfocused** | Surface quiets down when you scroll the chat |
| 🎨 | **Themes** | `light`, `dark`, `catppuccin-latte`, and `catppuccin-mocha` |

## Notes

- Icons default to `plain` so pi-glance works with normal terminal fonts.
- If you use a Nerd Font, open `/glance` and set `Icons` to `nerd` for richer symbols.

## Segment details

`/glance` keeps segment settings small and display-focused:

- **Context** — percent / tokens, or hide unknown usage.
- **Cost** — hide zero cost.
- **Tokens** — input / output, total, or cache details.
- **Model** — provider and thinking labels.
- **Plan** — listens to the local `plan-mode` extension and shows/hides its active or executing state.
- **Git** — dirty marker, upstream counts, SHA, and polling.

## Plan mode integration

When the local `plan-mode` extension is installed, pi-glance listens for `plan-mode:state` events and shows a Plan segment only while plan mode is active or executing. Open `/glance`, select **Plan**, and toggle `Enabled` to show or hide this segment.

The integration uses pi's extension event bus, so no pi core patches are required.

## Workspace title

Open `/glance`, select **General**, and set `Workspace label`:

- `name` — show only the current directory name. This is the default.
- `smart` — show more path context on wider terminals.
- `path` — show a safe `~/...` path when possible.

pi-glance never renders full absolute paths in the title: home paths are shortened to `~/...`, and non-home paths use an ellipsis tail such as `…/work/project`.

## Session title

Open `/glance`, select **General**, and configure:

- `Title enabled` — show or hide the session title below the input box.
- `Title model` — optional small model for title generation. Use `model` to prefer the current provider and then other configured providers, or `provider/model` to select a provider explicitly.

When `Title model` is empty, pi-glance uses a local fallback from the first prompt. If the configured model is unavailable, unauthenticated, times out, or returns an invalid title, pi-glance falls back quietly. Fallback titles are upgraded on the next turn when you later configure a title model. Generated titles are stored in `~/.pi/agent/pi-glance/title.json` keyed by session and restored on reload/resume.

## Git status

The Git segment is intentionally quiet:

- Clean repositories show only the branch name.
- Dirty repositories add `*` in plain mode or `●` in Nerd Font mode.
- Conflicts add `!` in plain mode or `⚠` in Nerd Font mode.
- Ahead/behind counts appear when Git reports an upstream, for example `↑2 ↓1`.
- Non-Git directories hide the Git segment.

Open `/glance`, select **Git**, move to a value with the arrow keys, and press Enter to configure:

- `Dirty marker` — hide/show normal dirty markers; conflict markers stay visible.
- `Ahead / behind` — hide/show upstream counts.
- `SHA` — `off`, `detached`, or `always`.
- `Polling` — `2s`, `5s`, `10s`, or `30s`.

Git is collected asynchronously and cached. External file changes usually appear within a few seconds. For local development/debugging you can compare pi-glance with Git directly:

```bash
git status --short --branch
npm run debug:git
```

## Design

- No pi core patches — public extension APIs only
- No render-time IO — Git is collected asynchronously and cached
- Global config at `~/.pi/agent/pi-glance/config.json`

## License

[MIT](LICENSE) © 2026 linys77
