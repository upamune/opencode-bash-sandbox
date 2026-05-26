import path from "node:path";
import { tool, type ToolContext } from "@opencode-ai/plugin";
import { ExecTimeoutError, SandboxStillRunningError } from "microsandbox";
import { DEFAULT_TIMEOUT_MS } from "./constants.js";
import { isSandboxFailure } from "./errors.js";
import { outputPreview } from "./output.js";
import { toGuestPath } from "./path.js";
import type { createSandboxPool } from "./sandbox-pool.js";

type BashArgs = {
  command: string;
  timeout?: number;
  workdir?: string;
  description: string;
};

type SandboxPool = ReturnType<typeof createSandboxPool>;

async function askForExternalWorkdir(ctx: ToolContext, workdir: string) {
  await ctx.ask({
    permission: "external_directory",
    patterns: [path.join(workdir, "*")],
    always: [path.join(workdir, "*")],
    metadata: {},
  });
}

export function createBashTool(sandboxes: SandboxPool) {
  return tool({
    description:
      "Executes a given bash command in a persistent microsandbox microVM with optional timeout.",
    args: {
      command: tool.schema.string().describe("The command to execute"),
      timeout: tool.schema.number().optional().describe("Optional timeout in milliseconds"),
      workdir: tool.schema
        .string()
        .optional()
        .describe(
          "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.",
        ),
      description: tool.schema
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    },
    async execute(args: BashArgs, ctx) {
      if (args.timeout !== undefined && args.timeout < 0) {
        throw new Error(
          `Invalid timeout value: ${args.timeout}. Timeout must be a positive number.`,
        );
      }

      const root = path.resolve(ctx.directory);
      const entry = await sandboxes.getSandbox(root);
      const hostWorkdir = args.workdir
        ? path.resolve(ctx.directory, args.workdir)
        : entry.directory;
      const guestWorkdir = toGuestPath(hostWorkdir, entry.directory, entry.workspace);

      if (!guestWorkdir) {
        await askForExternalWorkdir(ctx, hostWorkdir);
        return {
          output:
            `microsandbox bash refused workdir outside the mounted workspace: ${hostWorkdir}\n` +
            `Mount additional host paths explicitly before running commands there.`,
          metadata: {
            output: "",
            description: args.description,
            exit: 1,
            truncated: false,
          },
        };
      }

      await ctx.metadata({
        metadata: {
          output: "",
          description: args.description,
        },
      });

      let result;
      try {
        result = await entry.sandbox.execWith("/bin/sh", (exec) => {
          exec.args(["-lc", args.command]).cwd(guestWorkdir);
          if (args.timeout !== 0) exec.timeout(args.timeout ?? DEFAULT_TIMEOUT_MS);
          return exec;
        });
      } catch (error) {
        if (error instanceof ExecTimeoutError) {
          const output = `Command timed out after ${error.timeoutMs ?? args.timeout ?? DEFAULT_TIMEOUT_MS} ms`;
          const metadata = {
            output,
            description: args.description,
            exit: 124,
            truncated: false,
          };
          await ctx.metadata({ metadata });
          return { output, metadata };
        }

        if (isSandboxFailure(error) && !(error instanceof SandboxStillRunningError)) {
          await sandboxes.discardSandbox(root);
        }
        throw error;
      }

      const stdout = result.stdout();
      const stderr = result.stderr();
      const output = stderr
        ? `${stdout}${stdout ? "\n" : ""}<stderr>\n${stderr}</stderr>`
        : stdout || "(no output)";

      const metadata = {
        output: outputPreview(output),
        description: args.description,
        exit: result.code,
        truncated: false,
      };

      await ctx.metadata({ metadata });

      return {
        output,
        metadata,
      };
    },
  });
}
