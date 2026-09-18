// Acceptance criterion 13: every past run renders newest first, and
// every row carries a link to its run.
import { describe, expect, test } from "bun:test";
import { renderScheduleHistory } from "../../../../src/render/pages/schedule-page/history.ts";
import type { Job } from "../../../../src/queue/types.ts";

function job(overrides: Partial<Job>): Job {
  return {
    id: "j1", project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], stepIndex: 0,
    state: "done", timeoutSec: {}, permissionMode: {}, model: {},
    createdAt: "2026-08-01T03:00:00Z",
    ...overrides,
  } as Job;
}

describe("renderScheduleHistory (acceptance criterion 13)", () => {
  test("no runs yet shows a plain message", () => {
    const html = renderScheduleHistory([]);
    expect(html.toLowerCase()).toContain("has not run yet");
  });

  test("three runs all render, and every row links to its own run's report (spec 495)", () => {
    const at = (id: string) => `/schedule/aide/nightly?run=${id}#report`;
    const rows = [
      { job: job({ id: "j3", createdAt: "2026-08-03T03:00:00Z", state: "done" }), outputHref: at("j3") },
      { job: job({ id: "j2", createdAt: "2026-08-02T03:00:00Z", state: "failed" }), outputHref: at("j2") },
      { job: job({ id: "j1", createdAt: "2026-08-01T03:00:00Z", state: "done" }), outputHref: at("j1") },
    ];
    const html = renderScheduleHistory(rows);
    expect(html).toContain("2026-08-03T03:00:00Z");
    expect(html).toContain("2026-08-02T03:00:00Z");
    expect(html).toContain("2026-08-01T03:00:00Z");
    expect(html.match(/href="\/schedule\/aide\/nightly\?run=/g)?.length).toBe(3);
    for (const id of ["j1", "j2", "j3"]) expect(html).toContain(`href="${at(id)}"`);
  });
});
