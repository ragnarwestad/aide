// The schedule poll's wiring (spec 259): `refreshSchedules()` is a
// private closure inside `createServer`, so this suite asks the
// question the same way `projects-route.test.ts` asks about
// `refreshDrift` — through the server's own HTTP surface, polling
// `GET /api/queue` for the job the background timer is expected to
// have enqueued. `schedule.test.ts` covers `isDue`'s own logic in
// isolation; this covers that the timer actually calls it and enqueues.
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "./helpers/queue-server.ts";

const harness = queueHarness("aide-schedule-runner-");
afterEach(() => harness.cleanup());

const TOKEN = "s3cret-token";
const AUTH = { "x-aide-token": TOKEN };

function writeSchedule(dir: string, project: string, yaml: string): void {
  writeFileSync(join(dir, "root", project, ".aide", "project.yaml"), yaml);
}

interface QueuedJob {
  project: string;
  specFolder: string;
  steps: string[];
}

async function jobs(base: string): Promise<QueuedJob[]> {
  const res = await fetch(`${base}/api/queue`, { headers: AUTH });
  const body = (await res.json()) as { jobs: QueuedJob[] };
  return body.jobs;
}

/** Poll until `predicate` is true or the budget runs out — the same
 *  bounded-loop idiom `projects-route.test.ts` uses for `refreshDrift`,
 *  never an open-ended wait. */
async function jobsUntil(
  base: string,
  predicate: (jobs: QueuedJob[]) => boolean,
  budgetMs = 2000,
): Promise<QueuedJob[]> {
  const deadline = Date.now() + budgetMs;
  let list: QueuedJob[] = [];
  while (Date.now() < deadline) {
    list = await jobs(base);
    if (predicate(list)) return list;
    await new Promise((r) => setTimeout(r, 20));
  }
  return list;
}

const NIGHTLY = 'name: aide\nschedule:\n  - name: nightly-report\n    cron: "* * * * *"\n    prompt: docs/nightly.md\n';

describe("refreshSchedules (spec 259)", () => {
  test("a due entry with no prior job is enqueued as a schedule step", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 30 },
    });
    writeSchedule(dir, "aide", NIGHTLY);
    const list = await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly-report"));
    const job = list.find((j) => j.specFolder === "schedule-nightly-report");
    expect(job).toBeDefined();
    expect(job?.project).toBe("aide");
    expect(job?.steps).toEqual(["schedule"]);
  });

  test("does not enqueue a duplicate while one is already queued (acceptance criterion 2)", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20 },
    });
    writeSchedule(dir, "aide", NIGHTLY);
    await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly-report"));
    // Several more ticks, all of which should see the same job already
    // queued and enqueue nothing further.
    await new Promise((r) => setTimeout(r, 150));
    const list = await jobs(base);
    expect(list.filter((j) => j.specFolder === "schedule-nightly-report")).toHaveLength(1);
  });

  test("a project with no schedule entries gets nothing enqueued", async () => {
    const { base } = harness.start({
      extra: { queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20 },
    });
    await new Promise((r) => setTimeout(r, 150));
    const list = await jobs(base);
    expect(list.some((j) => j.steps.includes("schedule"))).toBe(false);
  });

  test("scheduleCheckMs: 0 turns the poll off entirely", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 0 },
    });
    writeSchedule(dir, "aide", NIGHTLY);
    await new Promise((r) => setTimeout(r, 150));
    const list = await jobs(base);
    expect(list.some((j) => j.specFolder === "schedule-nightly-report")).toBe(false);
  });
});
