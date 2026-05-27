import type { PluginOptions } from "@opencode-ai/plugin";

export function stringOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return typeof value === "string" ? value : undefined;
}

export function numberOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return typeof value === "number" ? value : undefined;
}

export function booleanOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function stringArrayOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

export function stringRecordOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseMemoryMiB(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt]?i?b?)?$/i);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unit = (match[2] ?? "m").toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  if (unit.startsWith("k")) return Math.ceil(amount / 1024);
  if (unit.startsWith("g")) return Math.ceil(amount * 1024);
  if (unit.startsWith("t")) return Math.ceil(amount * 1024 * 1024);
  return Math.ceil(amount);
}
