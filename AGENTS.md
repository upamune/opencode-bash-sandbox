# Repository Guidelines

## Project Structure & Module Organization

This repository contains an OpenCode plugin that replaces the built-in `bash` tool with a microsandbox-backed microVM.

- `plugin/microsandbox-bash.ts` is the source entry point and only wires plugin registration, prewarm, shutdown, and the `bash` tool together.
- Focused runtime modules live under `plugin/`: `bash-tool.ts` contains tool execution, `sandbox-pool.ts` owns sandbox lifecycle, `sandbox.ts` builds the base VM, `network.ts` configures network and secrets, and `sandbox-config.ts` applies ports, rlimits, volumes, and patches.
- `dist/` is generated build output and should not be edited by hand.
- `README.md` documents user-facing setup and configuration.
- `package.json`, `tsconfig.json`, `.oxlintrc.json`, and `knip.json` define scripts, TypeScript, lint, and unused-code checks.
- `test/` contains Bun tests for helper behavior that should stay stable across refactors.

## Build, Test, and Development Commands

Use the package scripts as the source of truth:

- `pnpm install` installs dependencies from `pnpm-lock.yaml`.
- `pnpm run build` bundles `plugin/microsandbox-bash.ts` to `dist/index.js` with Bun.
- `pnpm test` runs Bun tests.
- `pnpm run check` runs TypeScript type checking, Oxlint, and Knip.
- `pnpm run fmt` formats TypeScript files in `plugin/`.
- `pnpm run fmt:check` verifies formatting without writing changes.

microsandbox requires Node.js 22 or newer and either Linux with KVM enabled or macOS on Apple Silicon. If optional runtime dependencies were skipped, install the `msb` runtime with the microsandbox installer or set `MSB_PATH` to a working `msb` binary. Docker is not required and should not be used for validation.

## Coding Style & Naming Conventions

Write TypeScript as ES modules using the strict settings in `tsconfig.json`. Prefer small typed helpers for path, timeout, and configuration logic. Use two-space indentation, double quotes, and trailing commas where the formatter adds them. Use `PascalCase` for plugin/type names such as `MicrosandboxBashPlugin`, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for constants such as `WORKSPACE`.

## Testing Guidelines

Before submitting changes, run `pnpm test`, `pnpm run check`, and `pnpm run build`. For behavior changes, manually exercise the plugin through OpenCode with a temporary `opencode.json`, including workspace-relative commands, timeout handling, and network/secrets options.

## Commit & Pull Request Guidelines

This repository has no commit history yet, so no local convention is established. Use concise imperative commit messages, for example `Add sandbox timeout handling` or `Document network configuration`. Pull requests should include a brief summary, validation commands run, runtime caveats such as microsandbox platform requirements, and any linked issue. Include screenshots only when documentation or UI output changes make them useful.

## Security & Configuration Tips

Do not hardcode credentials in examples or tests. Use `{env:VAR_NAME}` secret references and keep network access explicit through `allowedHosts` or `allowedInternalHosts`. Treat changes to path mapping, mounted directories, and network policy or secret substitution as security-sensitive and review them carefully.
