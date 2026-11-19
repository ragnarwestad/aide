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
  const KINDS = [
    { steps: ["schedule"], specFolder: "schedule-nightly" },
    { steps: ["close"], specFolder: "81-example" },
    { steps: ["reopen"], specFolder: "81-example" },
    { steps: ["deploy"], specFolder: "deploy" },
    { steps: ["land"], specFolder: "land", branch: "topic" },
  ];

  test("a failed job of every kind without a Start of its own is dismissible, once", () => {
    for (const kind of KINDS) {
      expect(jobDismissible(job({ ...kind, state: "failed" })), kind.steps[0]).toBe(true);
      expect(jobDismissible(job({ ...kind, state: "failed", dismissedAt: "2026-11-19T20:00:00Z" })), kind.steps[0]).toBe(false);
    }
  });

  test("a job that has not failed is not dismissible, a usage-limit wait included", () => {
    for (const kind of KINDS) {
      for (const state of ["queued", "running", "done", "cancelled", "waiting"] as const) {
        expect(jobDismissible(job({ ...kind, state })), `${kind.steps[0]} ${state}`).toBe(false);
      }
    }
  });

  test("a failed spec step is not dismissible: its spec row offers the step again", () => {
    expect(jobDismissible(job({ state: "failed" }))).toBe(false);
  });
});
