import crypto from "node:crypto";
import type { PluginOptions } from "@opencode-ai/plugin";
import { Sandbox } from "microsandbox";
import { DEFAULT_IMAGE, WORKSPACE } from "./constants.js";
import { resolveEnvRef } from "./env.js";
import { configureNetwork } from "./network.js";
import {
  booleanOption,
  numberOption,
  parseMemoryMiB,
  stringOption,
  stringRecordOption,
} from "./options.js";
import {
  configureExtraVolumes,
  configurePatches,
  configurePorts,
  configureRlimits,
} from "./sandbox-config.js";

function sandboxName(root: string) {
  const hash = crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
  return `opencode-bash-${hash}`;
}

export function buildSandbox(root: string, options?: PluginOptions) {
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
