import { expect, test } from "bun:test";
import { activeJobCount } from "../../../src/queue/job-rules/active-count.ts";
import type { Job } from "../../../src/queue/types.ts";
import type { ExecutionGroup } from "../../../src/queue/execution-groups";

const job = (id: string, overrides: Partial<Job> = {}): Job => ({
  id, project: "aide", specFolder: id, state: "failed", steps: ["implement"], stepIndex: 0,
  createdAt: "2026-11-18T09:00:00Z", results: [], ...overrides,
} as Job);
const serves = (project: string) => project === "aide";
const counts = (jobs: Job[], groups: ExecutionGroup[] = [], open = (_: string, folder: string) => !folder.includes("archived-since")) =>
  activeJobCount(jobs, groups, serves, (_, key) => key === "schedule-daily", open);

test("counts running jobs and jobs held for a person, not jobs that go on by themselves", () => {
  expect(counts([
    job("1-choice", { state: "queued", errorReason: "held-back", error: { key: "runner.approachChoice" } }),
    job("2-dependency", { state: "queued", errorReason: "held-back", error: { key: "runner.dependencyNotArchived", values: { spec: "1-choice" } } }),
    job("3-usage", { state: "waiting", stopReason: "provider-limit", usageLimitWait: { until: "2026-11-19T00:00:00Z", resetKnown: true } }),
    job("4-running", { state: "running" }),
    job("5-queued", { state: "queued" }),
    job("6-tests", { state: "failed", stopReason: "tests-red" }),
    job("7-foreign", { project: "other" }),
    job("8-acceptance", { state: "done", results: [{ terminalReason: "acceptance-criteria-unticked" }] as Job["results"] }),
    job("9-landing", { state: "done", landing: true, steps: ["analyze", "implement", "archive"], stepIndex: 2 }),
  ])).toBe(5);
});

test("a cancelled job counts while its spec is open or its branch unmerged, and not once it is over", () => {
  expect(counts([
    job("1-open", { state: "cancelled" }),
    job("2-archived-since", { state: "cancelled" }),
    job("merge", { specFolder: "land", steps: ["land"], branch: "feature", state: "cancelled" }),
    job("deploy", { specFolder: "deploy", steps: ["deploy"], state: "cancelled" }),
    job("schedule-daily", { steps: ["schedule"], state: "cancelled" }),
  ])).toBe(2);
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
    job("schedule-old", { specFolder: "schedule-daily", steps: ["schedule"] }),
  ])).toBe(3);
});

test("a group counts once by its own state, never by its members' jobs", () => {
  const group = (id: string, state: ExecutionGroup["state"], extra: Partial<ExecutionGroup> = {}) =>
    ({ id, project: "aide", state, members: [], ...extra }) as ExecutionGroup;
  const groups = [
    group("running", "running"), group("archiving", "archiving"), group("acceptance", "waiting-acceptance"),
    group("prepared", "prepared"), group("stopped", "stopped"),
    group("queued", "queued"), group("completed", "completed"), group("removed", "stopped", { removedAt: "2026-11-20T00:00:00Z" }),
  ];
  const members = [
    job("1-member", { executionGroupId: "running", state: "running" }),
    job("2-member", { executionGroupId: "queued", state: "failed" }),
  ];
  expect(counts(members, groups)).toBe(5);
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

test("a failed job that has been removed from Jobs no longer counts", () => {
  const failedDeploy = job("deploy", { steps: ["deploy"] });
  expect(counts([failedDeploy])).toBe(1);
  expect(counts([{ ...failedDeploy, removedAt: "2026-11-21T10:00:00Z" }])).toBe(0);
});
