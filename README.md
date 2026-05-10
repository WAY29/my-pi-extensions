# Pi Extensions

English | [简体中文](README_CN.md)

Personal extension collection for [pi](https://pi.dev). These extensions are intended to live in `~/.pi/agent/extensions/` and can be enabled with pi's normal extension discovery plus `/reload`.

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

| Extension | Type | Main command / tool | Purpose |
|---|---:|---|---|
| `AskUserQuestion.ts` | tool | `AskUserQuestion` | Adds an interactive question tool for the agent. Supports single or multi-question flows, option lists, custom text answers, and per-option notes. |
| `bash-grep-output-mode.ts` | UI/tool renderer | `/bash-grep-output`, `Ctrl+Shift+O`, `Alt+O` | Toggles `bash`/`grep` output rendering between `hidden`, `compact`, and `full` without changing what the model receives. |
| `codex-apply-patch.ts` | tool | `apply_patch` | Adds a structured patch tool for `create_file`, `update_file`, and `delete_file` operations using V4A-style diffs. Keeps built-in `edit`/`write` available. |
| `copy-code-block.ts` | command/shortcut | `/copy-code`, `Ctrl+Alt+C` | Copies code blocks from the latest assistant message. Supports choosing a block, copying all blocks, and preserving markdown fences. |
| `effort.ts` | command | `/effort` | Quickly switches or cycles pi thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`. |
| `hide-code-fence-markers.ts` | UI patch | automatic | Cleans up markdown code block rendering by hiding extra code fence marker lines in the terminal UI. |
| `hide-read-output.ts` | UI/tool renderer | automatic | Hides all rendered result output from the built-in `read` tool in the TUI while still returning file contents to the model. Consecutive reads are grouped into concise summaries. |
| `permission-gate.ts` | safety gate | automatic | Prompts before potentially dangerous bash commands such as `rm`, `sudo`, or `chmod/chown ... 777`. Blocks by default when no UI is available. |
| `progress-checkpoints.ts` | prompt helper | `/progress`, `/progress-checkpoints` | Injects a progress-checkpoint policy so the assistant gives short status updates around multi-step or tool-heavy work. |
| `pi-glance/` | UI/input surface | `/glance` | Replaces the default input area with a rounded multiline editor and inline status glance for model, context, tokens, cost, Git, title, and plan state. |
| `pi-goal/` | goal manager | `/goal`, `get_goal`, `update_goal` | Tracks a long-running thread goal, optional token budget, continuation prompts, status bar state, and verified completion via tool call. |
| `pi-rewind/` | checkpoint/restore | `/rewind`, `Esc Esc` | Creates Git-based checkpoints after mutating turns and lets you rewind files and/or conversation state when an agent change goes wrong. |
| `pi-sandbox/` | security/sandbox | `/sandbox`, `/sandbox-enable`, `/sandbox-disable`, `--no-sandbox` | Adds OS-level bash sandboxing plus filesystem/network permission prompts for direct tools. Integrates with `plan-mode` read-only locks. |
| `plan-mode/` | planning workflow | `/plan`, `/plan-todos`, `Shift+Tab`, `--plan` | Read-only exploration mode for safe planning, then execution mode with numbered plan steps and `[DONE:n]` progress tracking. |

## Common Workflows

### Safer planning and execution

Use these together:

- `pi-sandbox/` for filesystem/network permission gates.
- `plan-mode/` for read-only planning before edits.
- `pi-glance/` to show plan state in the input surface.
- `pi-rewind/` to recover from bad file changes.

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

## Notes

- `pi-glance/` and `pi-sandbox/` have their own `package.json` files and may also be usable as standalone pi packages.
- `pi-sandbox/dist/` is intentionally kept because `pi-sandbox/index.ts` re-exports `./dist/index.js`.
- Some files include attribution comments for code adapted from existing MIT-licensed pi extensions. Keep those notices when redistributing.

## License

MIT. See [LICENSE](LICENSE).

Subdirectories or files that carry their own license or attribution notices should retain those notices.
