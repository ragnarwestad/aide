import { expect, test } from "bun:test";
import { runningSpecCount } from "../../../src/queue/job-rules/running-specs.ts";
import type { Job } from "../../../src/queue/types.ts";

const job = (overrides: Partial<Job> = {}): Job => ({
  project: "aide", specFolder: "821-recover", state: "running", steps: ["implement"], stepIndex: 0, ...overrides,
} as Job);
const served = (project: string) => project === "aide";

test("counts each running spec once, including a landing and the members of a shared archive", () => {
  expect(runningSpecCount([
    job(), job(),
    job({ specFolder: "822-next", state: "done", landing: true }),
    job({ specFolder: "823-group", steps: ["archive"], groupMembers: ["823-group", "824-member"] }),
  ], served)).toBe(4);
});

test("queued, stopped, other job kinds and projects outside this board do not count", () => {
  expect(runningSpecCount([
    job({ state: "queued" }), job({ state: "stopped" }), job({ state: "done" }),
    job({ project: "hidden" }),
    job({ steps: ["schedule"], specFolder: "schedule-news" }),
    job({ steps: ["deploy"] }), job({ steps: ["cleanup"] }),
    job({ steps: ["close"] }), job({ steps: ["reopen"] }),
  ], served)).toBe(0);
});
