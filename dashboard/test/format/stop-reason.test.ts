// Which stop reasons leave a step to run again.

import { describe, expect, test } from "bun:test";
import { leavesStepUndone } from "../../src/format/stop-reason.ts";

describe("leavesStepUndone", () => {
  test("an analyze stopped on its acceptance criteria or on shared files leaves its step undone", () => {
    expect(leavesStepUndone("acceptance-criteria")).toBe(true);
    expect(leavesStepUndone("shared-files")).toBe(true);
  });

  test("a model at capacity and an implement sent back leave their step undone", () => {
    expect(leavesStepUndone("model-at-capacity")).toBe(true);
    expect(leavesStepUndone("sent-back")).toBe(true);
    expect(leavesStepUndone("sent-back-refused")).toBe(true);
    expect(leavesStepUndone("short-analysis-over-limit")).toBe(true);
  });

  test("the clock and no reason do not", () => {
    expect(leavesStepUndone("timeout")).toBe(false);
    expect(leavesStepUndone(undefined)).toBe(false);
  });
});
