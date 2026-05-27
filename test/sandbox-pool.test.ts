import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createSandboxPool } from "../plugin/sandbox-pool.ts";

function createSandbox(id: string, stopped: string[]) {
  return {
    id,
    stop: async () => {
      stopped.push(id);
    },
  };
}

describe("createSandboxPool", () => {
  test("caches one sandbox per resolved root", async () => {
    const stopped: string[] = [];
    const createdRoots: string[] = [];
    const pool = createSandboxPool(undefined, async (root) => {
      createdRoots.push(root);
      return createSandbox(root, stopped);
    });

    const first = await pool.getSandbox("/tmp/project");
    const second = await pool.getSandbox("/tmp/project/.");

    expect(first).toBe(second);
    expect(createdRoots).toEqual([path.resolve("/tmp/project")]);
    expect(stopped).toEqual([]);
  });

  test("closeAll stops fulfilled sandboxes and clears the cache", async () => {
    const stopped: string[] = [];
    let count = 0;
    const pool = createSandboxPool(undefined, async (root) => createSandbox(`${root}-${count++}`, stopped));

    await pool.getSandbox("/tmp/project");
    await pool.closeAll();
    await pool.getSandbox("/tmp/project");

    expect(stopped).toEqual([`${path.resolve("/tmp/project")}-0`]);
    expect(count).toBe(2);
  });

  test("discardSandbox removes and stops the current sandbox", async () => {
    const stopped: string[] = [];
    let count = 0;
    const pool = createSandboxPool(undefined, async (root) => createSandbox(`${root}-${count++}`, stopped));

    await pool.getSandbox("/tmp/project");
    await pool.discardSandbox(path.resolve("/tmp/project"));
    await pool.getSandbox("/tmp/project");

    expect(stopped).toEqual([`${path.resolve("/tmp/project")}-0`]);
    expect(count).toBe(2);
  });
});
