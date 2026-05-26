import { ExecTimeoutError } from "microsandbox";

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isSandboxFailure(error: unknown) {
  return (
    error instanceof ExecTimeoutError ||
    errorMessage(error).includes("sandbox") ||
    errorMessage(error).includes("microVM") ||
    errorMessage(error).includes("libkrun")
  );
}

export function warn(message: string, error?: unknown) {
  if (error === undefined) {
    console.warn(`[opencode-bash-sandbox] ${message}`);
    return;
  }
  console.warn(`[opencode-bash-sandbox] ${message}: ${errorMessage(error)}`);
}
