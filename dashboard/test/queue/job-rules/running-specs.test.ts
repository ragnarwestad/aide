import { expect, test } from "bun:test";
import { specActivityCounts } from "../../../src/queue/job-rules/running-specs.ts";
import type { Job } from "../../../src/queue/types.ts";
const job = (id: string, overrides: Partial<Job> = {}): Job => ({
  id, project: "aide", specFolder: "821-recover", state: "running", steps: ["implement"], stepIndex: 0, ...overrides,
} as Job);
const served = (project: string) => project === "aide";

test("counts all running and queued job kinds, independent of the spec folder", () => {
  expect(specActivityCounts([
    job("implement"), job("land", { steps: ["land"] }), job("deploy", { steps: ["deploy"] }),
    job("schedule", { steps: ["schedule"] }), job("cleanup", { steps: ["cleanup"] }),
    job("queued", { state: "queued" }), job("queued-land", { steps: ["land"], state: "queued" }),
  ], served)).toEqual({ running: 5, queued: 2 });
});

test("a shared archive is one running job, and duplicate records count once", () => {
  const archive = job("archive", { state: "done", landing: true, steps: ["archive"], groupMembers: ["one", "two", "three"] });
  expect(specActivityCounts([archive, archive], served)).toEqual({ running: 1, queued: 0 });
});

test("settled jobs and projects outside the board do not count", () => {
  expect(specActivityCounts([
    job("hidden", { project: "hidden" }), job("done", { state: "done" }),
    job("failed", { state: "failed" }), job("cancelled", { state: "cancelled", landing: true }),
    job("stopped", { state: "stopped" }),
  ], served)).toEqual({ running: 0, queued: 0 });
});

test("a running job held back from doing work counts as waiting", () => {
  expect(specActivityCounts([job("deploy", { steps: ["deploy"], errorReason: "held-back" })], served))
    .toEqual({ running: 0, queued: 1 });
});
