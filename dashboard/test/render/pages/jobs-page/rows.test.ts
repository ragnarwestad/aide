// Which scheduled jobs the Jobs tab shows, where every row
// stands, what a job row is called, what it says under its state and what it
// offers. One test per rule, on plain job-shaped objects.

import { describe, expect, test } from "bun:test";
import { phaseKey } from "../../../../src/render/pages/specs-list/phase-messages/keys.ts";
import {
  byTabPlace,
  jobControl,
  jobKey,
  jobPlace,
  jobsShown,
  jobTitle,
  scheduleStreamKey,
  specPlace,
  specsStoodForByJobs,
  specRounds,
} from "../../../../src/render/pages/jobs-page/rows.ts";
import { jobDismissible } from "../../../../src/queue/queue.ts";

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
const sched = (o: Partial<J> = {}): J => job({ specFolder: "schedule-nightly", steps: ["schedule"], ...o });
const T = (day: number): string => `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`;
const ms = (day: number): number => Date.parse(T(day));

const none: Parameters<typeof jobsShown>[1] = { scheduleEntryExists: () => true };
const ids = (jobs: J[], o = none): string[] => jobsShown(jobs, o).map((j) => j.id);

/** A spec's group, as far as its place on the tab reads it. */
const group = (o: { state: string; lead?: Partial<Lead>; createdAt?: string }): Parameters<typeof specPlace>[0] =>
  ({ state: o.state, lead: o.lead ? job(o.lead as Partial<J>) : undefined, createdAt: o.createdAt }) as never;

describe("where a row stands on the tab: running or landing, queued, the rest; the newest change first", () => {
  test("a finished spec stands by its newest job, not by the day it was made", () => {
    const finished = group({ state: "archived", createdAt: T(1) });
    expect(specPlace(finished, [job({ createdAt: T(8), finishedAt: T(9) })])).toEqual({ band: 3, changedAt: ms(9) });
    expect(specPlace(finished).changedAt).toBe(ms(1));
  });

  test("uses four bands with finished work last and newest first in each (AC-4)", () => {
    const ordered = [
      ["finished-old", { band: 3, changedAt: ms(1) }],
      ["waiting", { band: 2, changedAt: ms(4) }],
      ["queued", { band: 1, changedAt: ms(3) }],
      ["running", { band: 0, changedAt: ms(2) }],
      ["finished-new", { band: 3, changedAt: ms(5) }],
    ] as const;
    expect([...ordered].sort((a, b) => byTabPlace(a[1], b[1])).map(([name]) => name))
      .toEqual(["running", "queued", "waiting", "finished-new", "finished-old"]);
  });

  test("running and landing specs come first, then the queued one, then the rest, newest first", () => {
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

  test("a job's band is running or landing, queued, waiting, or finished (AC-4)", () => {
    expect(jobPlace(job({ state: "running" })).band).toBe(0);
    expect(jobPlace(job({ state: "done", landing: true })).band).toBe(0);
    expect(jobPlace(job({ state: "queued" })).band).toBe(1);
    expect(jobPlace(job({ state: "failed" })).band).toBe(2);
    expect(jobPlace(job({ state: "done" })).band).toBe(3);
  });

  test("a spec's change is its lead job's newest stamp: made, started or finished", () => {
    const lead = { createdAt: T(2), startedAt: T(3), finishedAt: T(4), state: "done" as const };
    expect(specPlace(group({ state: "done", lead, createdAt: T(1) })).changedAt).toBe(ms(4));
  });

  test("with no job of its round a spec's change is the day it was made", () => {
    expect(specPlace(group({ state: "not-started", createdAt: T(1) })).changedAt).toBe(ms(1));
  });

  test("a spec git has not dated, with no job, is the newest of its band", () => {
    const undated = specPlace(group({ state: "not-started" }));
    const dated = specPlace(group({ state: "not-started", createdAt: T(9) }));
    expect(byTabPlace(undated, dated)).toBeLessThan(0);
  });

  test("a scheduled job's change is its newest stamp, so it can stand above a spec made after it began", () => {
    const build = jobPlace(sched({ state: "failed", createdAt: T(10), finishedAt: T(12) } as Partial<J>));
    const idle = specPlace(group({ state: "not-started", createdAt: T(11) }));
    expect(byTabPlace(build, idle)).toBeLessThan(0);

    const running = specPlace(group({ state: "running", lead: { state: "running", createdAt: T(5) } }));
    expect(byTabPlace(running, build)).toBeLessThan(0);
  });
});

describe("a scheduled job in flight has a row", () => {
  test("a queued, a running and a landing scheduled job", () => {
    const jobs = [
      sched({ id: "sq", state: "queued" }),
      sched({ id: "sr", state: "running", project: "other" }),
      sched({ id: "sl", state: "done", landing: true, project: "third" }),
    ];
    expect(new Set(ids(jobs))).toEqual(new Set(["sq", "sr", "sl"]));
  });

  test("finished and cancelled jobs remain as history (AC-3)", () => {
    const jobs = [sched({ id: "d", state: "done" }), sched({ id: "x", state: "cancelled", project: "other" })];
    expect(ids(jobs)).toEqual(["d", "x"]);
  });
});

test("successive successful Reopens make stable, dated spec rounds (AC-2, AC-7, AC-9)", () => {
  const jobs = [
    job({ id: "create", steps: ["create"], state: "done", createdAt: T(1) }),
    job({ id: "first", steps: ["analyze"], state: "done", createdAt: T(2) }),
    job({ id: "reopen", steps: ["reopen"], state: "done", createdAt: T(5), finishedAt: T(6) }),
    job({ id: "second", steps: ["implement"], state: "done", createdAt: T(7) }),
  ];
  const rounds = specRounds(jobs, T(1));
  expect(rounds.map((round) => ({ key: round.key, startedAt: round.startedAt, ids: round.jobs.map((j) => j.id) }))).toEqual([
    { key: "aide/81-queue", startedAt: T(1), ids: ["create", "first"] },
    { key: `aide/81-queue@${encodeURIComponent(T(6))}`, startedAt: T(6), ids: ["reopen", "second"] },
  ]);
});

describe("a cleanup job has a row only while it runs or waits for a person", () => {
  const cleanup = (o: Partial<J>): J => job({ specFolder: "cleanup", steps: ["cleanup"], ...o });

  test("includes a running cleanup job (AC-1)", () => {
    expect(ids([cleanup({ id: "running", state: "running" })])).toEqual(["running"]);
  });

  test("keeps a completed cleanup job in history (AC-3)", () => {
    expect(ids([cleanup({ id: "done", state: "done" })])).toEqual(["done"]);
  });

  test("keeps a cleanup job that waits for a person (AC-3)", () => {
    expect(ids([cleanup({ id: "failed", state: "failed" })])).toEqual(["failed"]);
  });
});

test("a step record decides whether a job owns a row (AC-1, AC-4)", () => {
  expect(ids([job({ id: "close", steps: ["close"], state: "running" })])).toEqual(["close"]);
  expect(ids([job({ id: "analyze", steps: ["analyze"], state: "running" })])).toEqual([]);
});

describe("a spec's job is never a job row: its spec's row stands for it", () => {
  test("running, queued, landing, failed and held-back spec jobs are not returned", () => {
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

  test("a create, running or ended without a spec, is not returned either", () => {
    const create = (o: Partial<J>) => job({ specFolder: "new-0a1b2c3d", steps: ["create"], ...o });
    expect(ids([create({ id: "run", state: "running" }), create({ id: "cr", state: "failed" })])).toEqual([]);
  });
});

describe("a finished scheduled job that waits for the user keeps its row", () => {
  const waiting: [string, Partial<J>][] = [
    ["failed", { state: "failed" }],
    ["failed with a conflict", { state: "failed", errorReason: "conflict" } as Partial<J>],
    ["interrupted", { state: "interrupted" }],
    ["stopped by its time limit", { state: "stopped", stopReason: "timeout" } as Partial<J>],
    ["stopped on red tests", { state: "stopped", stopReason: "tests-red" } as Partial<J>],
  ];
  for (const [what, o] of waiting) {
    test(`${what}`, () => {
      expect(ids([sched({ id: "s", ...o })])).toEqual(["s"]);
    });
  }
});

describe("a newer scheduled job leaves the earlier one in history", () => {
  const failed = sched({ id: "old", state: "failed", createdAt: T(1) });

  for (const state of ["queued", "running", "done"] as const) {
    test(`a newer ${state} one`, () => {
      const newer = sched({ id: "new", state, createdAt: T(2) });
      expect(ids([newer, failed])).toEqual(["new", "old"]);
    });
  }

  test("a newer cancelled run does not clear it", () => {
    const newer = sched({ id: "new", state: "cancelled", createdAt: T(2) });
    expect(ids([newer, failed])).toEqual(["new", "old"]);
  });

  test("a newer one that itself waits keeps its own row, and the older goes", () => {
    const newer = sched({ id: "new", state: "failed", createdAt: T(2) });
    expect(ids([newer, failed])).toEqual(["new", "old"]);
  });

  test("an older job after the failed one does not clear it", () => {
    const older = sched({ id: "before", state: "done", createdAt: T(0) });
    expect(ids([failed, older])).toEqual(["old", "before"]);
  });

  test("another project or another schedule key leave it", () => {
    const other = sched({ id: "b", state: "running", project: "other", createdAt: T(3) });
    expect(ids([other, failed])).toContain("old");

    const s = sched({ id: "s", state: "failed", specFolder: "schedule-a", createdAt: T(1) });
    const sOther = sched({ id: "so", state: "done", specFolder: "schedule-b", createdAt: T(2) });
    expect(ids([sOther, s])).toEqual(["so", "s"]);
  });
});

describe("a waiting scheduled job whose entry was deleted", () => {
  const waiting = sched({ id: "s", state: "failed" });

  test("stays as finished history after its entry is deleted (AC-3, AC-11)", () => {
    const asked: [string, string][] = [];
    const exists = (project: string, name: string) => {
      asked.push([project, name]);
      return true;
    };
    expect(ids([waiting], { ...none, scheduleEntryExists: exists })).toEqual(["s"]);
    expect(asked).toEqual([]);
    expect(ids([waiting], { ...none, scheduleEntryExists: () => false })).toEqual(["s"]);
  });

  test("a running scheduled job does not ask whether its entry exists", () => {
    const running = sched({ id: "r", state: "running" });
    expect(ids([running], { ...none, scheduleEntryExists: () => false })).toEqual(["r"]);
  });

  test("is sorted as finished once its entry is gone (AC-11)", () => {
    expect(jobPlace(waiting, [], () => false).band).toBe(3);
  });

  test("is sorted as finished after any newer run, including a cancelled one (AC-11)", () => {
    const subject = { ...waiting, createdAt: T(1) };
    const newer = sched({ id: "new", state: "cancelled", createdAt: T(2) });
    expect(jobPlace(subject, [subject, newer], () => true).band).toBe(3);
  });
});

describe("which jobs may be dismissed from the tab", () => {
  test("a scheduled job that failed, stopped or was interrupted (AC-1)", () => {
    for (const state of ["failed", "stopped", "interrupted"] as const) expect(jobDismissible(sched({ state }))).toBe(true);
  });

  test("a scheduled job in flight, done or cancelled, and no other kind of job (AC-4)", () => {
    for (const state of ["queued", "running", "done", "cancelled"] as const) expect(jobDismissible(sched({ state }))).toBe(false);
    expect(jobDismissible(sched({ state: "done", landing: true }))).toBe(false);
    for (const step of ["close", "reopen", "deploy"]) {
      expect(jobDismissible(job({ steps: [step], state: "failed" }))).toBe(false);
    }
    expect(jobDismissible(job({ state: "failed" }))).toBe(false);
  });
});

describe("an old dismissal stamp no longer removes scheduled-job history", () => {
  const failed = (o: Partial<J> = {}): J => sched({ id: "s", state: "failed", createdAt: T(1), startedAt: T(2), finishedAt: T(3), ...o });

  test("it remains regardless of the dismissal stamp (AC-3, AC-10)", () => {
    expect(ids([failed({ dismissedAt: T(4) })])).toEqual(["s"]);
    expect(ids([failed({ dismissedAt: T(3) })])).toEqual(["s"]);
  });

  test("it is returned again once it ended after the dismissal (AC-3)", () => {
    expect(ids([failed({ dismissedAt: T(2) })])).toEqual(["s"]);
  });

  test("a job in flight is shown whatever stamp is left on it (AC-3)", () => {
    expect(ids([sched({ id: "r", state: "running", startedAt: T(2), dismissedAt: T(9) })])).toEqual(["r"]);
  });
});

describe("a Close or Reopen is a job row of its own, not its spec's", () => {
  const at = (step: string, o: Partial<J> = {}): J => job({ steps: [step], ...o });
  test("a queued, a running and a landing Close or Reopen have a row", () => {
    const jobs = [
      at("reopen", { id: "q", state: "queued" }),
      at("close", { id: "r", state: "running", specFolder: "82-b" }),
      at("reopen", { id: "l", state: "done", landing: true, specFolder: "83-c" }),
    ];
    expect(ids(jobs)).toEqual(["q", "r", "l"]);
  });

  test("failed and finished jobs remain as their own history rows (AC-3)", () => {
    expect(ids([at("close", { id: "f", state: "failed" })])).toEqual(["f"]);
    expect(ids([at("close", { id: "f", state: "failed", createdAt: T(1) }), job({ id: "a", state: "running", createdAt: T(2) })])).toEqual(["f"]);
    expect(ids([at("reopen", { id: "d", state: "done" })])).toEqual(["d"]);
  });

  test("a reopen gone on to the spec's next step is the spec's again", () => {
    expect(ids([job({ id: "on", steps: ["reopen", "analyze"], stepIndex: 1, state: "running" })])).toEqual([]);
  });

  test("its key is its spec's and its step's, and its title names both", () => {
    const row = at("reopen", { project: "aide", specFolder: "534-a-card" });
    expect(jobKey(row)).toBe("aide/534-a-card:reopen");
    expect(jobKey(sched())).toBe("aide/schedule-nightly");
    expect(jobTitle(row)).toBe("Reopen aide:534");
  });

  test("offers neither Stop nor Cancel: a half-done move would leave the spec between two places", () => {
    for (const state of ["queued", "running"] as const) expect(jobControl(at("reopen", { state }))).toBeUndefined();
    expect(jobControl(at("close", { state: "done", landing: true }))).toBeUndefined();
  });

  test("while one is in flight it stands for its spec, whose own row is not drawn", () => {
    const shown = [
      at("close", { state: "running", specFolder: "670-a" }),
      at("reopen", { state: "queued", specFolder: "671-b" }),
      at("close", { state: "done", landing: true, specFolder: "672-c" }),
      at("close", { state: "failed", specFolder: "673-d" }),
      sched({ state: "running" }),
    ];
    expect([...specsStoodForByJobs(shown)].sort()).toEqual(["aide/670-a", "aide/671-b", "aide/672-c"]);
  });
});

describe("a job row's title says what the job is", () => {
  test("a scheduled job reads its name, with no project", () => {
    const title = jobTitle(job({ specFolder: "schedule-nightly-report", steps: ["schedule"], project: "woodstack" }));
    expect(title).toBe("nightly-report");
  });
});

describe("what a job row offers to stop it", () => {
  test("a queued job that is not landing offers Cancel", () => {
    expect(jobControl(sched({ state: "queued" }))).toBe("cancel");
  });

  test("a running or a landing job offers Stop", () => {
    expect(jobControl(sched({ state: "running" }))).toBe("stop");
    expect(jobControl(sched({ state: "done", landing: true }))).toBe("stop");
    expect(jobControl(sched({ state: "queued", landing: true }))).toBe("stop");
  });

  test("a finished job offers nothing", () => {
    for (const state of ["done", "failed", "stopped", "interrupted", "cancelled"] as const) {
      expect(jobControl(sched({ state }))).toBeUndefined();
    }
  });
});

describe("a deploy is a job row of its own, named for the deploy", () => {
  const deploy = (o: Partial<J> = {}): J => job({ specFolder: "deploy", steps: ["deploy"], ...o });

  test("a queued, a held-back and a running deploy have a row", () => {
    const jobs = [
      deploy({ id: "q", state: "queued" }),
      deploy({ id: "h", state: "queued", specFolder: "deploy", project: "other", errorReason: "held-back" } as Partial<J>),
      deploy({ id: "r", state: "running", project: "third" }),
    ];
    expect(ids(jobs)).toEqual(["q", "h", "r"]);
  });

  test("failed and interrupted deploys stay beside newer deploys (AC-3)", () => {
    for (const state of ["failed", "interrupted"] as const) {
      expect(ids([deploy({ id: "f", state, createdAt: T(1) })])).toEqual(["f"]);
      expect(ids([deploy({ id: "f", state, createdAt: T(1) }), deploy({ id: "n", state: "queued", createdAt: T(2) })])).toEqual(["f", "n"]);
    }
  });

  test("a done deploy stays in history (AC-3)", () => {
    expect(ids([deploy({ id: "d", state: "done" })])).toEqual(["d"]);
  });

  test("its title is the deploy and its project, and its key is the project's own", () => {
    const row = deploy({ project: "aide" });
    expect(jobTitle(row)).toBe("Deploy aide");
    expect(jobKey(row)).toBe("aide/deploy:deploy");
  });

  test("offers Cancel while queued, held back or not, and nothing once it runs", () => {
    expect(jobControl(deploy({ state: "queued" }))).toBe("cancel");
    expect(jobControl(deploy({ state: "queued", errorReason: "held-back" } as Partial<J>))).toBe("cancel");
    expect(jobControl(deploy({ state: "running" }))).toBeUndefined();
  });
});

describe("the key the event stream listens on for a job row's key", () => {
  test("a scheduled job's row key gives its running step's phase key", () => {
    expect(scheduleStreamKey("aide/schedule-nightly")).toBe(phaseKey("aide", "schedule-nightly", "schedule"));
    expect(scheduleStreamKey(jobKey(sched()))).toBe("aide/schedule-nightly:schedule");
  });

  test("a spec's key, a Close's key and a malformed key give none", () => {
    for (const key of ["aide/81-queue", "aide/534-a-card:reopen", "aide/schedule-nightly:schedule", "schedule-nightly", "/schedule-x", ""]) {
      expect(scheduleStreamKey(key)).toBeUndefined();
    }
  });
});
