// A spec being closed or reopened is on the Running tab once: the Close or
// Reopen row stands for it while the job is in flight.

import { describe, expect, test } from "bun:test";
import type { QueueRowView } from "../../../../src/render";
import { renderJobsSpecRows, type JobsView } from "../../../../src/render/pages/jobs-page";

const SPEC = "670-verify";
const at = (o: Partial<QueueRowView>): QueueRowView => ({
  id: "j", project: "aide", specFolder: SPEC, steps: ["implement"], stepIndex: 0, state: "failed",
  spentUsd: 0, timeoutSec: 600, createdAt: "2026-10-23T05:00:00Z", results: [], ...o,
}) as QueueRowView;

const failedImplement = at({ id: "impl" });
const view = (shown: QueueRowView[]): JobsView => ({
  shown,
  specJobs: [failedImplement],
  list: { runnerAvailable: true, targets: [{ project: "aide", specFolder: SPEC }], createProjects: ["aide"] },
  now: Date.parse("2026-10-23T06:00:00Z"),
});
const specRow = (v: JobsView): string => renderJobsSpecRows(v, `aide/${SPEC}`).replace(/<\/?t(able|body)>/g, "");

describe("a spec being closed is on the Running tab once", () => {
  test("its own row is drawn while nothing moves it, and not while its Close runs", () => {
    expect(specRow(view([]))).not.toBe("");
    expect(specRow(view([at({ id: "c", steps: ["close"], state: "running", createdAt: "2026-10-23T05:30:00Z" })]))).toBe("");
  });
});
