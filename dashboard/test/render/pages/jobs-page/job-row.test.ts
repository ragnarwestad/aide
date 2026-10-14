// A Close's, Reopen's or deploy's step unfolds to its own part of the job's
// Log, as a spec's phase does, and only a step the log has marked offers it.

import { describe, expect, test } from "bun:test";
import { jobRow, type JobStep } from "../../../../src/render/pages/jobs-page/job-row.ts";
import type { QueueRowView } from "../../../../src/render";

const close = {
  id: "c1", project: "aide", specFolder: "01-x", steps: ["close"], stepIndex: 0, state: "failed",
  spentUsd: 0, timeoutSec: 600, createdAt: "2026-10-14T19:48:00Z",
} as QueueRowView;
const STEPS: JobStep[] = [
  { key: "Step Aide: preparing", label: "Preparing", state: "done", logs: [{ by: "aide-before", lines: ["pulled main"] }] },
  { key: "Step 1 of 4", label: "Move the spec", state: undefined },
];
const draw = (phases?: string) =>
  jobRow(close, {
    lang: "en", now: Date.parse("2026-10-14T20:00:00Z"), listPath: "/",
    filter: { open: "aide/01-x:close", ...(phases ? { phases } : {}) },
    steps: () => STEPS,
  });

describe("a job step's own log", () => {
  test("a marked step offers to unfold its log, and a waiting one does not", () => {
    const html = draw();
    expect(html).toContain(`phases=${encodeURIComponent("aide/01-x:close.0")}`);
    expect(html).not.toContain(encodeURIComponent("aide/01-x:close.1"));
  });

  test("unfolded, the step shows its part of the log; shut, it does not", () => {
    expect(draw("aide/01-x:close.0")).toContain("pulled main");
    expect(draw()).not.toContain("pulled main");
  });
});
