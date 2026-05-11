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

Manual copy is still possible if you prefer not to use `pi install`:

```bash
mkdir -p ~/.pi/agent/extensions
git clone https://github.com/WAY29/my-pi-extensions /tmp/pi-extensions
find /tmp/pi-extensions -mindepth 1 -maxdepth 1 ! -name .git -exec cp -R {} ~/.pi/agent/extensions/ \;
```

This copies all top-level repository contents except the source repository's `.git/` directory. It still copies useful dotfiles such as `.gitignore`.

For one-off testing of a single extension:

```bash
pi -e ~/.pi/agent/extensions/<extension-file-or-directory>
```

## Extensions

| Extension | Type | Main command / tool / hook | Purpose |
|---|---|---|---|
| `AskUserQuestion.ts` | tool | `AskUserQuestion` | Adds an interactive question tool for the agent. Supports single or multi-question flows, option lists, custom text answers, and per-option notes. |
| `bash-grep-output-mode.ts` | UI/tool renderer | `/bash-grep-output`, `Ctrl+Shift+O`, `Alt+O` | Toggles `bash` and `grep` output rendering between `hidden`, `compact`, and `full` without changing what the model receives. Uses `bash-tool-coordinator.ts` for the bash side. |
| `bash-tool-coordinator.ts` | helper | automatic | Shared composition layer for extensions that need to wrap the `bash` tool. It intentionally has no visible UI by itself. |
| `copy-code-block.ts` | command/shortcut | `/copy-code`, `Ctrl+Alt+C` | Copies code blocks from the latest assistant message. Supports choosing a block, copying all blocks, and preserving markdown fences. |
| `effort.ts` | command | `/effort` | Quickly switches or cycles pi thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. |
| `hide-code-fence-markers.ts` | UI patch | automatic | Cleans up markdown code block rendering by hiding extra code fence marker lines in the terminal UI. |
| `hide-read-output.ts` | UI/tool renderer | automatic | Hides all rendered result output from the built-in `read` tool in the TUI while still returning file contents to the model. Consecutive reads are grouped into concise summaries. |
| `keydump.ts` | command/debug UI | `/keydump` | Shows raw key sequences received by pi. Useful when debugging terminal keybindings. |
| `permission-gate.ts` | safety gate | automatic | Prompts before potentially dangerous bash commands such as `rm`, `sudo`, or `chmod/chown ... 777`. Blocks by default when no UI is available. |
| `path-autocomplete-normalizer.ts` | autocomplete patch | automatic | Normalizes repeated `/./` path segments produced by some file-completion flows. |
| `pretty-image-paste.ts` | input/image helper | automatic | Replaces pasted pi clipboard image paths with readable `[Image #n]` labels, then attaches the referenced images when the prompt is submitted. |
| `progress-checkpoints.ts` | prompt helper | `/progress`, `/progress-checkpoints` | Injects a progress-checkpoint policy so the assistant gives short status updates around multi-step or tool-heavy work. |
| `pi-glance/` | UI/input surface | `/glance` | Replaces the default input area with a rounded multiline editor and inline status glance for model, context, tokens, cost, Git, title, and plan state. |
| `pi-goal/` | goal manager | `/goal`, `get_goal`, `update_goal` | Tracks a long-running thread goal, optional token budget, continuation prompts, status bar state, and verified completion via tool call. |
| `pi-rewind/` | checkpoint/restore | `/rewind`, `Esc Esc` | Creates Git-based checkpoints after mutating turns and lets you rewind files and/or conversation state when an agent change goes wrong. |
| `pi-sandbox/` | security/sandbox | `/sandbox`, `/sandbox-enable`, `/sandbox-disable`, `--no-sandbox` | Adds OS-level bash sandboxing plus filesystem/network permission prompts for direct tools. Consumes read-only locks requested by `plan-mode/` and uses `bash-tool-coordinator.ts` for bash wrapping. |
| `plan-mode/` | planning workflow | `/plan`, `/plan-todos`, `Shift+Tab`, `--plan` | Read-only exploration mode for safe planning, then execution mode with numbered plan steps and `[DONE:n]` progress tracking. Emits state for `pi-glance/` and integrates with `pi-sandbox/`. |

## Extension Relationships

### Bash tool composition: `bash-tool-coordinator.ts`

Pi has a single active tool named `bash`. If several extensions independently replace that tool, the last replacement wins and earlier behavior can disappear. `bash-tool-coordinator.ts` prevents that collision by building one composed bash tool from registered plugins.

- `pi-sandbox/` registers a bash operations wrapper with high priority. When the sandbox is enabled and initialized, bash commands run through the sandboxed backend; otherwise they fall back to the next bash implementation.
- `bash-grep-output-mode.ts` registers a bash result-rendering wrapper. It can hide, compact, or fully expand bash output while preserving the sandbox behavior underneath.
- `bash-grep-output-mode.ts` also wraps `grep` rendering directly, because `grep` is a separate built-in tool and does not go through the bash coordinator.
- `bash-tool-coordinator.ts` is intentionally top-level. Keep it copied with the repository even though it does not register a user-facing command.

### Plan workflow: `plan-mode/` + `pi-sandbox/` + `pi-glance/`

These three extensions cooperate but have separate responsibilities:

1. `plan-mode/` owns the planning state. It registers `/plan`, `/plan-todos`, `Shift+Tab`, and `--plan`, tracks todo items, emits `plan-mode:state`, and responds to `plan-mode:request-state`.
2. `pi-glance/` is display-only for planning. It listens for `plan-mode:state` events and shows a Plan segment in the input surface when plan mode is active or executing. It does not enforce read-only behavior.
3. `plan-mode/` asks `pi-sandbox/` to enforce read-only planning by emitting `pi-sandbox:set-read-only-lock` with owner `plan-mode`.
4. When `pi-sandbox/` is available, plan mode keeps the current active tool set unchanged, but writes under the current working directory are denied by sandbox policy.
5. When `pi-sandbox/` is unavailable, plan mode falls back to a smaller read-only tool set (`read`, `bash`, `grep`, `find`, `ls`, `AskUserQuestion`) and an internal bash allowlist.
6. When the plan is executed, `plan-mode/` lifts the read-only lock and sends execution context so the agent can work through numbered steps and mark progress with `[DONE:n]`.

### Safety and recovery layers

- `permission-gate.ts` is a prompt-based safety net for obviously dangerous bash commands. It is independent of `pi-sandbox/` and still useful when the sandbox is disabled.
- `pi-sandbox/` is the stronger policy layer. It controls OS-level bash sandboxing and direct-tool filesystem/network prompts.
- `plan-mode/` is a workflow layer. It requests read-only behavior from `pi-sandbox/`, but falls back gracefully when no sandbox is present.
- `pi-rewind/` is a recovery layer, not a prevention layer. Use it to roll back file and/or conversation state after an agent change goes wrong.
- `pi-glance/` and `progress-checkpoints.ts` are visibility layers. They help you see current state and progress; they do not enforce safety by themselves.

## Common Workflows

### Safer planning and execution

Use these together:

- `pi-sandbox/` for filesystem/network permission gates and cwd-scoped read-only locks.
- `plan-mode/` for read-only planning before edits.
- `pi-glance/` to show plan state in the input surface.
- `pi-rewind/` to recover from bad file changes.
- `permission-gate.ts` as a simple confirmation layer for risky bash commands.

### Cleaner terminal output

Use these together:

- `hide-read-output.ts` to hide all built-in `read` result output.
- `bash-grep-output-mode.ts` to control noisy command/search output.
- `hide-code-fence-markers.ts` for cleaner markdown code blocks.
- `copy-code-block.ts` when you want quick clipboard access to generated code.

### Long-running autonomous tasks

Use these together:

- `pi-goal/` to keep the agent focused on a user-defined objective.
- `progress-checkpoints.ts` to keep public progress updates concise.
- `effort.ts` to adjust reasoning level without opening settings.

### Image-heavy prompts

Use `pretty-image-paste.ts` when pasting multiple screenshots or clipboard images. It keeps the editor readable by showing `[Image #n]` labels, then re-attaches the corresponding image files on submit.

## Notes

- The root `package.json` declares the package extension entries under `pi.extensions`. Keep it in sync when adding or removing top-level extensions.
- `bash-tool-coordinator.ts` is a helper module, but it is still listed in the package manifest so package installs mirror the local auto-discovered extension directory.
- `pi-glance/` and `pi-sandbox/` have their own `package.json` files and may also be usable as standalone pi packages.
- `pi-sandbox/dist/` is intentionally kept because `pi-sandbox/index.ts` re-exports `./dist/index.js`.
- Generated development directories such as `pi-glance/.tmp-git-dev/` are intentionally ignored.
- Some files include attribution comments for code adapted from existing MIT-licensed pi extensions. Keep those notices when redistributing.

## License

MIT. See [LICENSE](LICENSE).

Subdirectories or files that carry their own license or attribution notices should retain those notices.
