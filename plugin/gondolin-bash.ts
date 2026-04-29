import path from "node:path";
import process from "node:process";
import { tool, type Plugin, type PluginOptions, type ToolContext } from "@opencode-ai/plugin";
import {
  createHttpHooks,
  RealFSProvider,
  VM,
  type SecretDefinition,
} from "@earendil-works/gondolin";

type BashArgs = {
  command: string;
  timeout?: number;
  workdir?: string;
  description: string;
};

type VmEntry = {
  vm: VM;
  directory: string;
  workspace: string;
};

type SecretInput = {
  hosts: string[];
  value: string;
};

const WORKSPACE = "/workspace";
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function timeoutCommand(command: string, timeoutMs: number) {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return `if command -v timeout >/dev/null 2>&1; then timeout -s TERM ${seconds}s /bin/sh -lc ${shellQuote(command)}; else /bin/sh -lc ${shellQuote(command)}; fi`;
}

function toGuestPath(hostPath: string, directory: string, workspace: string) {
  if (hostPath === workspace || hostPath.startsWith(`${workspace}/`)) return hostPath;

  const absolute = path.resolve(directory, hostPath);
  const relative = path.relative(directory, absolute);
  if (relative === "") return workspace;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return path.posix.join(workspace, relative.split(path.sep).join(path.posix.sep));
}

function outputPreview(value: string) {
  const max = 30_000;
  if (value.length <= max) return value;
  return `...\n\n${value.slice(-max)}`;
}

async function askForExternalWorkdir(ctx: ToolContext, workdir: string) {
  await ctx.ask({
    permission: "external_directory",
    patterns: [path.join(workdir, "*")],
    always: [path.join(workdir, "*")],
    metadata: {},
  });
}

// Resolve "{env:VAR_NAME}" references in secret values.
function resolveEnvRef(value: string): string {
  return value.replace(/\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

function buildNetworkConfig(options?: PluginOptions) {
  const allowedHosts = options?.allowedHosts;
  const allowedInternalHosts = options?.allowedInternalHosts;
  const blockInternalRanges = options?.blockInternalRanges;
  const secretsInput = options?.secrets;

  const hasNetworkOption =
    (Array.isArray(allowedHosts) && allowedHosts.length > 0) ||
    (Array.isArray(allowedInternalHosts) && allowedInternalHosts.length > 0) ||
    blockInternalRanges !== undefined ||
    (secretsInput !== null && typeof secretsInput === "object");

  if (!hasNetworkOption) return undefined;

  const secrets: Record<string, SecretDefinition> = {};
  if (secretsInput !== null && typeof secretsInput === "object") {
    for (const [key, raw] of Object.entries(secretsInput as Record<string, unknown>)) {
      const s = raw as SecretInput;
      secrets[key] = {
        hosts: s.hosts,
        value: resolveEnvRef(s.value),
      };
    }
  }

  return createHttpHooks({
    ...(Array.isArray(allowedHosts) && allowedHosts.length > 0
      ? { allowedHosts: allowedHosts as string[] }
      : {}),
    ...(Array.isArray(allowedInternalHosts) && allowedInternalHosts.length > 0
      ? { allowedInternalHosts: allowedInternalHosts as string[] }
      : {}),
    ...(blockInternalRanges !== undefined
      ? { blockInternalRanges: blockInternalRanges as boolean }
      : {}),
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
  });
}

const GondolinBashPlugin: Plugin = async (_input, options) => {
  const networkConfig = buildNetworkConfig(options);
  const memory = typeof options?.memory === "string" ? options.memory : undefined;
  const cpus = typeof options?.cpus === "number" ? options.cpus : undefined;
  const startTimeoutMs =
    typeof options?.startTimeoutMs === "number" ? options.startTimeoutMs : undefined;
  const vmm =
    typeof options?.vmm === "string" ? options.vmm : "qemu";
  const krunRunnerPath =
    typeof options?.krunRunnerPath === "string" ? options.krunRunnerPath : undefined;

  const vms = new Map<string, Promise<VmEntry>>();

  function getVm(directory: string) {
    const root = path.resolve(directory);
    let entry = vms.get(root);
    if (!entry) {
      entry = VM.create({
        sessionLabel: `opencode:${root}`,
        sandbox: {
          vmm: vmm as "qemu" | "krun",
          ...(krunRunnerPath !== undefined ? { krunRunnerPath } : {}),
        },
        rootfs: {
          mode: "readonly",
        },
        ...(networkConfig ? { httpHooks: networkConfig.httpHooks, env: networkConfig.env } : {}),
        ...(memory !== undefined ? { memory } : {}),
        ...(cpus !== undefined ? { cpus } : {}),
        ...(startTimeoutMs !== undefined ? { startTimeoutMs } : {}),
        vfs: {
          mounts: {
            [WORKSPACE]: new RealFSProvider(root),
          },
        },
      }).then((vm) => ({ vm, directory: root, workspace: WORKSPACE }));
      vms.set(root, entry);
    }
    return entry;
  }

  async function closeAll() {
    const entries = await Promise.allSettled(vms.values());
    vms.clear();
    await Promise.allSettled(
      entries.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value.vm.close()] : [])),
    );
  }

  process.once("beforeExit", () => {
    void closeAll();
  });

  return {
    tool: {
      // Same public tool id and same argument interface as OpenCode's built-in bash tool.
      bash: tool({
        description:
          "Executes a given bash command in a persistent Gondolin VM sandbox with optional timeout.",
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

          const entry = await getVm(ctx.directory);
          const hostWorkdir = args.workdir
            ? path.resolve(ctx.directory, args.workdir)
            : entry.directory;
          const guestWorkdir = toGuestPath(hostWorkdir, entry.directory, entry.workspace);

          if (!guestWorkdir) {
            await askForExternalWorkdir(ctx, hostWorkdir);
            return {
              output:
                `Gondolin bash refused workdir outside the mounted workspace: ${hostWorkdir}\n` +
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

          const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;
          const command = timeout > 0 ? timeoutCommand(args.command, timeout) : args.command;
          const result = await entry.vm.exec(["/bin/sh", "-lc", command], {
            cwd: guestWorkdir,
            stdout: "buffer",
            stderr: "buffer",
          });

          const output = result.stderr
            ? `${result.stdout}${result.stdout ? "\n" : ""}<stderr>\n${result.stderr}</stderr>`
            : result.stdout || "(no output)";

          const metadata = {
            output: outputPreview(output),
            description: args.description,
            exit: result.exitCode,
            truncated: false,
          };

          await ctx.metadata({ metadata });

          return {
            output,
            metadata,
          };
        },
      }),
    },
  };
};

export default GondolinBashPlugin;
