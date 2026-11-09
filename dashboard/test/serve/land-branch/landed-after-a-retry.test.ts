// A landing whose suite was red once and green on its one retry lands,
// and says so: the job keeps the lines the first run failed on, and the
// archived row reads "landed after a retry" — a test worth looking at
// before it goes red twice.

import { describe, expect, test } from "bun:test";
import { handedToMerge } from "../../../src/serve/land-branch/handed-to-merge.ts";
import type { LandContext } from "../../../src/serve/land-branch";
import type { Job } from "../../../src/queue/queue.ts";
import { archivedRowNotices } from "../../../src/render/pages/specs-list/row-marks.ts";
import type { ArchivedSpecView } from "../../../src/render";
import type { GateVerdict } from "../../../src/serve/land-branch/test-gate.ts";

const job = { id: "j1", project: "aide", specFolder: "81-x" } as Job;

function gateWith(verdict: Partial<GateVerdict>, listed: Job[] = [], step: "archive" | "schedule" = "archive") {
  const updates: Array<Partial<Job>> = [];
  const ctx = {
    landingGate: async () => verdict,
    queue: { update: (_id: string, patch: Partial<Job>) => updates.push(patch), list: () => listed },
    machinerySpecsRoot: () => undefined,
  } as unknown as LandContext;
  const { gate } = handedToMerge(ctx, job, { step }, "/repo", "aide/81-x", new Set(["/repo"]));
  return { gate: gate!, updates };
}

describe("a landing green only on its retry", () => {
  test("keeps the first run's failing lines on the job", async () => {
    const { gate, updates } = gateWith({ ok: true, retriedAfter: "(fail) flaky" });
    expect((await gate("/work")).ok).toBe(true);
    expect(updates).toEqual([{ testsGreenOnRetry: "(fail) flaky" }]);
  });

  test("a landing green the first time records nothing", async () => {
    const { gate, updates } = gateWith({ ok: true });
    await gate("/work");
    expect(updates).toEqual([]);
  });

  const archived = (extra: Partial<ArchivedSpecView>) =>
    ({ project: "aide", folder: "81-x", archivedAt: "2026-09-18", ...extra }) as ArchivedSpecView;

  test("the archived row says it landed after a retry", () => {
    expect(archivedRowNotices(archived({ testsGreenOnRetry: "(fail) flaky" }), Date.now(), "en")).toEqual([
      { variant: "info", text: "Merged after a retry: the project's tests were red on the first run and green on the second." },
    ]);
  });

  test("a branch left behind outranks it: one message per row", () => {
    const notices = archivedRowNotices(
      archived({ testsGreenOnRetry: "(fail) flaky", notLanded: true, branchDeleteError: "rejected" }),
      Date.now(),
      "en",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.variant).toBe("failed");
  });
});

describe("the tests a red landing failed", () => {
  const failedTests = [{ name: "t/a.test.ts > adds", file: "t/a.test.ts", error: "expected 2" }];
  const error = { key: "landing.testsRedOnMerge", values: { count: 1, branch: "aide/81-x", button: "Archive" } } as const;

  test("an archive landing keeps them on the job beside its unchanged sentence (AC-1)", async () => {
    const { gate, updates } = gateWith({ ok: false, error, failedTests });
    expect((await gate("/work")).error).toEqual(error);
    expect(updates).toEqual([{ landingFailedTests: failedTests }]);
  });

  test("a green archive landing takes the spec's list off (AC-6)", async () => {
    const { gate, updates } = gateWith({ ok: true }, [{ ...job, landingFailedTests: failedTests }]);
    await gate("/work");
    expect(updates).toEqual([{ landingFailedTests: undefined }]);
  });

  test("a red schedule landing changes no list (AC-7)", async () => {
    const { gate, updates } = gateWith({ ok: false, error, failedTests }, [{ ...job, landingFailedTests: failedTests }], "schedule");
    await gate("/work");
    expect(updates).toEqual([]);
  });
});
