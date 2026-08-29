// Acceptance criterion 13: every past run renders newest first, and
// only the newest row carries an output link.
import { describe, expect, test } from "bun:test";
import { renderScheduleHistory } from "../../../../src/render/pages/schedule-page/history.ts";
import type { Job } from "../../../../src/queue/types.ts";

function job(overrides: Partial<Job>): Job {
  return {
    id: "j1", project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], stepIndex: 0,
    state: "done", budgetUsd: 1, jobCapUsd: 1, timeoutSec: {}, permissionMode: {}, model: {},
    createdAt: "2026-08-01T03:00:00Z",
    ...overrides,
  } as Job;
}

describe("renderScheduleHistory (acceptance criterion 13)", () => {
  test("no runs yet shows a plain message", () => {
    const html = renderScheduleHistory([]);
    expect(html.toLowerCase()).toContain("has not run yet");
  });

  test("three runs all render, and only the newest carries an output link", () => {
    const rows = [
      { job: job({ id: "j3", createdAt: "2026-08-03T03:00:00Z", state: "done" }), outputHref: "/schedule-output/aide/schedule-nightly/index.html" },
      { job: job({ id: "j2", createdAt: "2026-08-02T03:00:00Z", state: "failed" }), outputHref: undefined },
      { job: job({ id: "j1", createdAt: "2026-08-01T03:00:00Z", state: "done" }), outputHref: undefined },
    ];
    const html = renderScheduleHistory(rows);
    expect(html).toContain("2026-08-03T03:00:00Z");
    expect(html).toContain("2026-08-02T03:00:00Z");
    expect(html).toContain("2026-08-01T03:00:00Z");
    expect(html.match(/href="\/schedule-output/g)?.length).toBe(1);
  });
});
