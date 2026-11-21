// POST /api/queue/:id/remove and /restart: wired to the table of what a
// row offers (`job-rules/job-actions.ts`, where every cell is proven).

import { afterEach, expect, test } from "bun:test";
import { createGitRunner } from "../../../src/git/process/index.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness } = setupQueueRoutesHarness();
afterEach(() => harness.cleanup());

const job = (o: Record<string, unknown>) => ({
  project: "aide", stepIndex: 0, timeoutSec: {}, permissionMode: {}, model: {}, results: [],
  createdAt: "2026-11-20T10:00:00Z", finishedAt: "2026-11-20T10:05:00Z", ...o,
});
const failedDeploy = job({ id: "d1", specFolder: "deploy", steps: ["deploy"], state: "failed" });
const doneDeploy = job({ id: "d2", specFolder: "deploy", steps: ["deploy"], state: "done" });
const failedMerge = (id: string, branch: string) =>
  job({ id, specFolder: "land", steps: ["land"], state: "failed", branch, error: { key: "landing.mergeConflict", values: { base: "main" } } });
const cancelledMerge = (id: string, branch: string) => job({ id, specFolder: "land", steps: ["land"], state: "cancelled", branch, startedAt: "2026-11-20T10:01:00Z" });

/** git as the board runs it, except that origin has no branch named `gone`. */
const real = createGitRunner();
const gitRun: typeof real = (dir, args, ...rest) =>
  args[0] === "ls-remote" && args.at(-1)?.endsWith("/gone") ? Promise.resolve({ code: 2, stdout: "" }) : real(dir, args, ...rest);

const board = (jobs: Record<string, unknown>[]) =>
  harness.start({ extra: { queueProjects: ["aide"], gitRun }, queueMirror: JSON.stringify(jobs) });
const post = (base: string, path: string) => fetch(`${base}${path}`, { method: "POST" });
const queue = async (base: string) => ((await (await fetch(`${base}/api/queue`)).json()) as { jobs: { id: string; state: string; removedAt?: string }[] }).jobs;

test("Remove takes a failed deploy off Jobs, and is refused where the row does not offer it", async () => {
  const { base } = board([failedDeploy, doneDeploy]);
  expect((await post(base, "/api/queue/d1/remove")).status).toBe(200);
  expect((await queue(base)).find((j) => j.id === "d1")?.removedAt).toBeString();
  expect((await post(base, "/api/queue/d2/remove")).status).toBe(409);
});

test("Start runs a failed Merge again as the same job, and is refused once its branch has left origin", async () => {
  const { base } = board([failedMerge("m1", "fix/still-here"), failedMerge("m2", "fix/gone")]);
  expect((await post(base, "/api/queue/m1/restart")).status).toBe(200);
  const after = await queue(base);
  expect(after.filter((j) => j.id === "m1")).toHaveLength(1);
  expect(after.find((j) => j.id === "m1")?.state).not.toBe("failed");
  const refused = await post(base, "/api/queue/m2/restart");
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { error: string }).error).toContain("no longer has branch fix/gone");
  expect((await post(base, "/api/queue/m2/remove")).status).toBe(200);
});

test("Start runs a cancelled Merge again, and only Remove is left once its branch has left origin", async () => {
  const { base } = board([cancelledMerge("c1", "fix/still-here"), cancelledMerge("c2", "fix/gone")]);
  expect((await post(base, "/api/queue/c1/restart")).status).toBe(200);
  expect((await queue(base)).find((j) => j.id === "c1")?.state).not.toBe("cancelled");
  expect((await post(base, "/api/queue/c2/restart")).status).toBe(409);
  expect((await post(base, "/api/queue/c2/remove")).status).toBe(200);
});

test("Cancel ends a spec step waiting on its usage limit, so the limit's reset does not run it", async () => {
  const waiting = job({ id: "w1", specFolder: "1-spec", steps: ["implement"], state: "waiting", stopReason: "provider-limit",
    usageLimitWait: { until: "2099-01-01T00:00:00Z", resetKnown: true } });
  const { base } = board([waiting]);
  expect((await post(base, "/api/queue/w1/cancel")).status).toBe(200);
  const after = (await queue(base)).find((j) => j.id === "w1") as { state: string; usageLimitWait?: unknown };
  expect(after.state).toBe("cancelled");
  expect(after.usageLimitWait).toBeUndefined();
});
