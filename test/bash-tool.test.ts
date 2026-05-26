import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createBashTool } from "../plugin/bash-tool.ts";

type ExecState = {
  args?: string[];
  cwd?: string;
  timeout?: number;
};

function createContext(directory: string) {
  const asks: unknown[] = [];
  const metadata: unknown[] = [];

  return {
    asks,
    metadata,
    ctx: {
      directory,
      ask: async (input: unknown) => {
        asks.push(input);
      },
      metadata: async (input: unknown) => {
        metadata.push(input);
      },
    },
  };
}

function createSandbox(output: { stdout?: string; stderr?: string; code?: number }, state: ExecState) {
  return {
    execWith: async (shell: string, configure: (exec: unknown) => unknown) => {
      expect(shell).toBe("/bin/sh");
      const exec = {
        args: (args: string[]) => {
          state.args = args;
          return exec;
        },
        cwd: (cwd: string) => {
          state.cwd = cwd;
          return exec;
        },
        timeout: (timeout: number) => {
          state.timeout = timeout;
          return exec;
        },
      };
      configure(exec);
      return {
        stdout: () => output.stdout ?? "",
        stderr: () => output.stderr ?? "",
        code: output.code ?? 0,
      };
    },
    stop: async () => {},
  };
}

describe("createBashTool", () => {
  test("executes commands in the mapped workspace directory", async () => {
    const directory = path.resolve("/tmp/project");
    const state: ExecState = {};
    const sandboxes = {
      closeAll: async () => {},
      discardSandbox: async () => {},
      getSandbox: async () => ({
        sandbox: createSandbox({ stdout: "ok", code: 0 }, state),
        directory,
        workspace: "/workspace",
      }),
    };
    const { ctx, metadata } = createContext(directory);
    const bash = createBashTool(sandboxes);

    const result = await bash.execute(
      { command: "echo ok", description: "Runs echo", workdir: "src" },
      ctx,
    );

    expect(result.output).toBe("ok");
    expect(result.metadata).toEqual({
      output: "ok",
      description: "Runs echo",
      exit: 0,
      truncated: false,
    });
    expect(state.args).toEqual(["-lc", "echo ok"]);
    expect(state.cwd).toBe("/workspace/src");
    expect(state.timeout).toBe(120_000);
    expect(metadata).toHaveLength(2);
  });

  test("does not set an execution timeout when timeout is zero", async () => {
    const directory = path.resolve("/tmp/project");
    const state: ExecState = {};
    const sandboxes = {
      closeAll: async () => {},
      discardSandbox: async () => {},
      getSandbox: async () => ({
        sandbox: createSandbox({ stdout: "ok" }, state),
        directory,
        workspace: "/workspace",
      }),
    };
    const { ctx } = createContext(directory);
    const bash = createBashTool(sandboxes);

    await bash.execute({ command: "sleep 1", description: "Sleeps", timeout: 0 }, ctx);

    expect(state.timeout).toBeUndefined();
  });

  test("wraps stderr after stdout", async () => {
    const directory = path.resolve("/tmp/project");
    const state: ExecState = {};
    const sandboxes = {
      closeAll: async () => {},
      discardSandbox: async () => {},
      getSandbox: async () => ({
        sandbox: createSandbox({ stdout: "out", stderr: "err", code: 2 }, state),
        directory,
        workspace: "/workspace",
      }),
    };
    const { ctx } = createContext(directory);
    const bash = createBashTool(sandboxes);

    const result = await bash.execute({ command: "bad", description: "Runs bad command" }, ctx);

    expect(result.output).toBe("out\n<stderr>\nerr</stderr>");
    expect(result.metadata.exit).toBe(2);
  });

  test("refuses workdirs outside the mounted workspace", async () => {
    const directory = path.resolve("/tmp/project");
    const sandboxes = {
      closeAll: async () => {},
      discardSandbox: async () => {},
      getSandbox: async () => ({
        sandbox: createSandbox({ stdout: "unused" }, {}),
        directory,
        workspace: "/workspace",
      }),
    };
    const { ctx, asks } = createContext(directory);
    const bash = createBashTool(sandboxes);

    const result = await bash.execute(
      { command: "pwd", description: "Prints directory", workdir: "../outside" },
      ctx,
    );

    expect(result.metadata.exit).toBe(1);
    expect(result.output).toContain("refused workdir outside the mounted workspace");
    expect(asks).toHaveLength(1);
  });

  test("rejects negative timeouts before starting a sandbox", async () => {
    let requestedSandbox = false;
    const sandboxes = {
      closeAll: async () => {},
      discardSandbox: async () => {},
      getSandbox: async () => {
        requestedSandbox = true;
        throw new Error("unexpected");
      },
    };
    const { ctx } = createContext(path.resolve("/tmp/project"));
    const bash = createBashTool(sandboxes);

    await expect(
      bash.execute({ command: "pwd", description: "Prints directory", timeout: -1 }, ctx),
    ).rejects.toThrow("Timeout must be a positive number");
    expect(requestedSandbox).toBe(false);
  });

  test("discards sandbox records on sandbox failures", async () => {
    const directory = path.resolve("/tmp/project");
    let discardedRoot: string | undefined;
    const sandboxes = {
      closeAll: async () => {},
      discardSandbox: async (root: string) => {
        discardedRoot = root;
      },
      getSandbox: async () => ({
        sandbox: {
          execWith: async () => {
            throw new Error("microVM failed");
          },
          stop: async () => {},
        },
        directory,
        workspace: "/workspace",
      }),
    };
    const { ctx } = createContext(directory);
    const bash = createBashTool(sandboxes);

    await expect(bash.execute({ command: "pwd", description: "Prints directory" }, ctx)).rejects.toThrow(
      "microVM failed",
    );
    expect(discardedRoot).toBe(directory);
  });
});
