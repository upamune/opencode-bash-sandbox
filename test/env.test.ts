import { describe, expect, test } from "bun:test";
import { resolveEnvRef } from "../plugin/env.ts";

describe("resolveEnvRef", () => {
  test("substitutes environment references", () => {
    process.env.OPENCODE_BASH_SANDBOX_TEST_SECRET = "secret-value";

    expect(resolveEnvRef("token={env:OPENCODE_BASH_SANDBOX_TEST_SECRET}")).toBe(
      "token=secret-value",
    );
  });

  test("substitutes missing environment references with an empty string", () => {
    delete process.env.OPENCODE_BASH_SANDBOX_TEST_MISSING;

    expect(resolveEnvRef("token={env:OPENCODE_BASH_SANDBOX_TEST_MISSING}")).toBe("token=");
  });
});
