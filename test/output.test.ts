import { describe, expect, test } from "bun:test";
import { outputPreview } from "../plugin/output.ts";

describe("outputPreview", () => {
  test("returns short output unchanged", () => {
    expect(outputPreview("hello")).toBe("hello");
  });

  test("keeps the final 30000 characters for long output", () => {
    const value = `${"a".repeat(10)}${"b".repeat(30_000)}`;

    expect(outputPreview(value)).toBe(`...\n\n${"b".repeat(30_000)}`);
  });
});
