import process from "node:process";

// Resolve "{env:VAR_NAME}" references in secret values.
export function resolveEnvRef(value: string): string {
  return value.replace(/\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}
