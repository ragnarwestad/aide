// A landing whose suite was red once and green on its one retry lands,
// and says so: the job keeps the lines the first run failed on, and the
// archived row reads "landed after a retry" — a test worth looking at
// before it goes red twice.

import { describe, expect, test } from "bun:test";
import { handedToMerge } from "../../../src/serve/land-branch/handed-to-merge.ts";
import type { LandContext } from "../../../src/serve/land-branch/types.ts";
import type { Job } from "../../../src/queue/queue.ts";
import { archivedRowNotices } from "../../../src/render/pages/specs-list/row-marks.ts";
import type { ArchivedSpecView } from "../../../src/render";

const job = { id: "j1", project: "aide", specFolder: "81-x" } as Job;

function gateWith(verdict: { ok: boolean; retriedAfter?: string }) {
  const updates: Array<Partial<Job>> = [];
  const ctx = {
    landingGate: async () => verdict,
    queue: { update: (_id: string, patch: Partial<Job>) => updates.push(patch) },
    machinerySpecsRoot: () => undefined,
  } as unknown as LandContext;
  const { gate } = handedToMerge(ctx, job, { step: "archive" }, "/repo", "aide/81-x", new Set(["/repo"]));
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
