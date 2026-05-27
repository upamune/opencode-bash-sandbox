import path from "node:path";
import type { PluginOptions } from "@opencode-ai/plugin";
import type { Sandbox } from "microsandbox";
import { WORKSPACE } from "./constants.js";
import { warn } from "./errors.js";
import { buildSandbox } from "./sandbox.js";

type SandboxEntry = {
  sandbox: Sandbox;
  directory: string;
  workspace: string;
};

type SandboxRecord = {
  promise: Promise<SandboxEntry>;
  sandbox?: Sandbox;
};

type SandboxFactory = (root: string, options?: PluginOptions) => Promise<Sandbox>;

export function createSandboxPool(
  options?: PluginOptions,
  sandboxFactory: SandboxFactory = buildSandbox,
) {
  const sandboxes = new Map<string, SandboxRecord>();

  async function discardSandbox(root: string, record?: SandboxRecord) {
    record ??= sandboxes.get(root);
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
        promise: sandboxFactory(root, options).then((sandbox) => {
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

  return {
    closeAll,
    discardSandbox,
    getSandbox,
  };
}
