// The schedule poll's wiring (spec 259): `refreshSchedules()` is a
// private closure inside `createServer`, so this suite asks the
// question the same way `projects-route.test.ts` asks about
// `refreshDrift` — through the server's own HTTP surface, polling
// `GET /api/queue` for the job the background timer is expected to
// have enqueued. `schedule.test.ts` covers `isDue`'s own logic in
// isolation; this covers that the timer actually calls it and enqueues.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";
import { refreshSchedules, type ScheduleContext } from "../../src/serve/schedules/index.ts";

const harness = queueHarness("aide-schedule-runner-");
afterEach(() => harness.cleanup());

function writeSchedule(dir: string, project: string, yaml: string): void {
  writeFileSync(join(dir, "root", project, ".aide", "project.yaml"), yaml);
}

interface QueuedJob {
  project: string;
  specFolder: string;
  steps: string[];
  modelChoice?: string;
}

async function jobs(base: string): Promise<QueuedJob[]> {
  const res = await fetch(`${base}/api/queue`);
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
      extra: { driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 30 },
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
      extra: { driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20 },
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
      extra: { driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20 },
    });
    await new Promise((r) => setTimeout(r, 150));
    const list = await jobs(base);
    expect(list.some((j) => j.steps.includes("schedule"))).toBe(false);
  });

  // The whole point of the entry's own model field: a fire that ignored
  // it would run every night on whatever the configuration says, with
  // nobody watching to notice.
  test("a due entry fires on the model it names", async () => {
    const { base, dir } = harness.start({
      extra: {
        driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 30,
        queueDefaults: {
            
          timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
          model: { default: "sonnet" },
          modelChoices: { sonnet: { }, "codex-fast": {  tool: "codex" as const } },
        },
      },
    });
    writeSchedule(dir, "aide", `${NIGHTLY}    model: codex-fast\n`);
    const list = await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly-report"));
    expect(list.find((j) => j.specFolder === "schedule-nightly-report")?.modelChoice).toBe("codex-fast");
  });

  test("scheduleCheckMs: 0 turns the poll off entirely", async () => {
    const { base, dir } = harness.start({
      extra: { driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 0 },
    });
    writeSchedule(dir, "aide", NIGHTLY);
    await new Promise((r) => setTimeout(r, 150));
    const list = await jobs(base);
    expect(list.some((j) => j.specFolder === "schedule-nightly-report")).toBe(false);
  });
});

// Spec 494: a fire the queue refuses leaves a line in the serve log, once per
// fire window and reason, and a name in another case fires on the listed one.
describe("refreshSchedules and a refused fire (spec 494)", () => {
  const DAILY = 'name: aide\nschedule:\n  - name: nightly\n    cron: "0 3 * * *"\n    prompt: docs/nightly.md\n';
  const QUEUE_DEFAULTS = {
    timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
    model: { default: "Sonnet" },
    modelChoices: { Sonnet: {}, Opus: {} },
  };

  /** `console.error` swapped for the length of one case, restored in `finally`. */
  async function loggedDuring(run: () => Promise<void>): Promise<string[]> {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      await run();
    } finally {
      console.error = original;
    }
    return lines;
  }

  test("through the server: one line however many ticks pass, and none once the entry is fixed", async () => {
    const { base, dir } = harness.start({
      extra: { driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20, queueDefaults: QUEUE_DEFAULTS },
    });
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      writeSchedule(dir, "aide", `${DAILY}    model: retired\n`);
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && !lines.some((l) => l.includes("scheduled fire refused"))) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await new Promise((r) => setTimeout(r, 100));
      const refused = lines.filter((l) => l.includes("scheduled fire refused for aide/nightly"));
      expect(refused).toHaveLength(1);
      expect(refused[0]).toContain("unknown or not-allowed model: retired");

      writeSchedule(dir, "aide", `${DAILY}    model: Sonnet\n`);
      const list = await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly"));
      expect(list.find((j) => j.specFolder === "schedule-nightly")?.modelChoice).toBe("Sonnet");
      await new Promise((r) => setTimeout(r, 100));
      expect(lines.filter((l) => l.includes("scheduled fire refused"))).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });

  test("a due entry naming the model in another case is enqueued on the listed spelling", async () => {
    const { base, dir } = harness.start({
      extra: { driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20, queueDefaults: QUEUE_DEFAULTS },
    });
    writeSchedule(dir, "aide", `${DAILY}    model: sonnet\n`);
    const list = await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly"));
    expect(list.find((j) => j.specFolder === "schedule-nightly")?.modelChoice).toBe("Sonnet");
  });

  describe("called directly with a stub queue and a clock", () => {
    let root: string;
    let clock = 0;
    let answer: { ok: true } | { ok: false; error: string } = { ok: false, error: "refused: one" };
    let ctx: ScheduleContext;

    const setup = (yaml: string) => {
      root = mkdtempSync(join(tmpdir(), "aide-refresh-schedules-"));
      mkdirSync(join(root, ".aide"), { recursive: true });
      writeFileSync(join(root, ".aide", "project.yaml"), yaml);
      clock = Date.parse("2026-09-10T12:00:00Z");
      answer = { ok: false, error: "refused: one" };
      ctx = {
        projectRoot: root,
        allowed: new Set(["aide"]),
        machineryProjectDir: () => root,
        now: () => clock,
        queue: { list: () => [], enqueue: () => answer },
      } as unknown as ScheduleContext;
    };
    afterEach(() => rmSync(root, { recursive: true, force: true }));
    const tick = () => loggedDuring(() => refreshSchedules(ctx));

    test("once per fire window and reason, again for a new window, a new reason, or after an accept", async () => {
      setup(DAILY);
      expect(await tick()).toHaveLength(1);
      expect(await tick()).toHaveLength(0);

      clock += 24 * 3600 * 1000;
      expect(await tick()).toHaveLength(1);

      answer = { ok: false, error: "refused: two" };
      const changed = await tick();
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain("refused: two");

      answer = { ok: true };
      expect(await tick()).toHaveLength(0);
      answer = { ok: false, error: "refused: two" };
      expect(await tick()).toHaveLength(1);
    });

    test("an entry that leaves the manifest and comes back is logged again", async () => {
      setup(DAILY);
      expect(await tick()).toHaveLength(1);
      writeFileSync(join(root, ".aide", "project.yaml"), "name: aide\n");
      expect(await tick()).toHaveLength(0);
      writeFileSync(join(root, ".aide", "project.yaml"), DAILY);
      expect(await tick()).toHaveLength(1);
    });
  });
});
