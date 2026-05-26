import { describe, expect, test } from "bun:test";
import {
  booleanOption,
  numberOption,
  parseMemoryMiB,
  stringArrayOption,
  stringOption,
  stringRecordOption,
} from "../plugin/options.ts";

describe("option readers", () => {
  const options = {
    text: "value",
    number: 4,
    bool: false,
    strings: ["a", "b"],
    mixed: ["a", 1],
    record: { key: "value" },
    array: [],
  };

  test("returns typed option values", () => {
    expect(stringOption(options, "text")).toBe("value");
    expect(numberOption(options, "number")).toBe(4);
    expect(booleanOption(options, "bool")).toBe(false);
    expect(stringArrayOption(options, "strings")).toEqual(["a", "b"]);
    expect(stringRecordOption(options, "record")).toEqual({ key: "value" });
  });

  test("ignores values with the wrong shape", () => {
    expect(stringOption(options, "number")).toBeUndefined();
    expect(numberOption(options, "text")).toBeUndefined();
    expect(booleanOption(options, "text")).toBeUndefined();
    expect(stringArrayOption(options, "mixed")).toBeUndefined();
    expect(stringRecordOption(options, "array")).toBeUndefined();
    expect(stringRecordOption({ nullValue: null }, "nullValue")).toBeUndefined();
  });
});

describe("parseMemoryMiB", () => {
  test("returns numeric memory values unchanged", () => {
    expect(parseMemoryMiB(512)).toBe(512);
  });

  test("parses string units into MiB", () => {
    expect(parseMemoryMiB("512M")).toBe(512);
    expect(parseMemoryMiB("1.5G")).toBe(1536);
    expect(parseMemoryMiB("1024K")).toBe(1);
    expect(parseMemoryMiB("2T")).toBe(2 * 1024 * 1024);
  });

  test("rejects invalid or non-positive values", () => {
    expect(parseMemoryMiB("")).toBeUndefined();
    expect(parseMemoryMiB("0")).toBeUndefined();
    expect(parseMemoryMiB("-1G")).toBeUndefined();
    expect(parseMemoryMiB("large")).toBeUndefined();
    expect(parseMemoryMiB(true)).toBeUndefined();
  });
});
