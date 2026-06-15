# pi-sandbox

`pi-sandbox` adds OS-level sandboxing for `bash` plus matching filesystem/network prompts for direct Pi tools.

## Config Files

This extension reads configuration from these files, merged in order:

1. Built-in defaults
2. `~/.pi/agent/sandbox.json` for all projects
3. `<workspace>/.pi/sandbox.json` for one project

After editing config, run `/reload` so the OS-level sandbox profile is rebuilt.

> Note: `pi-sandbox/sandbox.json` in this directory is a standalone package example. The live global config path for this fork is `~/.pi/agent/sandbox.json`.

## macOS Starter Example

This example is based on a real macOS setup. It allows the current workspace and common language/tool caches to be writable, while still denying reads of secret directories and writes to secret-looking files.

Copy it to `~/.pi/agent/sandbox.json`, then remove paths you do not use:

```json
{
  "enabled": true,
  "network": {
    "allowedDomains": ["*"],
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": [
      "~/.ssh",
      "~/.aws",
      "~/.gnupg"
    ],
    "allowRead": [
      "~/.ssh/known_hosts"
    ],
    "allowWrite": [
      ".",
      "/tmp",
      "/var/folders",
      "~/.npm",
      "~/.cache/npm",
      "~/.cache/uv",
      "~/.cache/go-build",
      "~/Library/Caches/go-build",
      "~/go/pkg",
      "~/coding/golang/pkg",
      "~/.bun",
      "~/Library/Caches/bun",
      "~/.pi/agent/pi-rewind",
      "~/.local/pipx",
      "~/Library/Logs/pipx",
      "~/Library/Application Support"
    ],
    "denyWrite": [
      ".env",
      "*.pem",
      "*.key"
    ]
  }
}
```

### Why These Write Paths Matter

- `.` allows edits and build outputs inside the current workspace.
- `/tmp`, `/var/folders`, and the sandbox `TMPDIR` are used by macOS tools and temporary build steps.
- `~/.npm`, `~/.cache/npm`, `~/.cache/uv`, `~/.bun`, and `~/Library/Caches/bun` support package managers.
- `~/.cache/go-build` is common on Linux; `~/Library/Caches/go-build` is the default Go build cache on macOS.
- `~/go/pkg` and custom GOPATH entries such as `~/coding/golang/pkg` are needed when Go downloads or updates modules.
- `~/.pi/agent/pi-rewind` lets `pi-rewind` create recovery checkpoints.
- `~/.local/pipx` and `~/Library/Logs/pipx` support `pipx` installs and logs.
- `~/Library/Application Support` is broad but convenient for browser/app automation; prefer a narrower app-specific path when possible, such as `~/Library/Application Support/Google/Chrome`.
- `~/.ssh/known_hosts` lets SSH-based Git verify hosts without allowing reads of private keys under `~/.ssh`.

## Read Policy Notes

Reads are blacklist-based by default: everything is readable except paths matching `denyRead`.

`allowRead` is an exception list inside denied read roots. Use it to re-allow specific safe files or subdirectories without opening the rest of a sensitive directory. For example, SSH-based Git can read host keys without exposing private keys:

```json
{
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", "~/.gnupg"],
    "allowRead": ["~/.ssh/known_hosts"]
  }
}
```

The read/write precedence is intentionally asymmetric:

- Read: `allowRead` overrides `denyRead` for matching child paths.
- Write: `denyWrite` overrides `allowWrite` for matching sensitive files.

## Safer Tuning Tips

- Prefer project config in `<workspace>/.pi/sandbox.json` for one-off toolchain needs.
- Prefer app-specific paths over broad directories like `~/Library/Application Support`.
- Keep `denyWrite` entries for secrets even if a parent directory is in `allowWrite`; deny rules take precedence.
- If a command fails with `operation not permitted`, add only the exact cache/output directory shown in the error, then run `/reload`.
