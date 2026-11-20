import { expect, test } from "bun:test";
import { jobsNeedingAttention } from "../../../src/queue/job-rules/attention-count.ts";
import type { Job } from "../../../src/queue/types.ts";
import type { ExecutionGroup } from "../../../src/queue/execution-groups";

const job = (id: string, overrides: Partial<Job> = {}): Job => ({
  id, project: "aide", specFolder: id, state: "failed", steps: ["implement"], stepIndex: 0,
  createdAt: "2026-11-18T09:00:00Z", results: [], ...overrides,
} as Job);
const serves = (project: string) => project === "aide";
const counts = (jobs: Job[], groups: ExecutionGroup[] = [], open = (_: string, folder: string) => !folder.includes("archived-since")) =>
  jobsNeedingAttention(jobs, groups, serves, (_, key) => key === "schedule-daily", open);

test("counts manual holds and failed jobs, but not automatic waits or cancellations", () => {
  expect(counts([
    job("1-choice", { state: "queued", errorReason: "held-back", error: { key: "runner.approachChoice" } }),
    job("2-dependency", { state: "queued", errorReason: "held-back", error: { key: "runner.dependencyNotArchived", values: { spec: "1-choice" } } }),
    job("3-usage", { state: "waiting", stopReason: "provider-limit", usageLimitWait: { until: "2026-11-19T00:00:00Z", resetKnown: true } }),
    job("4-cancelled", { state: "cancelled" }),
    job("5-running", { state: "running" }),
    job("6-queued", { state: "queued" }),
    job("7-tests", { state: "failed", stopReason: "tests-red" }),
    job("8-foreign", { project: "other" }),
    job("9-acceptance", { state: "done", results: [{ terminalReason: "acceptance-criteria-unticked" }] as Job["results"] }),
  ])).toBe(3);
});

test("only the latest attempt in each branch, spec or schedule can count", () => {
  expect(counts([
    job("land-retry", { specFolder: "land", steps: ["land"], branch: "fixed", state: "queued" }),
    job("land-old", { specFolder: "land", steps: ["land"], branch: "fixed" }),
    job("land-other", { specFolder: "land", steps: ["land"], branch: "independent" }),
    job("spec-old", { specFolder: "1-spec" }),
    job("spec-retry", { specFolder: "1-spec", state: "running", createdAt: "2026-11-18T09:01:00Z" }),
    job("spec-closed", { specFolder: "2-spec", state: "done", steps: ["close"] }),
    job("closed-spec-old", { specFolder: "2-spec" }),
    job("schedule-daily", { steps: ["schedule"] }),
    job("schedule-deleted", { steps: ["schedule"] }),
    job("schedule-old", { specFolder: "schedule-daily", steps: ["schedule"], dismissedAt: "2026-11-18" }),
  ])).toBe(2);
});

test("a group awaiting acceptance counts once even if its member job is also waiting", () => {
  const group = { id: "group", project: "aide", state: "waiting-acceptance" } as ExecutionGroup;
  expect(counts([job("1-spec", { executionGroupId: group.id })], [group])).toBe(1);
});

test("a spec whose latest job ended done before archive waits for the next step", () => {
  const done = (id: string, steps: string[], overrides: Partial<Job> = {}) =>
    job(id, { state: "done", steps, stepIndex: steps.length - 1, ...overrides });
  expect(counts([
    done("1-implemented", ["analyze", "implement"]),
    done("2-analyzed", ["analyze"]),
    done("3-created", ["create"]),
    done("4-archived", ["analyze", "implement", "archive"]),
    done("5-reopened", ["reopen"]),
    done("6-archived-since", ["analyze", "implement"]),
  ])).toBe(2);
});

test("a group member that finished its own steps waits on its group, not on the reader", () => {
  const group = { id: "group", project: "aide", state: "running" } as ExecutionGroup;
  expect(counts([job("1-member", { state: "done", steps: ["analyze", "implement"], stepIndex: 1, executionGroupId: group.id })], [group])).toBe(0);
});
