# Pi Extensions

English | [简体中文](README_CN.md)

Personal extension collection for [pi](https://pi.dev). These extensions are intended to live in `~/.pi/agent/extensions/` and can also be installed as a pi package from this repository.

> Security note: pi extensions run with the same permissions as your local pi process. Review code before installing or sharing with others.

## Install

Recommended install from GitHub:

```bash
pi install git:github.com/WAY29/my-pi-extensions
```

Raw GitHub URLs work too:

```bash
pi install https://github.com/WAY29/my-pi-extensions
```

Then restart pi, or run `/reload` in an existing pi session.

Project-local install is also supported:

```bash
pi install git:github.com/WAY29/my-pi-extensions -l
```

If you want a local clone but still want pi to install runtime dependencies correctly, prefer a local-path install:

```bash
git clone https://github.com/WAY29/my-pi-extensions /tmp/pi-extensions
pi install /tmp/pi-extensions
```

Raw copy is still possible if you really do not want to use `pi install`, but copying files alone is no longer enough when some extensions have runtime dependencies:

```bash
mkdir -p ~/.pi/agent/extensions
git clone https://github.com/WAY29/my-pi-extensions /tmp/pi-extensions
find /tmp/pi-extensions -mindepth 1 -maxdepth 1 ! -name .git -exec cp -R {} ~/.pi/agent/extensions/ \;
cd ~/.pi/agent/extensions && npm install --omit=dev
```

This copies all top-level repository contents except the source repository's `.git/` directory, then installs the package's runtime dependencies. If you already manage `~/.pi/agent/extensions` with your own `package.json` or custom setup, prefer `pi install /path/to/clone` instead of raw copying.

If you copy files manually and want bundled skills too, also copy the repository `skills/` directory into a Pi skill root such as `~/.pi/agent/skills/`. Package installs handle this automatically.

For one-off testing of a single extension:

```bash
pi -e ~/.pi/agent/extensions/<extension-file-or-directory>
```

## Extensions

| Extension | Type | Main command / tool / hook | Purpose |
|---|---|---|---|
| `AskUserQuestion.ts` | tool | `AskUserQuestion` | Adds an interactive question tool for the agent. Supports single or multi-question flows, option lists, custom text answers, and per-option notes. |
| `agent-browser/` | real-browser bridge + skill-guided tools | `/browser-install`, `/browser-doctor`, `/browser-on`, `/browser-off`, `browser_*` | Connects pi to the user's real Chrome session through a bundled bridge and unpacked Chrome extension. Tools stay inactive until explicitly armed so normal sessions do not pay the token cost. |
| `tool-output-mode.ts` | UI/tool renderer | `/tool-output-mode`, `Ctrl+Shift+O`, `Alt+O` | Toggles `bash`, `grep`, `find`, and `ls` output rendering between `hidden`, `compact`, and `full` without changing what the model receives. Uses `bash-tool-coordinator.ts` for the bash side. |
| `bash-tool-coordinator.ts` | helper | automatic | Shared composition layer for extensions that need to wrap the `bash` tool. It intentionally has no visible UI by itself. |
| `code-block-enhancer.ts` | UI patch + command/shortcut | automatic, `/copy-code`, `Ctrl+Alt+C` | Replaces the old code-fence hiding and copy-code extensions. Renders fenced code blocks as bordered, numbered blocks and copies recent assistant code blocks by number, all blocks, or with markdown fences. |
| `effort.ts` | command | `/effort` | Quickly switches or cycles pi thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. |
| `hide-read-output.ts` | UI/tool renderer | automatic | Hides all rendered result output from the built-in `read` tool in the TUI while still returning file contents to the model. Consecutive reads are grouped into concise summaries. |
| `image-gen.ts` | image tool | `image_gen` | Adds an OpenAI-compatible raster image generation/editing tool for pi. Supports prompt-only generation, workspace-path edits, recent attached-image fallback, and transparent-output fallback via local chroma-key removal when the configured relay cannot serve native transparency. |
| `keydump.ts` | command/debug UI | `/keydump` | Shows raw key sequences received by pi. Useful when debugging terminal keybindings. |
| `permission-gate.ts` | safety gate | automatic, `/glance` toggle | Prompts before potentially dangerous bash commands such as `rm` or `chmod/chown ... 777`. Blocks by default when no UI is available. Can be enabled or disabled from pi-glance via the extension event bus. |
| `pretty-image-paste.ts` | input/image helper | automatic | Replaces pasted pi clipboard image paths with readable `[Image #n]` labels, then attaches the referenced images when the prompt is submitted. |
| `progress-checkpoints.ts` | prompt helper | `/progress`, `/progress-checkpoints` | Injects a progress-checkpoint policy so the assistant gives short status updates around multi-step or tool-heavy work. |
| `retry-stream-read-error.ts` | retry patch | automatic | Treats `stream_read_error` assistant failures as retryable by patching pi's retry classifier, with a warning when the current pi version is unsupported. |
| `stable-scroll.ts` | UI patch | automatic | Filters terminal clear-scrollback sequences during normal redraws so TUI refreshes do not wipe scrollback, while allowing session-start clears. |
| `sudo-auth.ts` | sudo helper | automatic | Provides a TUI askpass bridge for `sudo` in bash commands. Passwords are cached in extension memory only and cleared on authentication failure or session shutdown. |
| `notify-hook.ts` | integration hook | automatic | Generic external notification bridge for pi lifecycle events and temporary user-attention states. The current Superset adapter calls Superset's `notify.sh`, but the core extension is platform-agnostic so other notification backends can be added later. |
| `notify-hook/attention.ts` | helper module | automatic | Shared helper for emitting temporary “awaiting user attention” lifecycle signals to notify-hook-aware extensions such as `notify-hook.ts`, `permission-gate.ts`, and `pi-sandbox/`. |
| `working-status.ts` | working indicator/UI status | automatic | Replaces pi's streaming `Working...` text with action-aware labels and a live elapsed timer. Keeps showing the most recent tool action while the model continues, and leaves a dim `Finished working in ...` status after `agent_end` until the next run. |
| `startup-info.ts` | startup info aggregator | automatic | Collects cooperative startup `info` notices from extensions and renders them as one merged startup message so items like `pi-sandbox/` status and `pi-glance/` AutoModel switches do not overwrite each other. |
| `pi-glance/` | UI/input surface | `/glance` | Replaces the default input area with a rounded multiline editor and inline status glance for model, context, tokens, cost, Git, title, and plan state. Its settings pane can also configure workspace auto-model rules, including `model[:thinking]` AutoModel rules, and toggle `permission-gate.ts` / `pi-sandbox/` when those extensions are installed. |
| `pi-debug-mode/` | debug workflow + skill bridge | `/debug`, `/debug-status`, `/debug:cleanup`, `debug_mode_state`, `debug_mode_session`, `debug-mode` skill | Adds a minimal Cursor-style debug workflow for Pi. Debug tools are injected only for manual debug-mode turns, provide collector/session management plus footer state, and pair with the bundled `skills/debug-mode/` runtime-evidence skill. |
| `pi-rewind/` | checkpoint/restore | `/rewind`, `Esc Esc` | Creates checkpoints after mutating turns and lets you rewind files and/or conversation state when an agent change goes wrong. Uses the repo's Git data when available, or pi-rewind-managed external Git storage for non-Git directories. |
| `pi-sandbox/` | security/sandbox | `/sandbox`, `/sandbox-enable`, `/sandbox-disable`, `--no-sandbox`, `/glance` toggle | Adds OS-level bash sandboxing plus filesystem/network permission prompts for direct tools. Consumes read-only locks requested by `plan-mode/`, uses `bash-tool-coordinator.ts` for bash wrapping, and exposes event-bus state/toggle hooks for pi-glance. |
| `plan-mode/` | planning workflow | `/plan`, `/plan-todos`, `/plan-execute-clear-context`, `Shift+Tab`, `--plan`, `plan_complete_step` | Read-only exploration mode for safe planning, then execution mode with 1-10 numbered plan steps, immediate `plan_complete_step` progress, a 3-step visible todo window, optional clear-context execution, and `[DONE:n]` fallback recovery. Emits state for `pi-glance/` and integrates with `pi-sandbox/`. |
| `review/` | review workflow | `/review` | Runs an isolated Codex-style code review session with preset target pickers, main-thread live rendering for tool/assistant activity, resumable interrupted reviews, and follow-up actions to resolve all or selected findings. |
| `any-access/` | web access/search | `web_search`, `code_search`, `fetch_content`, `get_search_content` | Focused Tinyfish/Exa-powered web search and content access package with GitHub-aware fetching, background content retrieval for `includeContent`, and lightweight TUI activity UI. |

## Extension Relationships

### Bash tool composition: `bash-tool-coordinator.ts`

Pi has a single active tool named `bash`. If several extensions independently replace that tool, the last replacement wins and earlier behavior can disappear. `bash-tool-coordinator.ts` prevents that collision by building one composed bash tool from registered plugins.

- `pi-sandbox/` registers a bash operations wrapper with high priority. When the sandbox is enabled and initialized, bash commands run through the sandboxed backend; otherwise they fall back to the next bash implementation.
- `sudo-auth.ts` registers a lower-priority bash operations wrapper that injects a sudo askpass environment when sandboxed bash is not taking ownership.
- `tool-output-mode.ts` registers a bash result-rendering wrapper. It can hide, compact, or fully expand bash output while preserving the sandbox behavior underneath.
- `tool-output-mode.ts` also wraps `grep`, `find`, and `ls` rendering directly, because those are separate built-in tools and do not go through the bash coordinator.
- `bash-tool-coordinator.ts` is intentionally top-level. Keep it copied with the repository even though it does not register a user-facing command.

### Plan workflow: `plan-mode/` + `pi-sandbox/` + `pi-glance/`

These three extensions cooperate but have separate responsibilities:

1. `plan-mode/` owns the planning state. It registers `/plan`, `/plan-todos`, `/plan-execute-clear-context`, `Shift+Tab`, and `--plan`, tracks todo items, emits `plan-mode:state`, and responds to `plan-mode:request-state`.
2. `pi-glance/` is display-only for planning. It listens for `plan-mode:state` events and shows a Plan segment in the input surface when plan mode is active or executing. It does not enforce read-only behavior.
3. `plan-mode/` asks `pi-sandbox/` to enforce read-only planning by emitting `pi-sandbox:set-read-only-lock` with owner `plan-mode`.
4. When `pi-sandbox/` is available, plan mode keeps the current active tool set unchanged, but writes under the current working directory are denied by sandbox policy.
5. When `pi-sandbox/` is unavailable, plan mode falls back to a smaller read-only tool set (`read`, `bash`, `grep`, `find`, `ls`, `AskUserQuestion`) and an internal bash allowlist.
6. When the plan is executed, `plan-mode/` lifts the read-only lock and sends execution context so the agent can work through numbered steps and call `plan_complete_step` as each step finishes. `[DONE:n]` markers are now fallback-only recovery markers when the tool is unavailable.
7. If you choose clear-context execution, `plan-mode/` creates a fresh session, persists the approved plan there, and kicks off execution with only the approved plan as the handoff context.

### Security controls: `pi-glance/` + `permission-gate.ts` + `pi-sandbox/`

`pi-glance/` can act as a control surface for the two security extensions without owning their enforcement logic:

- `permission-gate.ts` answers `permission-gate:request-state` and `permission-gate:set-enabled` events. `/glance` uses those hooks to show and save its enabled state.
- `pi-sandbox/` answers `pi-sandbox:request-state` and `pi-sandbox:set-enabled` events. `/glance` can enable or disable the sandbox for the current session and saves the preferred setting in pi-glance config.
- `--no-sandbox` still takes priority. If pi was started with `--no-sandbox`, pi-glance cannot force the sandbox on.
- If a security extension is unavailable when `/glance` is saved, pi-glance keeps the setting and applies it when that extension responds in a later session/reload.
- Enforcement remains in `permission-gate.ts` and `pi-sandbox/`; pi-glance only requests state changes over the shared event bus.

### Safety and recovery layers

- `permission-gate.ts` is a prompt-based safety net for obviously dangerous bash commands. It is independent of `pi-sandbox/` and still useful when the sandbox is disabled.
- `pi-sandbox/` is the stronger policy layer. It controls OS-level bash sandboxing and direct-tool filesystem/network prompts.
- `plan-mode/` is a workflow layer. It requests read-only behavior from `pi-sandbox/`, but falls back gracefully when no sandbox is present.
- `pi-rewind/` is a recovery layer, not a prevention layer. Use it to roll back file and/or conversation state after an agent change goes wrong. It works in Git repos and can also create pi-rewind-owned external Git storage under `~/.pi/agent/pi-rewind/workspaces/` for plain directories.
- `pi-glance/` and `progress-checkpoints.ts` are visibility/control layers. They help you see current state and request changes; security enforcement stays in the security extensions themselves.

## Common Workflows

### Safer planning and execution

Use these together:

- `pi-sandbox/` for filesystem/network permission gates and cwd-scoped read-only locks.
- `plan-mode/` for read-only planning before edits, including optional clear-context execution of the approved plan.
- `pi-glance/` to show plan state and toggle `permission-gate.ts` / `pi-sandbox/` from one settings pane.
- `pi-rewind/` to recover from bad file changes, including in non-Git directories via external local checkpoint storage.
- `permission-gate.ts` as a simple confirmation layer for risky bash commands.

The repository root includes `sandbox.json`, the recommended macOS configuration for `pi-sandbox/`. It denies reads of common secret directories, denies writes to secret-looking files, and allows writes to the current workspace plus common macOS/cache directories. It is not an extension entry; copy it manually when you want this policy:

```bash
cp sandbox.json ~/.pi/agent/sandbox.json
```

Review the policy before using it on another machine.

### Cleaner terminal output

Use these together:

- `hide-read-output.ts` to hide all built-in `read` result output.
- `tool-output-mode.ts` to control noisy command/search output.
- `code-block-enhancer.ts` for cleaner, numbered markdown code blocks and quick clipboard access to generated code.

### Workspace-specific models

Use `/glance` → **Auto model** to add exact cwd rules that switch models automatically on `session_start`. Rules can use `provider/model` or a bare model name that reuses the current provider.

### Long-running autonomous tasks

Use these together:

- `progress-checkpoints.ts` to keep public progress updates concise.
- `effort.ts` to adjust reasoning level without opening settings.

### Image-heavy prompts

Use `pretty-image-paste.ts` when pasting multiple screenshots or clipboard images. It keeps the editor readable by showing `[Image #n]` labels, then re-attaches the corresponding image files on submit.

## Notes

- The root `package.json` declares the package extension entries under `pi.extensions`. Keep it in sync when adding or removing top-level extensions.
- `bash-tool-coordinator.ts` is a helper module, but it is still listed in the package manifest so package installs mirror the local auto-discovered extension directory.
- `notify-hook/attention.ts` is also a helper module. It exists so multiple extensions can share the same temporary user-attention signaling without duplicating event-name and start/end bookkeeping logic.
- `notify-hook/adapters/superset.ts` contains the current Superset-specific adapter. Keep platform-specific notification integrations under `notify-hook/adapters/` so the top-level extension stays backend-agnostic.
- `pi-glance/` and `pi-sandbox/` have their own `package.json` files and may also be usable as standalone pi packages.
- `skills/debug-mode/` is bundled with this package because `pi-debug-mode/` relies on it for the debug workflow. Package installs now load skills from the repository `skills/` directory via `pi.skills`.
- The root `sandbox.json` is a recommended macOS `pi-sandbox/` policy copied from `~/.pi/agent/sandbox.json`; keep it separate from `pi-sandbox/sandbox.json`, which belongs to the standalone package source.
- `pi-sandbox/dist/` is intentionally kept because `pi-sandbox/index.ts` re-exports `./dist/index.js`.
- Generated development directories such as `pi-glance/.tmp-git-dev/` are intentionally ignored.
- Some files include attribution comments for code adapted from existing MIT-licensed pi extensions. Keep those notices when redistributing.

## License

MIT. See [LICENSE](LICENSE).

Subdirectories or files that carry their own license or attribution notices should retain those notices.
