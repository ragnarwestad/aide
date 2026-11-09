import { describe, expect, test } from "bun:test";
import { inFlight, jobActivity, jobDismissible, jobKind, writing } from "../../src/queue/queue.ts";

const job = (overrides: Record<string, unknown> = {}) => ({
  steps: ["analyze"], stepIndex: 0, specFolder: "746-a-spec", state: "queued", results: [], ...overrides,
});

test("one function identifies every job kind (AC-1)", () => {
  expect(jobKind(job())).toBe("spec");
  expect(jobKind(job({ steps: ["schedule"], specFolder: "schedule-nightly" }))).toBe("schedule");
  expect(jobKind(job({ steps: ["deploy"], specFolder: "deploy" }))).toBe("deploy");
  expect(jobKind(job({ steps: ["cleanup"], specFolder: "cleanup" }))).toBe("cleanup");
  expect(jobKind(job({ steps: ["close"] }))).toBe("close");
  expect(jobKind(job({ steps: ["reopen"] }))).toBe("reopen");
  expect(jobKind(job({ steps: ["reopen", "analyze"], stepIndex: 1 }))).toBe("spec");
  expect(jobKind(job({ steps: ["schedule"] }))).toBe("spec");
});

test("one function decides job activity and both questions read it (AC-2)", () => {
  const cases = [
    [job({ state: "queued" }), "queued", true, false],
    [job({ state: "running" }), "running", true, true],
    [job({ state: "done", landing: true }), "landing", true, true],
    [job({ state: "queued", landing: true }), "landing", true, true],
    [job({ state: "done" }), "idle", false, false],
    [job({ state: "failed" }), "idle", false, false],
  ] as const;
  for (const [value, activity, moving, changing] of cases) {
    expect(jobActivity(value)).toBe(activity);
    expect(inFlight(value)).toBe(moving);
    expect(writing(value)).toBe(changing);
  }
});

describe("dismissible jobs use the queue rule", () => {
  test("only a scheduled job waiting for a person is dismissible", () => {
    for (const state of ["failed", "stopped", "interrupted"]) {
      expect(jobDismissible(job({ steps: ["schedule"], specFolder: "schedule-nightly", state }))).toBe(true);
    }
    for (const state of ["queued", "running", "done", "cancelled"]) {
      expect(jobDismissible(job({ steps: ["schedule"], specFolder: "schedule-nightly", state }))).toBe(false);
    }
    expect(jobDismissible(job({ state: "failed" }))).toBe(false);
  });
});
