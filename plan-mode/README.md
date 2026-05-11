# Plan Mode Extension

Exploration mode for safe code analysis. With pi-sandbox, plan mode only blocks writes under the current working directory.

## Features

- **Sandbox integration**: If pi-sandbox is loaded, enables a cwd-scoped write lock while keeping all current tools available
- **Fallback read-only tools**: If pi-sandbox is unavailable, restricts available tools to read, bash, grep, find, ls, question
- **Fallback bash allowlist**: Only read-only bash commands are allowed when sandbox locking is unavailable
- **Plan extraction**: Extracts 1-10 numbered steps from `Plan:` sections
- **Progress tracking**: Widget shows completion status during execution
- **`plan_complete_step` tool**: Execution-time tool marks completed steps immediately
- **[DONE:n] markers**: Transcript fallback for completion tracking (spaces/full-width colon are tolerated)
- **Session persistence**: State survives session resume
- **pi-glance integration**: Emits `plan-mode:state` events for display in pi-glance

## Commands

- `/plan` - Toggle plan mode (protect cwd from writes)
- `/plan-todos` - Show current plan progress
- `Shift+Tab` - Toggle plan mode (shortcut)

## Usage

1. Enable plan mode with `/plan`, `Shift+Tab`, or `--plan` flag
2. Ask the agent to analyze code and create a plan
3. The agent should output a numbered plan under a `Plan:` header:

```
Plan:
1. First step description
2. Second step description
3. Third step description
```

Use between 1 and 10 steps. Never include step 11 or beyond.

4. Choose "Execute the plan" when prompted
5. During execution, the agent marks steps complete with `plan_complete_step` and `[DONE:n]` tags such as `[DONE:1]`
6. Progress widget shows completion status

## How It Works

### Plan Mode (Protected cwd)
- With pi-sandbox: all current tools stay available, but writes under the current working directory are denied by sandbox policy
- Without pi-sandbox: only fallback read-only tools are available
- Bash commands are filtered through an allowlist only in fallback mode
- Agent creates a plan without making changes under the current working directory

### Execution Mode
- Plan-mode write restrictions are lifted
- Agent executes steps in order
- The `plan_complete_step` tool marks completed steps immediately during execution
- `[DONE:n]` markers rebuild completion from the transcript; `[DONE: 1]`, `[DONE：1]`, and grouped markers such as `[DONE:1,2]` are accepted
- Widget shows progress

### Fallback Command Allowlist

Used only when pi-sandbox is unavailable.

Safe commands (allowed):
- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- System info: `uname`, `whoami`, `date`, `uptime`

Blocked commands:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`
