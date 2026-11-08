// The lines a red landing names are the failures, each once.

import { describe, expect, test } from "bun:test";
import { failingLines } from "../../../../src/serve/land-branch/test-gate.ts";

describe("failingLines", () => {
  test("a failing test the output names twice is named once", () => {
    const stdout = "(fail) a > b [5ms]\n--- worker 0, in full:\n(pass) a > c\n(fail) a > b [5ms]\n 1 fail\n";
    expect(failingLines(stdout, "")).toBe("(fail) a > b [5ms]\n 1 fail");
  });
});
