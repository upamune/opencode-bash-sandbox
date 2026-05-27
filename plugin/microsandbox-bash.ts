import type { Plugin } from "@opencode-ai/plugin";
import { createBashTool } from "./bash-tool.js";
import { createSandboxPool } from "./sandbox-pool.js";

const MicrosandboxBashPlugin: Plugin = async (input, options) => {
  const prewarm = options?.prewarm !== false;
  const sandboxes = createSandboxPool(options);

  process.once("beforeExit", () => {
    void sandboxes.closeAll();
  });

  if (prewarm) {
    void sandboxes.getSandbox(input.directory).catch(() => {});
  }

  return {
    tool: {
      // Same public tool id and same argument interface as OpenCode's built-in bash tool.
      bash: createBashTool(sandboxes),
    },
  };
};

export default MicrosandboxBashPlugin;
