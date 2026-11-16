import { expect, test } from "bun:test";
import { specActivityCounts } from "../../../src/queue/job-rules/running-specs.ts";
import type { Job } from "../../../src/queue/types.ts";

const job = (overrides: Partial<Job> = {}): Job => ({
  project: "aide", specFolder: "821-recover", state: "running", steps: ["implement"], stepIndex: 0, ...overrides,
} as Job);
const served = (project: string) => project === "aide";

test("counts each running spec once, including a landing and the members of a shared archive", () => {
  expect(specActivityCounts([
    job(), job(),
    job({ specFolder: "822-next", state: "done", landing: true }),
    job({ specFolder: "823-group", steps: ["archive"], groupMembers: ["823-group", "824-member"] }),
  ], served).running).toBe(4);
});

test("queued, stopped, other job kinds and projects outside this board do not count", () => {
  expect(specActivityCounts([
    job({ state: "queued" }), job({ state: "stopped" }), job({ state: "done" }),
    job({ project: "hidden" }),
    job({ steps: ["schedule"], specFolder: "schedule-news" }),
    job({ steps: ["deploy"] }), job({ steps: ["cleanup"] }),
    job({ steps: ["close"] }), job({ steps: ["reopen"] }),
  ], served).running).toBe(0);
});


test("counts four running specs and six queued specs separately", () => {
  const jobs = Array.from({ length: 10 }, (_, i) => job({ specFolder: `${i}-spec`, state: i < 4 ? "running" : "queued" }));
  expect(specActivityCounts(jobs, served)).toEqual({ running: 4, queued: 6 });
});

test("running takes precedence over queued copies and shared archive members count once", () => {
  expect(specActivityCounts([
    job({ specFolder: "816-one" }),
    job({ state: "queued", steps: ["archive"], groupMembers: ["816-one", "817-two"] }),
    job({ specFolder: "818-three", state: "done", landing: true }),
    job({ specFolder: "818-three", state: "queued" }),
  ], served)).toEqual({ running: 2, queued: 1 });
});
