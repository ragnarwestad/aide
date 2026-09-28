// A scheduled job's own commits are landed the way create/archive's are
// (spec 558): `stepDoneHandler` calls `landScheduleRun` once the run
// ended `completed` and pushed a branch, and does nothing when it did
// not — the same `if (outcome.ok)` wrapper every other step's own
// landing dispatch already sits inside.

import { describe, expect, test } from "bun:test";
import type { Job } from "../../../src/queue/queue.ts";
import { stepDoneHandler } from "../../../src/serve/runner-setup.ts";

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "run-1",
    project: "aide",
    specFolder: "schedule-nightly",
    steps: ["schedule"],
    stepIndex: 0,
    state: "running",
    createdAt: "2026-09-28T03:00:00Z",
    results: [],
    spentUsd: 0,
    ...over,
  }) as Job;

let landed: { job: Job; outcome: unknown }[];

const handler = () =>
  stepDoneHandler({
    store: { list: () => [] },
    scheduleOutputRoot: "/tmp/aide-schedule-dispatch-test-does-not-exist",
    machinerySpecsRoot: () => undefined,
    specDir: () => undefined,
    peekMachinerySpecDir: (_p: string, d: string) => d,
    machineryProjectDir: () => "/repos/aide-code",
    forgetSpecCaches: () => {},
    rereadSpecCaches: () => {},
    landScheduleRun: (j: Job, outcome: unknown) => {
      landed.push({ job: j, outcome });
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof stepDoneHandler>[0]);

describe("a scheduled job's own commits are landed", () => {
  test("a completed run that pushed to the specs root is landed (AC-1)", () => {
    landed = [];
    const outcome = { ok: true, terminalReason: "completed", branchUrls: [{ root: "/repos/aide-specs", url: "" }] };
    handler()(job(), "schedule", outcome);
    expect(landed.length).toBe(1);
    expect(landed[0]!.outcome).toBe(outcome);
  });

  test("a completed run that pushed to the project repository is landed (AC-2)", () => {
    landed = [];
    const outcome = { ok: true, terminalReason: "completed", branchUrls: [{ root: "/repos/aide-code", url: "" }] };
    handler()(job(), "schedule", outcome);
    expect(landed.length).toBe(1);
  });

  test("a completed run that pushed nothing is not landed — report only, as today (AC-5)", () => {
    landed = [];
    const outcome = { ok: true, terminalReason: "completed", branchUrls: [] };
    expect(handler()(job(), "schedule", outcome)).toBeUndefined();
    expect(landed.length).toBe(0);
  });

  test("a completed run with no branchUrls field at all is not landed (AC-5)", () => {
    landed = [];
    expect(handler()(job(), "schedule", { ok: true, terminalReason: "completed" })).toBeUndefined();
    expect(landed.length).toBe(0);
  });
});
