# opencode-bash-sandbox

An [OpenCode](https://opencode.ai) plugin that replaces the built-in `bash` tool with one that runs every command inside a [microsandbox](https://github.com/superradcompany/microsandbox) microVM.

## How it works

Each OpenCode project directory gets a persistent microsandbox VM. The project directory is mounted read-write at `/workspace` inside the VM, so the LLM can read and modify files normally. Outbound network access is blocked by default; allow specific hosts, publish ports, mount volumes, and inject secrets through plugin options.

```
┌─────────────────────────────────────┐
│  OpenCode (host)                    │
│                                     │
│  bash tool call                     │
│       │                             │
│       ▼                             │
│  ┌─────────────────────────────┐    │
│  │  microsandbox microVM       │    │
│  │                             │    │
│  │  /workspace  ←── project    │    │
│  │  network     ←── policy     │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

Because this plugin registers a tool named `bash`, it automatically takes precedence over OpenCode's built-in bash tool.

## Requirements

- Node.js 22 or newer.
- Linux with KVM enabled, or macOS on Apple Silicon.
- The `microsandbox` runtime. The npm package installs the matching platform package automatically in normal installs. If optional dependencies were skipped, install the `msb` runtime with the microsandbox installer or set `MSB_PATH` to a working `msb` binary.
- Docker is not required. The plugin does not call the `docker` CLI or require a Docker daemon; microsandbox pulls OCI images directly.

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
      "image": "ghcr.io/linuxcontainers/alpine:latest",
      "memory": "2G",
      "cpus": 4,
      "prewarm": true,
      "allowedHosts": ["api.github.com", "registry.npmjs.org"],
      "allowedInternalHosts": ["internal.example.com"],
      "blockInternalRanges": false,
      "ports": [{ "host": 3000, "guest": 3000 }],
      "env": {
        "NODE_ENV": "development"
      },
      "secrets": {
        "GITHUB_TOKEN": {
          "hosts": ["api.github.com"],
          "value": "{env:GITHUB_TOKEN}"
        }
      },
      "volumes": [
        { "guest": "/cache", "kind": "named", "source": "opencode-cache" },
        { "guest": "/tmp/build", "kind": "tmpfs", "sizeMiB": 512 }
      ]
    }]
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `image` | `"ghcr.io/linuxcontainers/alpine:latest"` | OCI image to boot in microsandbox |
| `memory` | microsandbox default | VM memory in MiB or string form such as `"512M"` or `"2G"` |
| `cpus` | microsandbox default | VM CPU count |
| `prewarm` | `true` | Start the project sandbox in the background when the plugin loads |
| `user` | image default | User for sandbox commands |
| `shell` | image default | Shell configured for the sandbox |
| `hostname` | microsandbox default | Sandbox hostname |
| `pullPolicy` | microsandbox default | Image pull policy, for example `"if-missing"` |
| `logLevel` | microsandbox default | Runtime log level |
| `metricsSampleIntervalMs` | microsandbox default | Metrics sampling interval |
| `disableMetrics` | `false` | Disable metrics sampling |
| `maxDurationSeconds` | none | Maximum sandbox lifetime |
| `idleTimeoutSeconds` | none | Sandbox idle timeout |
| `disableNetwork` | `false` | Disable networking entirely |
| `allowAllNetwork` | `false` | Allow unrestricted network access |
| `allowedHosts` | none | Public hostnames the VM may reach |
| `allowedInternalHosts` | none | Hostnames allowed even when they resolve to internal ranges |
| `blockInternalRanges` | `true` | Enable DNS rebind protection for private ranges |
| `nameservers` | system default | Custom DNS nameservers |
| `dnsQueryTimeoutMs` | microsandbox default | DNS query timeout |
| `tlsBypass` | none | TLS interception bypass patterns |
| `tlsInterceptedPorts` | microsandbox default | TLS intercepted ports |
| `tlsVerifyUpstream` | microsandbox default | Verify upstream TLS certificates |
| `tlsBlockQuic` | microsandbox default | Block QUIC traffic |
| `secretViolationAction` | microsandbox default | Action for secret policy violations |
| `maxConnections` | microsandbox default | Maximum network connections |
| `trustHostCAs` | microsandbox default | Trust host CA certificates |
| `ports` | none | TCP port mappings, `{ "host": 3000, "guest": 3000 }` |
| `udpPorts` | none | UDP port mappings |
| `env` | none | Environment variables, with `{env:VAR_NAME}` expansion |
| `rlimits` | none | Sandbox resource limits |
| `volumes` | none | Additional bind, named, tmpfs, or disk volumes |
| `scripts` | none | microsandbox scripts map |
| `patchText` | none | Text files to write into the rootfs before boot |
| `secrets` | none | Secrets injected by microsandbox network-layer substitution |

### Network

Network access is denied by default. Set `allowedHosts` and `allowedInternalHosts` to create a deny-by-default egress policy with DNS enabled and explicit domain allow rules. Set `allowAllNetwork: true` only when the sandbox should have unrestricted network access.

### Secrets

Secret values support `{env:VAR_NAME}` references so you do not have to hardcode credentials in `opencode.json`:

```json
"secrets": {
  "GITHUB_TOKEN": {
    "hosts": ["api.github.com"],
    "value": "{env:GITHUB_TOKEN}"
  }
}
```

microsandbox exposes a placeholder to the VM and substitutes the real value at the network layer only for allowed hosts.
