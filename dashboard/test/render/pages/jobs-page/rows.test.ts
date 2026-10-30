// Which scheduled jobs the Jobs tab shows, where every row
// stands, what a job row is called, what it says under its state and what it
// offers. One test per rule, on plain job-shaped objects.

import { describe, expect, test } from "bun:test";
import { t } from "../../../../src/i18n";
import { renderSentence } from "../../../../src/i18n/message.ts";
import { phaseKey } from "../../../../src/render/pages/specs-list/phase-messages/keys.ts";
import {
  byTabPlace,
  jobControl,
  jobDismissible,
  jobKey,
  jobMessage,
  jobPlace,
  jobsShown,
  jobTitle,
  scheduleStreamKey,
  specPlace,
  specsStoodForByJobs,
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
const sched = (o: Partial<J> = {}): J => job({ specFolder: "schedule-nightly", steps: ["schedule"], ...o });
const T = (day: number): string => `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`;
const ms = (day: number): number => Date.parse(T(day));

const none: Parameters<typeof jobsShown>[1] = { scheduleEntryExists: () => true };
const ids = (jobs: J[], o = none): string[] => jobsShown(jobs, o).map((j) => j.id);

/** A spec's group, as far as its place on the tab reads it. */
const group = (o: { state: string; lead?: Partial<Lead>; createdAt?: string }): Parameters<typeof specPlace>[0] =>
  ({ state: o.state, lead: o.lead ? job(o.lead as Partial<J>) : undefined, createdAt: o.createdAt }) as never;

describe("where a row stands on the tab: running or landing, queued, the rest; the newest change first", () => {
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

  test("a job's band is its own state: running or landing, queued, else the rest", () => {
    expect(jobPlace(job({ state: "running" })).band).toBe(0);
    expect(jobPlace(job({ state: "done", landing: true })).band).toBe(0);
    expect(jobPlace(job({ state: "queued" })).band).toBe(1);
    expect(jobPlace(job({ state: "failed" })).band).toBe(2);
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

  test("a finished one with nothing waiting, and a cancelled one, have none", () => {
    const jobs = [sched({ id: "d", state: "done" }), sched({ id: "x", state: "cancelled", project: "other" })];
    expect(ids(jobs)).toEqual([]);
  });
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

describe("a newer job of the same project and key clears a waiting one", () => {
  const failed = sched({ id: "old", state: "failed", createdAt: T(1) });

  for (const state of ["queued", "running", "done"] as const) {
    test(`a newer ${state} one`, () => {
      const newer = sched({ id: "new", state, createdAt: T(2) });
      expect(ids([newer, failed])).not.toContain("old");
    });
  }

  test("a newer cancelled run does not clear it", () => {
    const newer = sched({ id: "new", state: "cancelled", createdAt: T(2) });
    expect(ids([newer, failed])).toEqual(["old"]);
  });

  test("a newer one that itself waits keeps its own row, and the older goes", () => {
    const newer = sched({ id: "new", state: "failed", createdAt: T(2) });
    expect(ids([newer, failed])).toEqual(["new"]);
  });

  test("an older job after the failed one does not clear it", () => {
    const older = sched({ id: "before", state: "done", createdAt: T(0) });
    expect(ids([failed, older])).toEqual(["old"]);
  });

  test("another project or another schedule key leave it", () => {
    const other = sched({ id: "b", state: "running", project: "other", createdAt: T(3) });
    expect(ids([other, failed])).toContain("old");

    const s = sched({ id: "s", state: "failed", specFolder: "schedule-a", createdAt: T(1) });
    const sOther = sched({ id: "so", state: "done", specFolder: "schedule-b", createdAt: T(2) });
    expect(ids([sOther, s])).toEqual(["s"]);
  });
});

describe("a waiting scheduled job whose entry was deleted", () => {
  const waiting = sched({ id: "s", state: "failed" });

  test("has a row while its entry exists, and none once it is gone", () => {
    const asked: [string, string][] = [];
    const exists = (project: string, name: string) => {
      asked.push([project, name]);
      return true;
    };
    expect(ids([waiting], { ...none, scheduleEntryExists: exists })).toEqual(["s"]);
    expect(asked).toEqual([["aide", "nightly"]]);
    expect(ids([waiting], { ...none, scheduleEntryExists: () => false })).toEqual([]);
  });

  test("a running scheduled job does not ask whether its entry exists", () => {
    const running = sched({ id: "r", state: "running" });
    expect(ids([running], { ...none, scheduleEntryExists: () => false })).toEqual(["r"]);
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

describe("a dismissed scheduled job has no row", () => {
  const failed = (o: Partial<J> = {}): J => sched({ id: "s", state: "failed", createdAt: T(1), startedAt: T(2), finishedAt: T(3), ...o });

  test("it is left out while its dismissal is not older than its newest stamp (AC-3)", () => {
    expect(ids([failed({ dismissedAt: T(4) })])).toEqual([]);
    expect(ids([failed({ dismissedAt: T(3) })])).toEqual([]);
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

  test("a failed one keeps its row until a newer job of its spec, and a finished one has none", () => {
    expect(ids([at("close", { id: "f", state: "failed" })])).toEqual(["f"]);
    expect(ids([at("close", { id: "f", state: "failed", createdAt: T(1) }), job({ id: "a", state: "running", createdAt: T(2) })])).toEqual([]);
    expect(ids([at("reopen", { id: "d", state: "done" })])).toEqual([]);
  });

  test("a reopen gone on to the spec's next step is the spec's again", () => {
    expect(ids([job({ id: "on", steps: ["reopen", "analyze"], stepIndex: 1, state: "running" })])).toEqual([]);
  });

  test("its key is its spec's and its step's, and its title names both", () => {
    const row = at("reopen", { project: "aide", specFolder: "534-a-card" });
    expect(jobKey(row)).toBe("aide/534-a-card:reopen");
    expect(jobKey(sched())).toBe("aide/schedule-nightly");
    expect(jobTitle(row)).toBe("Reopen 534-a-card");
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

  test("a failed or interrupted one keeps its row until a newer deploy of the project is queued", () => {
    for (const state of ["failed", "interrupted"] as const) {
      expect(ids([deploy({ id: "f", state, createdAt: T(1) })])).toEqual(["f"]);
      expect(ids([deploy({ id: "f", state, createdAt: T(1) }), deploy({ id: "n", state: "queued", createdAt: T(2) })])).toEqual(["n"]);
    }
  });

  test("a done one has none", () => {
    expect(ids([deploy({ id: "d", state: "done" })])).toEqual([]);
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

describe("the line under a job row's state", () => {
  type Msg = Partial<J> & { error?: unknown; errorReason?: string };
  const schedule = (o: Msg = {}): J => sched(o as Partial<J>);
  const close = (o: Msg = {}): J => job({ steps: ["close"], ...o } as Partial<J>);
  const reopen = (o: Msg = {}): J => job({ steps: ["reopen"], ...o } as Partial<J>);
  const deploy = (o: Msg = {}): J => job({ specFolder: "deploy", steps: ["deploy"], ...o } as Partial<J>);
  const kinds: [string, (o?: Msg) => J][] = [["scheduled job", schedule], ["Close", close], ["Reopen", reopen], ["Deploy", deploy]];
  const said = { key: "landing.deployServiceOlder", values: { served: "9999999", head: "abc1234" } } as const;
  const sentenceOf = renderSentence("en", said) as string;
  const message = (row: J) => jobMessage(row as never, "en");

  test("a failed job of any kind says why, in its own sentence, red, with its log's address", () => {
    for (const [, make] of kinds) {
      const row = make({ id: "f1", state: "failed", error: said });
      expect(message(row)).toEqual({ variant: "failed", text: sentenceOf, log: "/jobs/f1?tab=steps" });
    }
  });

  test("a stopped job says why in amber, an interrupted one in red, each with the log's address", () => {
    expect(message(schedule({ id: "s1", state: "stopped", error: said }))).toEqual({
      variant: "waiting", text: sentenceOf, log: "/jobs/s1?tab=steps",
    });
    expect(message(schedule({ id: "i1", state: "interrupted", error: said }))).toEqual({
      variant: "failed", text: sentenceOf, log: "/jobs/i1?tab=steps",
    });
  });

  test("with no sentence of its own, a failed, stopped or interrupted job says how it ended", () => {
    const ended = [
      ["failed", "jobs.endedFailed"],
      ["stopped", "jobs.endedStopped"],
      ["interrupted", "jobs.endedInterrupted"],
    ] as const;
    for (const [state, key] of ended) {
      for (const [, make] of kinds) {
        const m = message(make({ id: "e1", state }));
        expect(m?.text).toBe(t("en", key));
        expect(m?.log).toBe("/jobs/e1?tab=steps");
      }
    }
    expect(message(schedule({ state: "failed" }))?.text).not.toBe(message(schedule({ state: "stopped" }))?.text);
  });

  test("the sentence it falls back on is the reader's language", () => {
    const m = jobMessage(schedule({ state: "failed" }) as never, "nb");
    expect(m?.text).toBe(t("nb", "jobs.endedFailed"));
  });

  test("a queued or running job, or a done one landing, offers no log, with or without a sentence", () => {
    for (const [, make] of kinds) {
      for (const row of [make({ state: "queued" }), make({ state: "running" }), make({ state: "done", landing: true })]) {
        expect(message(row)?.log).toBeUndefined();
        expect(message({ ...row, error: said } as J)?.log).toBeUndefined();
      }
    }
    for (const make of [schedule, close, reopen]) {
      expect(message(make({ state: "running", error: said }))).toBeUndefined();
      expect(message(make({ state: "queued" }))).toBeUndefined();
    }
  });

  test("a cancelled job has no line: a person ended it", () => {
    for (const make of [schedule, close, reopen]) expect(message(make({ state: "cancelled", error: said }))).toBeUndefined();
  });

  test("a deploy held back for a landing says so in the info colour, with no log", () => {
    const error = { key: "runner.landingPause" } as const;
    for (const state of ["queued", "running"] as const) {
      const m = message(deploy({ state, errorReason: "held-back", error }));
      expect(m).toEqual({ variant: "info", text: renderSentence("en", error) as string });
    }
  });

  test("a deploy held back for a hold that does not clear on its own is amber, with no log", () => {
    const error = { key: "landing.deployServiceOlder", values: { served: "9999999", head: "abc1234" } } as const;
    const m = message(deploy({ state: "queued", errorReason: "held-back", error }));
    expect(m?.variant).toBe("waiting");
    expect(m?.log).toBeUndefined();
  });

  test("a held-back scheduled job, Close or Reopen has no line: the waiting line is a deploy's", () => {
    const error = { key: "runner.landingPause" } as const;
    for (const make of [schedule, close, reopen]) {
      expect(message(make({ state: "queued", errorReason: "held-back", error }))).toBeUndefined();
    }
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
