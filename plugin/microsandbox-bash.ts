import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { tool, type Plugin, type PluginOptions, type ToolContext } from "@opencode-ai/plugin";
import {
  Destination,
  ExecTimeoutError,
  NetworkPolicy,
  Rule,
  Sandbox,
  SandboxStillRunningError,
  type SandboxBuilder,
} from "microsandbox";

type BashArgs = {
  command: string;
  timeout?: number;
  workdir?: string;
  description: string;
};

type SandboxEntry = {
  sandbox: Sandbox;
  directory: string;
  workspace: string;
};

type SandboxRecord = {
  promise: Promise<SandboxEntry>;
  sandbox?: Sandbox;
};

type SecretInput = {
  hosts?: string[];
  hostPatterns?: string[];
  value: string;
  placeholder?: string;
  injectHeaders?: boolean;
  injectBasicAuth?: boolean;
  injectQuery?: boolean;
  injectBody?: boolean;
  allowAnyHostDangerous?: boolean;
  requireTlsIdentity?: boolean;
};

type PortInput = {
  host: number;
  guest: number;
};

type VolumeInput = {
  guest: string;
  kind: "bind" | "named" | "tmpfs" | "disk";
  source?: string;
  readonly?: boolean;
  sizeMiB?: number;
  format?: string;
  fstype?: string;
};

type RlimitInput = {
  resource: string;
  limit?: number;
  soft?: number;
  hard?: number;
};

type DnsConfigBuilder = {
  rebindProtection(enabled: boolean): DnsConfigBuilder;
  nameservers(servers: string[]): DnsConfigBuilder;
  queryTimeoutMs(ms: number): DnsConfigBuilder;
};

type TlsConfigBuilder = {
  bypass(pattern: string): TlsConfigBuilder;
  verifyUpstream(verify: boolean): TlsConfigBuilder;
  interceptedPorts(ports: number[]): TlsConfigBuilder;
  blockQuic(block: boolean): TlsConfigBuilder;
};

type SecretConfigBuilder = {
  env(varName: string): SecretConfigBuilder;
  value(value: string): SecretConfigBuilder;
  placeholder(placeholder: string): SecretConfigBuilder;
  allowHost(host: string): SecretConfigBuilder;
  allowHostPattern(pattern: string): SecretConfigBuilder;
  allowAnyHostDangerous(iUnderstand: boolean): SecretConfigBuilder;
  requireTlsIdentity(enabled: boolean): SecretConfigBuilder;
  injectHeaders(enabled: boolean): SecretConfigBuilder;
  injectBasicAuth(enabled: boolean): SecretConfigBuilder;
  injectQuery(enabled: boolean): SecretConfigBuilder;
  injectBody(enabled: boolean): SecretConfigBuilder;
};

const WORKSPACE = "/workspace";
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_IMAGE = "ghcr.io/linuxcontainers/alpine:latest";

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isSandboxFailure(error: unknown) {
  return (
    error instanceof ExecTimeoutError ||
    errorMessage(error).includes("sandbox") ||
    errorMessage(error).includes("microVM") ||
    errorMessage(error).includes("libkrun")
  );
}

function warn(message: string, error?: unknown) {
  if (error === undefined) {
    console.warn(`[opencode-bash-sandbox] ${message}`);
    return;
  }
  console.warn(`[opencode-bash-sandbox] ${message}: ${errorMessage(error)}`);
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

function stringOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return typeof value === "number" ? value : undefined;
}

function booleanOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function stringRecordOption(options: PluginOptions | undefined, key: string) {
  const value = options?.[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseMemoryMiB(value: unknown) {
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

function sandboxName(root: string) {
  const hash = crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
  return `opencode-bash-${hash}`;
}

function configureNetwork(builder: SandboxBuilder, options?: PluginOptions) {
  const allowedHosts = stringArrayOption(options, "allowedHosts") ?? [];
  const allowedInternalHosts = stringArrayOption(options, "allowedInternalHosts") ?? [];
  const blockInternalRanges = booleanOption(options, "blockInternalRanges") ?? true;
  const secretsInput = stringRecordOption(options, "secrets") ?? {};
  const disableNetwork = booleanOption(options, "disableNetwork");
  const allowAllNetwork = booleanOption(options, "allowAllNetwork");
  const maxConnections = numberOption(options, "maxConnections");
  const trustHostCAs = booleanOption(options, "trustHostCAs");
  const nameservers = stringArrayOption(options, "nameservers");
  const dnsQueryTimeoutMs = numberOption(options, "dnsQueryTimeoutMs");
  const tlsBypass = stringArrayOption(options, "tlsBypass") ?? [];
  const tlsInterceptedPorts = options?.tlsInterceptedPorts;
  const tlsVerifyUpstream = booleanOption(options, "tlsVerifyUpstream");
  const tlsBlockQuic = booleanOption(options, "tlsBlockQuic");
  const secretViolationAction = stringOption(options, "secretViolationAction");

  if (disableNetwork === true) {
    return builder.disableNetwork();
  }

  const secretEntries = Object.entries(secretsInput).flatMap(([envVar, raw]) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const secret = raw as SecretInput;
    if (typeof secret.value !== "string") return [];
    return [[envVar, secret] as const];
  });

  if (
    allowAllNetwork !== true &&
    allowedHosts.length === 0 &&
    allowedInternalHosts.length === 0 &&
    secretEntries.length === 0
  ) {
    return builder.network((network) => network.policyJson(JSON.stringify(NetworkPolicy.none())));
  }

  return builder.network((network) => {
    if (allowAllNetwork === true) {
      network.policyJson(JSON.stringify(NetworkPolicy.allowAll()));
    } else {
      const allowedSecretHosts = secretEntries.flatMap(([, secret]) => secret.hosts ?? []);
      const rules = [
        Rule.allowDns(),
        ...allowedHosts.map((host) => Rule.allowEgress(Destination.domain(host))),
        ...allowedInternalHosts.map((host) => Rule.allowEgress(Destination.domain(host))),
        ...allowedSecretHosts.map((host) => Rule.allowEgress(Destination.domain(host))),
      ];

      network.policyJson(
        JSON.stringify({
          defaultEgress: "deny",
          defaultIngress: "deny",
          rules,
        }),
      );
    }

    if (
      nameservers !== undefined ||
      dnsQueryTimeoutMs !== undefined ||
      blockInternalRanges === false ||
      allowedInternalHosts.length > 0
    ) {
      network.dns((dns: DnsConfigBuilder) => {
        if (nameservers !== undefined) dns.nameservers(nameservers);
        if (dnsQueryTimeoutMs !== undefined) dns.queryTimeoutMs(dnsQueryTimeoutMs);
        return dns.rebindProtection(
          blockInternalRanges !== false && allowedInternalHosts.length === 0,
        );
      });
    }

    if (
      tlsBypass.length > 0 ||
      tlsInterceptedPorts !== undefined ||
      tlsVerifyUpstream !== undefined ||
      tlsBlockQuic !== undefined
    ) {
      network.tls((tls: TlsConfigBuilder) => {
        for (const bypass of tlsBypass) tls.bypass(bypass);
        if (
          Array.isArray(tlsInterceptedPorts) &&
          tlsInterceptedPorts.every((port) => typeof port === "number")
        ) {
          tls.interceptedPorts(tlsInterceptedPorts);
        }
        if (tlsVerifyUpstream !== undefined) tls.verifyUpstream(tlsVerifyUpstream);
        if (tlsBlockQuic !== undefined) tls.blockQuic(tlsBlockQuic);
        return tls;
      });
    }

    for (const [envVar, secret] of secretEntries) {
      network.secret((secretBuilder: SecretConfigBuilder) => {
        secretBuilder.env(envVar).value(resolveEnvRef(secret.value));
        if (typeof secret.placeholder === "string") secretBuilder.placeholder(secret.placeholder);
        for (const host of secret.hosts ?? []) secretBuilder.allowHost(host);
        for (const pattern of secret.hostPatterns ?? []) secretBuilder.allowHostPattern(pattern);
        if (secret.allowAnyHostDangerous === true) secretBuilder.allowAnyHostDangerous(true);
        if (secret.requireTlsIdentity !== undefined) {
          secretBuilder.requireTlsIdentity(secret.requireTlsIdentity);
        }
        if (secret.injectHeaders !== undefined) secretBuilder.injectHeaders(secret.injectHeaders);
        if (secret.injectBasicAuth !== undefined) {
          secretBuilder.injectBasicAuth(secret.injectBasicAuth);
        }
        if (secret.injectQuery !== undefined) secretBuilder.injectQuery(secret.injectQuery);
        if (secret.injectBody !== undefined) secretBuilder.injectBody(secret.injectBody);
        return secretBuilder;
      });
    }

    if (secretViolationAction !== undefined) network.onSecretViolation(secretViolationAction);
    if (maxConnections !== undefined) network.maxConnections(maxConnections);
    if (trustHostCAs !== undefined) network.trustHostCAs(trustHostCAs);
    return network;
  });
}

function configurePorts(builder: SandboxBuilder, options?: PluginOptions) {
  const ports = options?.ports;
  if (Array.isArray(ports)) {
    for (const port of ports as PortInput[]) {
      if (typeof port.host === "number" && typeof port.guest === "number") {
        builder.port(port.host, port.guest);
      }
    }
  }

  const udpPorts = options?.udpPorts;
  if (Array.isArray(udpPorts)) {
    for (const port of udpPorts as PortInput[]) {
      if (typeof port.host === "number" && typeof port.guest === "number") {
        builder.portUdp(port.host, port.guest);
      }
    }
  }

  return builder;
}

function configureRlimits(builder: SandboxBuilder, options?: PluginOptions) {
  const rlimits = options?.rlimits;
  if (!Array.isArray(rlimits)) return builder;

  for (const rlimit of rlimits as RlimitInput[]) {
    if (typeof rlimit.resource !== "string") continue;
    if (typeof rlimit.limit === "number") builder.rlimit(rlimit.resource, rlimit.limit);
    if (typeof rlimit.soft === "number" && typeof rlimit.hard === "number") {
      builder.rlimitRange(rlimit.resource, rlimit.soft, rlimit.hard);
    }
  }

  return builder;
}

function configureExtraVolumes(builder: SandboxBuilder, options?: PluginOptions) {
  const volumes = options?.volumes;
  if (!Array.isArray(volumes)) return builder;

  for (const volume of volumes as VolumeInput[]) {
    if (typeof volume.guest !== "string") continue;

    builder.volume(volume.guest, (mount) => {
      if (volume.kind === "named" && typeof volume.source === "string") mount.named(volume.source);
      if (volume.kind === "bind" && typeof volume.source === "string") mount.bind(volume.source);
      if (volume.kind === "disk" && typeof volume.source === "string") mount.disk(volume.source);
      if (volume.kind === "tmpfs") mount.tmpfs();
      if (volume.format !== undefined) mount.format(volume.format);
      if (volume.fstype !== undefined) mount.fstype(volume.fstype);
      if (volume.sizeMiB !== undefined) mount.size(volume.sizeMiB);
      if (volume.readonly === true) mount.readonly();
      return mount;
    });
  }

  return builder;
}

function configurePatches(builder: SandboxBuilder, options?: PluginOptions) {
  const scripts = stringRecordOption(options, "scripts");
  const patchText = stringRecordOption(options, "patchText");

  if (scripts !== undefined) {
    builder.scripts(
      Object.fromEntries(
        Object.entries(scripts).flatMap(([name, content]) =>
          typeof content === "string" ? [[name, content]] : [],
        ),
      ),
    );
  }

  if (patchText !== undefined) {
    builder.patch((patch) => {
      for (const [guestPath, content] of Object.entries(patchText)) {
        if (typeof content === "string") patch.text(guestPath, content, { replace: true });
      }
      return patch;
    });
  }

  return builder;
}

function buildSandbox(root: string, options?: PluginOptions) {
  let builder = Sandbox.builder(sandboxName(root))
    .image(stringOption(options, "image") ?? DEFAULT_IMAGE)
    .replace()
    .workdir(WORKSPACE)
    .volume(WORKSPACE, (mount) => mount.bind(root));

  const memory = parseMemoryMiB(options?.memory);
  const cpus = numberOption(options, "cpus");
  const user = stringOption(options, "user");
  const shell = stringOption(options, "shell");
  const hostname = stringOption(options, "hostname");
  const pullPolicy = stringOption(options, "pullPolicy");
  const logLevel = stringOption(options, "logLevel");
  const metricsSampleIntervalMs = numberOption(options, "metricsSampleIntervalMs");
  const maxDurationSeconds = numberOption(options, "maxDurationSeconds");
  const idleTimeoutSeconds = numberOption(options, "idleTimeoutSeconds");
  const env = stringRecordOption(options, "env");

  if (memory !== undefined) builder = builder.memory(memory);
  if (cpus !== undefined) builder = builder.cpus(cpus);
  if (user !== undefined) builder = builder.user(user);
  if (shell !== undefined) builder = builder.shell(shell);
  if (hostname !== undefined) builder = builder.hostname(hostname);
  if (pullPolicy !== undefined) builder = builder.pullPolicy(pullPolicy);
  if (logLevel !== undefined) builder = builder.logLevel(logLevel);
  if (metricsSampleIntervalMs !== undefined) {
    builder = builder.metricsSampleIntervalMs(metricsSampleIntervalMs);
  }
  if (booleanOption(options, "disableMetrics") === true) builder = builder.disableMetricsSample();
  if (maxDurationSeconds !== undefined) builder = builder.maxDuration(maxDurationSeconds);
  if (idleTimeoutSeconds !== undefined) builder = builder.idleTimeout(idleTimeoutSeconds);
  if (env !== undefined) {
    builder = builder.envs(
      Object.fromEntries(
        Object.entries(env).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, resolveEnvRef(value)]] : [],
        ),
      ),
    );
  }

  builder = configureNetwork(builder, options);
  builder = configurePorts(builder, options);
  builder = configureRlimits(builder, options);
  builder = configureExtraVolumes(builder, options);
  builder = configurePatches(builder, options);

  return builder.create();
}

const MicrosandboxBashPlugin: Plugin = async (input, options) => {
  const prewarm = options?.prewarm !== false;
  const sandboxes = new Map<string, SandboxRecord>();

  async function discardSandbox(root: string, record?: SandboxRecord) {
    if (record !== undefined && sandboxes.get(root) !== record) return;
    sandboxes.delete(root);

    if (record?.sandbox !== undefined) {
      await record.sandbox.stop().catch((error) => {
        warn(`failed to stop sandbox for ${root}`, error);
      });
      return;
    }

    if (record !== undefined) {
      await record.promise.then((entry) => entry.sandbox.stop()).catch(() => {});
    }
  }

  function getSandbox(directory: string) {
    const root = path.resolve(directory);
    let record = sandboxes.get(root);
    if (!record) {
      record = {
        promise: buildSandbox(root, options).then((sandbox) => {
          record!.sandbox = sandbox;
          return { sandbox, directory: root, workspace: WORKSPACE };
        }),
      };
      record.promise.catch((error) => {
        warn(`sandbox startup failed for ${root}`, error);
        void discardSandbox(root, record);
      });
      sandboxes.set(root, record);
    }
    return record.promise;
  }

  async function closeAll() {
    const records = Array.from(sandboxes.values());
    sandboxes.clear();
    const entries = await Promise.allSettled(records.map((record) => record.promise));
    await Promise.allSettled(
      entries.flatMap((entry) =>
        entry.status === "fulfilled" ? [entry.value.sandbox.stop()] : [],
      ),
    );
  }

  process.once("beforeExit", () => {
    void closeAll();
  });

  if (prewarm) {
    void getSandbox(input.directory).catch(() => {});
  }

  return {
    tool: {
      // Same public tool id and same argument interface as OpenCode's built-in bash tool.
      bash: tool({
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
          const entry = await getSandbox(root);
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
              await discardSandbox(root, sandboxes.get(root));
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
      }),
    },
  };
};

export default MicrosandboxBashPlugin;
