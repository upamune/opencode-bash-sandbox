# Repository Guidelines

## Project Structure & Module Organization

This repository contains an OpenCode plugin that replaces the built-in `bash` tool with a Gondolin-backed sandbox.

- `plugin/gondolin-bash.ts` is the source entry point and contains the plugin registration, VM lifecycle, path mapping, network hook setup, and tool execution logic.
- `dist/` is generated build output and should not be edited by hand.
- `README.md` documents user-facing setup and configuration.
- `package.json`, `tsconfig.json`, `.oxlintrc.json`, and `knip.json` define scripts, TypeScript, lint, and unused-code checks.
- There is currently no dedicated test directory; add tests alongside source or under `test/` when introducing a test runner.

## Build, Test, and Development Commands

Use the package scripts as the source of truth:

- `pnpm install` installs dependencies from `pnpm-lock.yaml`.
- `pnpm run build` bundles `plugin/gondolin-bash.ts` to `dist/index.js` with Bun.
- `pnpm run check` runs TypeScript type checking, Oxlint, and Knip.
- `pnpm run fmt` formats TypeScript files in `plugin/`.
- `pnpm run fmt:check` verifies formatting without writing changes.

QEMU must be installed for runtime validation because Gondolin starts micro-VMs.

## Coding Style & Naming Conventions

Write TypeScript as ES modules using the strict settings in `tsconfig.json`. Prefer small typed helpers for path, timeout, and configuration logic. Use two-space indentation, double quotes, and trailing commas where the formatter adds them. Use `PascalCase` for plugin/type names such as `GondolinBashPlugin`, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for constants such as `WORKSPACE`.

## Testing Guidelines

No automated test framework is configured yet. Before submitting changes, run `pnpm run check` and `pnpm run build`. For behavior changes, manually exercise the plugin through OpenCode with a temporary `opencode.json`, including workspace-relative commands, timeout handling, and network/secrets options. If you add tests, document the new command in `package.json` and this file.

## Commit & Pull Request Guidelines

This repository has no commit history yet, so no local convention is established. Use concise imperative commit messages, for example `Add sandbox timeout handling` or `Document network configuration`. Pull requests should include a brief summary, validation commands run, runtime caveats such as QEMU requirements, and any linked issue. Include screenshots only when documentation or UI output changes make them useful.

## Security & Configuration Tips

Do not hardcode credentials in examples or tests. Use `{env:VAR_NAME}` secret references and keep network access explicit through `allowedHosts` or `allowedInternalHosts`. Treat changes to path mapping, mounted directories, and HTTP hooks as security-sensitive and review them carefully.
