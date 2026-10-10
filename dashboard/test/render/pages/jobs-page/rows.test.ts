// Which wiki builds and scheduled jobs the Jobs tab shows, where every row
// stands, what a job row is called, where it belongs and what it offers. One
// test per rule, on plain job-shaped objects.

import { describe, expect, test } from "bun:test";
import {
  byTabPlace,
  jobControl,
  jobHome,
  jobPlace,
  jobsShown,
  jobTitle,
  specPlace,
} from "../../../../src/render/pages/jobs-page/rows.ts";

type J = Parameters<typeof jobsShown>[0][number];
type Lead = Parameters<typeof jobPlace>[0];

let n = 0;
const job = (o: Partial<J> & { createdAt?: string } = {}): J => ({
  id: `j${++n}`,
  project: "aide",
  specFolder: "81-queue",
  steps: ["analyze"],
  stepIndex: 0,
  state: "queued",
  createdAt: `2026-10-0${(n % 9) + 1}T10:00:00Z`,
  results: [],
  ...o,
});
const wiki = (o: Partial<J> = {}): J => job({ specFolder: "wiki-aide", steps: ["wiki"], ...o });
const sched = (o: Partial<J> = {}): J => job({ specFolder: "schedule-nightly", steps: ["schedule"], ...o });
const T = (day: number): string => `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`;
const ms = (day: number): number => Date.parse(T(day));

const none: Parameters<typeof jobsShown>[1] = { scheduleEntryExists: () => true };
const ids = (jobs: J[], o = none): string[] => jobsShown(jobs, o).map((j) => j.id);

/** A spec's group, as far as its place on the tab reads it. */
const group = (o: { state: string; lead?: Partial<Lead>; createdAt?: string }): Parameters<typeof specPlace>[0] =>
  ({ state: o.state, lead: o.lead ? job(o.lead as Partial<J>) : undefined, createdAt: o.createdAt }) as never;

describe("where a row stands on the tab: running or landing, queued, the rest; the newest change first (AC-4)", () => {
  test("running and landing specs come first, then the queued one, then the rest, newest first (AC-4)", () => {
    const places = [
      ["rest-t1", specPlace(group({ state: "not-started", createdAt: T(1) }))],
      ["queued", specPlace(group({ state: "queued", lead: { state: "queued", createdAt: T(2) } }))],
      ["rest-t3", specPlace(group({ state: "failed", lead: { state: "failed", createdAt: T(3) } }))],
      ["running-old", specPlace(group({ state: "running", lead: { state: "running", createdAt: T(4) } }))],
      // A landing lead already reads `running` in its group.
      ["landing-new", specPlace(group({ state: "running", lead: { state: "done", landing: true, createdAt: T(8) } }))],
      ["rest-t2", specPlace(group({ state: "not-started", createdAt: T(2) }))],
    ] as const;
    const ordered = [...places].sort((a, b) => byTabPlace(a[1], b[1])).map(([name]) => name);
    expect(ordered).toEqual(["landing-new", "running-old", "queued", "rest-t3", "rest-t2", "rest-t1"]);
  });

  test("a job's band is its own state: running or landing, queued, else the rest (AC-4)", () => {
    expect(jobPlace(job({ state: "running" })).band).toBe(0);
    expect(jobPlace(job({ state: "done", landing: true })).band).toBe(0);
    expect(jobPlace(job({ state: "queued" })).band).toBe(1);
    expect(jobPlace(job({ state: "failed" })).band).toBe(2);
  });

  test("a spec's change is its lead job's newest stamp: made, started or finished (AC-4)", () => {
    const lead = { createdAt: T(2), startedAt: T(3), finishedAt: T(4), state: "done" as const };
    expect(specPlace(group({ state: "done", lead, createdAt: T(1) })).changedAt).toBe(ms(4));
  });

  test("with no job of its round a spec's change is the day it was made (AC-4)", () => {
    expect(specPlace(group({ state: "not-started", createdAt: T(1) })).changedAt).toBe(ms(1));
  });

  test("a spec git has not dated, with no job, is the newest of its band (AC-4)", () => {
    const undated = specPlace(group({ state: "not-started" }));
    const dated = specPlace(group({ state: "not-started", createdAt: T(9) }));
    expect(byTabPlace(undated, dated)).toBeLessThan(0);
  });

  test("a wiki build's change is its newest stamp, so it can stand above a spec made after it began (AC-4)", () => {
    const build = jobPlace(wiki({ state: "failed", createdAt: T(10), finishedAt: T(12) } as Partial<J>));
    const idle = specPlace(group({ state: "not-started", createdAt: T(11) }));
    expect(byTabPlace(build, idle)).toBeLessThan(0);

    const running = specPlace(group({ state: "running", lead: { state: "running", createdAt: T(5) } }));
    expect(byTabPlace(running, build)).toBeLessThan(0);
  });
});

describe("a wiki build or scheduled job in flight has a row (AC-5)", () => {
  test("a queued or running wiki build, a landing one and a running scheduled job (AC-5)", () => {
    const jobs = [
      wiki({ id: "wq", state: "queued" }),
      wiki({ id: "wr", state: "running", project: "other" }),
      wiki({ id: "wl", state: "done", landing: true, project: "third" }),
      sched({ id: "s", state: "running", project: "fourth" }),
    ];
    expect(new Set(ids(jobs))).toEqual(new Set(["wq", "wr", "wl", "s"]));
  });

  test("a finished one with nothing waiting, and a cancelled one, have none (AC-5)", () => {
    const jobs = [wiki({ id: "d", state: "done" }), sched({ id: "x", state: "cancelled" })];
    expect(ids(jobs)).toEqual([]);
  });
});

describe("a spec's job is never a job row: its spec's row stands for it (AC-1, AC-3)", () => {
  test("running, queued, landing, failed and held-back spec jobs are not returned (AC-1)", () => {
    const jobs = [
      job({ id: "r", state: "running" }),
      job({ id: "q", state: "queued", specFolder: "82-b" }),
      job({ id: "l", state: "done", landing: true, steps: ["archive"], specFolder: "83-c" }),
      job({ id: "f", state: "failed", specFolder: "84-d" }),
      job({
        id: "h", state: "done", steps: ["archive"], specFolder: "85-e",
        results: [{ terminalReason: "acceptance-criteria-unticked" }],
      }),
    ];
    expect(ids(jobs)).toEqual([]);
  });

  test("a create, running or ended without a spec, is not returned either (AC-3)", () => {
    const create = (o: Partial<J>) => job({ specFolder: "new-0a1b2c3d", steps: ["create"], ...o });
    expect(ids([create({ id: "run", state: "running" }), create({ id: "cr", state: "failed" })])).toEqual([]);
  });
});

describe("a finished wiki build or scheduled job that waits for the user keeps its row (AC-5)", () => {
  const waiting: [string, Partial<J>][] = [
    ["failed", { state: "failed" }],
    ["failed with a conflict", { state: "failed", errorReason: "conflict" } as Partial<J>],
    ["interrupted", { state: "interrupted" }],
    ["stopped by its time limit", { state: "stopped", stopReason: "timeout" } as Partial<J>],
    ["stopped on red tests", { state: "stopped", stopReason: "tests-red" } as Partial<J>],
  ];
  for (const [what, o] of waiting) {
    test(`${what} (AC-5)`, () => {
      expect(ids([wiki({ id: "w", ...o })])).toEqual(["w"]);
      expect(ids([sched({ id: "s", ...o })])).toEqual(["s"]);
    });
  }
});

describe("a newer job of the same project and key clears a waiting one (AC-5)", () => {
  const failed = wiki({ id: "old", state: "failed", createdAt: T(1) });

  for (const state of ["queued", "running", "done"] as const) {
    test(`a newer ${state} one (AC-5)`, () => {
      const newer = wiki({ id: "new", state, createdAt: T(2) });
      expect(ids([newer, failed])).not.toContain("old");
    });
  }

  test("a newer cancelled run does not clear it (AC-5)", () => {
    const newer = wiki({ id: "new", state: "cancelled", createdAt: T(2) });
    expect(ids([newer, failed])).toEqual(["old"]);
  });

  test("a newer one that itself waits keeps its own row, and the older goes (AC-5)", () => {
    const newer = wiki({ id: "new", state: "failed", createdAt: T(2) });
    expect(ids([newer, failed])).toEqual(["new"]);
  });

  test("an older job after the failed one does not clear it (AC-5)", () => {
    const older = wiki({ id: "before", state: "done", createdAt: T(0) });
    expect(ids([failed, older])).toEqual(["old"]);
  });

  test("another project, another wiki or schedule key leave it (AC-5)", () => {
    const other = wiki({ id: "b", state: "running", project: "other", createdAt: T(3) });
    expect(ids([other, failed])).toContain("old");

    const w = wiki({ id: "w", state: "failed", specFolder: "wiki-aide", createdAt: T(1) });
    const wOther = wiki({ id: "wo", state: "done", specFolder: "wiki-other", createdAt: T(2) });
    expect(ids([wOther, w])).toEqual(["w"]);

    const s = sched({ id: "s", state: "failed", specFolder: "schedule-a", createdAt: T(1) });
    const sOther = sched({ id: "so", state: "done", specFolder: "schedule-b", createdAt: T(2) });
    expect(ids([sOther, s])).toEqual(["s"]);
  });

  test("a newer refresh clears a failed wiki build of the same project (AC-5)", () => {
    const refresh = wiki({ id: "r", state: "done", createdAt: T(2) });
    expect(ids([refresh, failed])).toEqual([]);
  });
});

describe("a waiting scheduled job whose entry was deleted (AC-5)", () => {
  const waiting = sched({ id: "s", state: "failed" });

  test("has a row while its entry exists, and none once it is gone (AC-5)", () => {
    const asked: [string, string][] = [];
    const exists = (project: string, name: string) => {
      asked.push([project, name]);
      return true;
    };
    expect(ids([waiting], { ...none, scheduleEntryExists: exists })).toEqual(["s"]);
    expect(asked).toEqual([["aide", "nightly"]]);
    expect(ids([waiting], { ...none, scheduleEntryExists: () => false })).toEqual([]);
  });

  test("a running scheduled job does not ask whether its entry exists (AC-5)", () => {
    const running = sched({ id: "r", state: "running" });
    expect(ids([running], { ...none, scheduleEntryExists: () => false })).toEqual(["r"]);
  });
});

describe("a job row's title says what the job is (AC-5)", () => {
  const view = (o: Partial<J> & { wikiRefresh?: boolean }) => job({ ...o }) as ReturnType<typeof job> & typeof o;

  test("a wiki build and a wiki refresh read Wiki build / Wiki refresh, with no project (AC-5)", () => {
    const w = { specFolder: "wiki-aide", steps: ["wiki"] };
    expect(jobTitle(view(w), "en")).toBe("Wiki build");
    expect(jobTitle(view({ ...w, wikiRefresh: true }), "en")).toBe("Wiki refresh");
  });

  test("a scheduled job reads its name, with no project (AC-5)", () => {
    const title = jobTitle(view({ specFolder: "schedule-nightly-report", steps: ["schedule"], project: "woodstack" }), "en");
    expect(title).toBe("nightly-report");
  });
});

describe("what a job row offers to stop it (AC-5)", () => {
  test("a queued job that is not landing offers Cancel (AC-5)", () => {
    expect(jobControl(wiki({ state: "queued" }))).toBe("cancel");
  });

  test("a running or a landing job offers Stop (AC-5)", () => {
    expect(jobControl(wiki({ state: "running" }))).toBe("stop");
    expect(jobControl(wiki({ state: "done", landing: true }))).toBe("stop");
    expect(jobControl(sched({ state: "queued", landing: true }))).toBe("stop");
  });

  test("a finished job offers nothing (AC-5)", () => {
    for (const state of ["done", "failed", "stopped", "interrupted", "cancelled"] as const) {
      expect(jobControl(wiki({ state }))).toBeUndefined();
    }
  });
});

describe("where a job row belongs (AC-5)", () => {
  test("a wiki job belongs on the project's Wiki build panel (AC-5)", () => {
    expect(jobHome(job({ project: "aide", specFolder: "wiki-aide", steps: ["wiki"] }))).toBe(
      "/projects/aide?tab=wiki&wikitab=build",
    );
  });

  test("a scheduled job belongs on the project's Schedule tab (AC-5)", () => {
    expect(jobHome(job({ project: "aide", specFolder: "schedule-nightly", steps: ["schedule"] }))).toBe(
      "/projects/aide?tab=schedule",
    );
  });
});
