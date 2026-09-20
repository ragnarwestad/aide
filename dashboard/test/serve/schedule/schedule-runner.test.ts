// The schedule poll's wiring: `refreshSchedules()` is a
// private closure inside `createServer`, so this suite asks the
// question the same way `projects-route.test.ts` asks about
// `refreshDrift` — through the server's own HTTP surface, polling
// `GET /api/queue` for the job the background timer is expected to
// have enqueued. `schedule.test.ts` covers `isDue`'s own logic in
// isolation; this covers that the timer actually calls it and enqueues.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../../helpers/queue-server.ts";
import { createScheduleStore } from "../../../src/queue/schedule-store.ts";
import { refreshSchedules, type ScheduleContext } from "../../../src/serve/schedules/index.ts";

const harness = queueHarness("aide-schedule-runner-");

// The jobs live in this queue config file, one per test.
let cfgDir: string;
let cfg: string;
beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), "aide-schedule-runner-cfg-"));
  cfg = join(cfgDir, "queue-config.json");
});
afterEach(() => {
  harness.cleanup();
  rmSync(cfgDir, { recursive: true, force: true });
});

type Entry = Record<string, unknown>;

/** Set the config file's jobs for `project`, replacing what it held. */
function writeSchedule(project: string, entries: Entry[]): void {
  writeFileSync(cfg, JSON.stringify({ schedules: { [project]: entries } }));
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

const NIGHTLY: Entry = { name: "nightly-report", cron: "* * * * *", prompt: "docs/nightly.md" };

describe("refreshSchedules", () => {
  test("a due entry with no prior job is enqueued as a schedule step", async () => {
    const { base } = harness.start({
      extra: { queueConfigFile: cfg, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 30 },
    });
    writeSchedule("aide", [NIGHTLY]);
    const list = await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly-report"));
    const job = list.find((j) => j.specFolder === "schedule-nightly-report");
    expect(job).toBeDefined();
    expect(job?.project).toBe("aide");
    expect(job?.steps).toEqual(["schedule"]);
  });

  test("does not enqueue a duplicate while one is already queued (acceptance criterion 2)", async () => {
    const { base } = harness.start({
      extra: { queueConfigFile: cfg, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20 },
    });
    writeSchedule("aide", [NIGHTLY]);
    await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly-report"));
    // Several more ticks, all of which should see the same job already
    // queued and enqueue nothing further.
    await new Promise((r) => setTimeout(r, 150));
    const list = await jobs(base);
    expect(list.filter((j) => j.specFolder === "schedule-nightly-report")).toHaveLength(1);
  });

  // A schedule job is not a spec, so a project that has none yet — a
  // fresh install's own aide checkout — still gets its entries fired.
  test("a due entry fires in an allowed project with no specs", async () => {
    const { base } = harness.start({
      extra: { queueConfigFile: cfg, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 30, queueProjects: ["aide", "fresh"] },
    });
    writeSchedule("fresh", [NIGHTLY]);
    const list = await jobsUntil(base, (l) => l.some((j) => j.project === "fresh"));
    expect(list.find((j) => j.project === "fresh")?.specFolder).toBe("schedule-nightly-report");
  });

  test("a project with no schedule entries gets nothing enqueued", async () => {
    const { base } = harness.start({
      extra: { queueConfigFile: cfg, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20 },
    });
    await new Promise((r) => setTimeout(r, 150));
    const list = await jobs(base);
    expect(list.some((j) => j.steps.includes("schedule"))).toBe(false);
  });

  // The whole point of the entry's own model field: a fire that ignored
  // it would run every night on whatever the configuration says, with
  // nobody watching to notice.
  test("a due entry fires on the model it names", async () => {
    const { base } = harness.start({
      extra: { queueConfigFile: cfg,
        driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 30,
        queueDefaults: {
            
          timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
          model: { default: "sonnet" },
          modelChoices: { sonnet: { }, "codex-fast": {  tool: "codex" as const } },
        },
      },
    });
    writeSchedule("aide", [{ ...NIGHTLY, model: "codex-fast" }]);
    const list = await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly-report"));
    expect(list.find((j) => j.specFolder === "schedule-nightly-report")?.modelChoice).toBe("codex-fast");
  });

  // Jobs are read from the queue config file and nowhere else.
  test("a due entry only a project's manifest lists enqueues nothing (AC-2)", async () => {
    const { base, dir } = harness.start({
      extra: { queueConfigFile: cfg, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20 },
    });
    writeFileSync(
      join(dir, "root", "aide", ".aide", "project.yaml"),
      'name: aide\nschedule:\n  - name: from-manifest\n    cron: "* * * * *"\n    prompt: docs/nightly.md\n',
    );
    writeSchedule("aide", [{ name: "other", cron: "0 3 * * *", prompt: "docs/nightly.md", since: "2999-01-01T00:00:00Z" }]);
    await new Promise((r) => setTimeout(r, 200));
    expect((await jobs(base)).some((j) => j.steps.includes("schedule"))).toBe(false);
  });

  test("a server whose config file does not exist has no scheduled jobs, whatever the manifests say (AC-3)", async () => {
    const { base, dir } = harness.start({
      extra: { queueConfigFile: join(cfgDir, "missing.json"), driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20 },
    });
    writeFileSync(
      join(dir, "root", "aide", ".aide", "project.yaml"),
      'name: aide\nschedule:\n  - name: from-manifest\n    cron: "* * * * *"\n    prompt: docs/nightly.md\n',
    );
    await new Promise((r) => setTimeout(r, 200));
    expect((await jobs(base)).some((j) => j.steps.includes("schedule"))).toBe(false);
    const page = await (await fetch(`${base}/schedule`)).text();
    expect(page).not.toContain("from-manifest");
  });

  test("scheduleCheckMs: 0 turns the poll off entirely", async () => {
    const { base } = harness.start({
      extra: { queueConfigFile: cfg, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 0 },
    });
    writeSchedule("aide", [NIGHTLY]);
    await new Promise((r) => setTimeout(r, 150));
    const list = await jobs(base);
    expect(list.some((j) => j.specFolder === "schedule-nightly-report")).toBe(false);
  });
});

// A fire the queue refuses leaves a line in the serve log, once per
// fire window and reason, and a name in another case fires on the listed one.
describe("refreshSchedules and a refused fire", () => {
  const DAILY: Entry = { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md" };
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
    const { base } = harness.start({
      extra: { queueConfigFile: cfg, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20, queueDefaults: QUEUE_DEFAULTS },
    });
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      writeSchedule("aide", [{ ...DAILY, model: "retired" }]);
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && !lines.some((l) => l.includes("scheduled fire refused"))) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await new Promise((r) => setTimeout(r, 100));
      const refused = lines.filter((l) => l.includes("scheduled fire refused for aide/nightly"));
      expect(refused).toHaveLength(1);
      expect(refused[0]).toContain("unknown or not-allowed model: retired");

      writeSchedule("aide", [{ ...DAILY, model: "Sonnet" }]);
      const list = await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly"));
      expect(list.find((j) => j.specFolder === "schedule-nightly")?.modelChoice).toBe("Sonnet");
      await new Promise((r) => setTimeout(r, 100));
      expect(lines.filter((l) => l.includes("scheduled fire refused"))).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });

  test("a due entry naming the model in another case is enqueued on the listed spelling", async () => {
    const { base } = harness.start({
      extra: { queueConfigFile: cfg, driftPollMs: 0, specCachePollMs: 0, scheduleCheckMs: 20, queueDefaults: QUEUE_DEFAULTS },
    });
    writeSchedule("aide", [{ ...DAILY, model: "sonnet" }]);
    const list = await jobsUntil(base, (l) => l.some((j) => j.specFolder === "schedule-nightly"));
    expect(list.find((j) => j.specFolder === "schedule-nightly")?.modelChoice).toBe("Sonnet");
  });

  describe("called directly with a stub queue and a clock", () => {
    let root: string;
    let clock = 0;
    let answer: { ok: true } | { ok: false; error: string } = { ok: false, error: "refused: one" };
    let ctx: ScheduleContext;

    const setup = (entries: Entry[]) => {
      root = mkdtempSync(join(tmpdir(), "aide-refresh-schedules-"));
      writeSchedule("aide", entries);
      clock = Date.parse("2026-09-10T12:00:00Z");
      answer = { ok: false, error: "refused: one" };
      ctx = {
        projectRoot: root,
        allowed: new Set(["aide"]),
        scheduleStore: createScheduleStore(cfg),
        machineryProjectDir: () => root,
        now: () => clock,
        queue: { list: () => [], enqueue: () => answer },
      } as unknown as ScheduleContext;
    };
    afterEach(() => rmSync(root, { recursive: true, force: true }));
    const tick = () => loggedDuring(() => refreshSchedules(ctx));

    test("once per fire window and reason, again for a new window, a new reason, or after an accept", async () => {
      setup([DAILY]);
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

    test("an entry that leaves the config and comes back is logged again", async () => {
      setup([DAILY]);
      expect(await tick()).toHaveLength(1);
      writeSchedule("aide", []);
      expect(await tick()).toHaveLength(0);
      writeSchedule("aide", [DAILY]);
      expect(await tick()).toHaveLength(1);
    });

    test("a config file the store cannot parse enqueues nothing, and one line names the file (AC-2)", async () => {
      setup([DAILY]);
      writeFileSync(cfg, "{ not json");
      const enqueued: unknown[] = [];
      ctx = { ...ctx, queue: { list: () => [], enqueue: (r: unknown) => (enqueued.push(r), { ok: true }) } } as unknown as ScheduleContext;
      const lines = [...(await tick()), ...(await tick())];
      expect(enqueued).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(cfg);
    });
  });
});
