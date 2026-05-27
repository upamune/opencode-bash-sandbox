import path from "node:path";
import { describe, expect, test } from "bun:test";
import { WORKSPACE } from "../plugin/constants.ts";
import { toGuestPath } from "../plugin/path.ts";

describe("toGuestPath", () => {
  const directory = path.resolve("/tmp/project");

  test("maps the project root to the guest workspace", () => {
    expect(toGuestPath(directory, directory, WORKSPACE)).toBe(WORKSPACE);
  });

  test("maps paths inside the project to workspace-relative guest paths", () => {
    expect(toGuestPath(path.join(directory, "src/index.ts"), directory, WORKSPACE)).toBe(
      "/workspace/src/index.ts",
    );
  });

  test("preserves paths already inside the guest workspace", () => {
    expect(toGuestPath("/workspace/src/index.ts", directory, WORKSPACE)).toBe(
      "/workspace/src/index.ts",
    );
  });

  test("refuses paths outside the mounted workspace", () => {
    expect(toGuestPath(path.resolve("/tmp/other"), directory, WORKSPACE)).toBeUndefined();
  });

  test("normalizes relative paths before mapping", () => {
    expect(toGuestPath("src/../README.md", directory, WORKSPACE)).toBe("/workspace/README.md");
  });
});
