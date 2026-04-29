# opencode-bash-sandbox

An [OpenCode](https://opencode.ai) plugin that replaces the built-in `bash` tool with one that runs every command inside a [Gondolin](https://github.com/earendil-works/gondolin) micro-VM sandbox.

## How it works

Each OpenCode session gets a persistent Alpine Linux VM. The project directory is mounted read-write at `/workspace` inside the VM, so the LLM can read and modify files normally. Outbound network access is blocked by default; you can allow specific hosts via plugin options.

```
┌─────────────────────────────────────┐
│  OpenCode (host)                    │
│                                     │
│  bash tool call                     │
│       │                             │
│       ▼                             │
│  ┌─────────────────────────────┐    │
│  │  Gondolin micro-VM (QEMU)   │    │
│  │                             │    │
│  │  /workspace  ←── project    │    │
│  │  network     ←── blocked    │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

Because this plugin registers a tool named `bash`, it automatically takes precedence over OpenCode's built-in bash tool.

## Requirements

QEMU must be installed and `qemu-img` must be on `$PATH`.

| macOS | Linux (Arch) | Linux (Debian/Ubuntu) |
|---|---|---|
| `brew install qemu` | `pacman -S qemu-base` | `apt install qemu-system` |

## Usage

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-bash-sandbox"]
}
```

To apply globally, add it to `~/.config/opencode/opencode.json` instead.

## Configuration

All options are optional.

```json
{
  "plugin": [
    ["opencode-bash-sandbox", {
      "memory": "2G",
      "cpus": 4,
      "startTimeoutMs": 30000,
      "allowedHosts": ["api.github.com", "registry.npmjs.org"],
      "allowedInternalHosts": ["internal.example.com"],
      "blockInternalRanges": false,
      "secrets": {
        "GITHUB_TOKEN": {
          "hosts": ["api.github.com"],
          "value": "{env:GITHUB_TOKEN}"
        }
      }
    }]
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `memory` | `"1G"` | VM memory (QEMU syntax: `"2G"`, `"512M"`, …) |
| `cpus` | `2` | VM CPU count |
| `startTimeoutMs` | (gondolin default) | VM startup timeout in ms |
| `allowedHosts` | none (all blocked) | Hostnames the VM may reach over HTTP/HTTPS |
| `allowedInternalHosts` | none | Hosts allowed to resolve to internal IP ranges |
| `blockInternalRanges` | `true` | Block connections to private/loopback IP ranges |
| `secrets` | none | Secrets injected into outbound request headers |

### Secrets

Secret values support `{env:VAR_NAME}` references so you don't have to hardcode credentials in `opencode.json`:

```json
"secrets": {
  "GITHUB_TOKEN": {
    "hosts": ["api.github.com"],
    "value": "{env:GITHUB_TOKEN}"
  }
}
```

The VM never sees the real value — Gondolin intercepts outbound HTTP headers on the host side and substitutes the placeholder.
