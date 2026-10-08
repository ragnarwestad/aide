// Which jobs the Jobs tab shows, what it calls them, where they belong and
// what they offer. One test per rule, on plain job-shaped objects.

import { describe, expect, test } from "bun:test";
import { jobControl, jobHome, jobsShown, jobTitle } from "../../../../src/render/pages/jobs-page/rows.ts";

type J = Parameters<typeof jobsShown>[0][number];

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
const T = (day: number): string => `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`;

const none: Parameters<typeof jobsShown>[1] = { openFailedCreates: new Set<string>(), scheduleEntryExists: () => true };
const ids = (jobs: J[], o = none): string[] => jobsShown(jobs, o).map((j) => j.id);

describe("a job in flight has a row, whatever started it (AC-2)", () => {
  test("a queued spec step, a running create, a landing archive, wiki jobs and a scheduled job", () => {
    const jobs = [
      job({ id: "q", state: "queued" }),
      job({ id: "c", state: "running", specFolder: "new-0a1b2c3d", steps: ["create"] }),
      job({ id: "l", state: "done", landing: true, steps: ["archive"] }),
      job({ id: "wr", state: "queued", specFolder: "wiki-aide", steps: ["wiki"] }),
      job({ id: "wb", state: "running", specFolder: "wiki-aide", steps: ["wiki"] }),
      job({ id: "s", state: "running", project: "other", specFolder: "schedule-nightly", steps: ["schedule"] }),
    ];
    expect(new Set(ids(jobs))).toEqual(new Set(["q", "c", "l", "wr", "wb", "s"]));
  });

  test("a finished job with nothing waiting, and a cancelled one, have none (AC-2)", () => {
    const jobs = [job({ id: "d", state: "done" }), job({ id: "x", state: "cancelled" })];
    expect(ids(jobs)).toEqual([]);
  });

  test("running and landing come first, then queued, then waiting; the newest first in each (AC-2)", () => {
    const jobs = [
      job({ id: "f", state: "failed", specFolder: "1-a", createdAt: T(9) }),
      job({ id: "q-old", state: "queued", specFolder: "2-b", createdAt: T(2) }),
      job({ id: "q-new", state: "queued", specFolder: "3-c", createdAt: T(3) }),
      job({ id: "r-old", state: "running", specFolder: "4-d", createdAt: T(1) }),
      job({ id: "r-new", state: "running", specFolder: "5-e", createdAt: T(4) }),
      job({ id: "l", state: "done", landing: true, specFolder: "6-f", createdAt: T(5) }),
    ];
    expect(ids(jobs)).toEqual(["l", "r-new", "r-old", "q-new", "q-old", "f"]);
  });
});

describe("a finished job that waits for the user keeps its row (AC-3)", () => {
  const waiting: [string, Partial<J>][] = [
    ["failed", { state: "failed" }],
    ["failed with a conflict", { state: "failed", errorReason: "conflict" } as Partial<J>],
    ["interrupted", { state: "interrupted" }],
    ["stopped by its time limit", { state: "stopped", stopReason: "timeout" } as Partial<J>],
    ["stopped on red tests", { state: "stopped", stopReason: "tests-red" } as Partial<J>],
    ["stopped on unticked criteria", { state: "stopped", stopReason: "acceptance-criteria" } as Partial<J>],
    ["stopped on shared files", { state: "stopped", stopReason: "shared-files" } as Partial<J>],
    [
      "an archive held back on unticked criteria",
      { state: "done", steps: ["archive"], results: [{ terminalReason: "acceptance-criteria-unticked" }] },
    ],
  ];
  for (const [what, o] of waiting) {
    test(`${what} (AC-3)`, () => {
      expect(ids([job({ id: "w", ...o })])).toEqual(["w"]);
    });
  }

  test("an archive that ended another way is not held back (AC-3)", () => {
    const done = job({ id: "d", state: "done", steps: ["archive"], results: [{ terminalReason: "merged" }] });
    expect(ids([done])).toEqual([]);
  });
});

describe("a newer job of the same project and key clears a waiting one (AC-3)", () => {
  const failed = job({ id: "old", state: "failed", specFolder: "81-queue", createdAt: T(1) });

  for (const state of ["queued", "running", "done"] as const) {
    test(`a newer ${state} one (AC-3)`, () => {
      const newer = job({ id: "new", state, specFolder: "81-queue", steps: ["implement"], createdAt: T(2) });
      expect(ids([newer, failed])).not.toContain("old");
    });
  }

  test("a newer cancelled run does not clear it (AC-3)", () => {
    const newer = job({ id: "new", state: "cancelled", specFolder: "81-queue", createdAt: T(2) });
    expect(ids([newer, failed])).toEqual(["old"]);
  });

  test("a newer one that itself waits keeps its own row, and the older goes (AC-3)", () => {
    const newer = job({ id: "new", state: "failed", specFolder: "81-queue", createdAt: T(2) });
    expect(ids([newer, failed])).toEqual(["new"]);
  });

  test("any step of the spec clears it: a newer Analyze clears a failed Implement (AC-3)", () => {
    const implement = job({ id: "imp", state: "failed", steps: ["implement"], specFolder: "81-queue", createdAt: T(1) });
    const analyze = job({ id: "ana", state: "running", steps: ["analyze"], specFolder: "81-queue", createdAt: T(2) });
    expect(ids([analyze, implement])).toEqual(["ana"]);
  });

  test("an older job after the failed one does not clear it (AC-3)", () => {
    const older = job({ id: "before", state: "done", specFolder: "81-queue", createdAt: T(0) });
    expect(ids([failed, older])).toEqual(["old"]);
  });

  test("another spec, another project, another wiki or schedule key leave it (AC-3)", () => {
    const others = [
      job({ id: "a", state: "running", specFolder: "82-other", createdAt: T(3) }),
      job({ id: "b", state: "running", project: "other", specFolder: "81-queue", createdAt: T(3) }),
    ];
    expect(ids([...others, failed])).toContain("old");

    const wiki = job({ id: "w", state: "failed", specFolder: "wiki-aide", steps: ["wiki"], createdAt: T(1) });
    const wikiOther = job({ id: "wo", state: "done", specFolder: "wiki-other", steps: ["wiki"], createdAt: T(2) });
    expect(ids([wikiOther, wiki])).toEqual(["w"]);

    const sched = job({ id: "s", state: "failed", specFolder: "schedule-a", steps: ["schedule"], createdAt: T(1) });
    const schedOther = job({ id: "so", state: "done", specFolder: "schedule-b", steps: ["schedule"], createdAt: T(2) });
    expect(ids([schedOther, sched])).toEqual(["s"]);
  });

  test("a newer refresh clears a failed wiki build of the same project (AC-3)", () => {
    const build = job({ id: "b", state: "failed", specFolder: "wiki-aide", steps: ["wiki"], createdAt: T(1) });
    const refresh = job({ id: "r", state: "done", specFolder: "wiki-aide", steps: ["wiki"], createdAt: T(2) });
    expect(ids([refresh, build])).toEqual([]);
  });
});

describe("a create that ended without a spec (AC-3)", () => {
  const create = job({ id: "cr", state: "failed", specFolder: "new-0a1b2c3d", steps: ["create"] });

  test("has a row while its message is not dismissed, and none once it is (AC-3)", () => {
    expect(ids([create], { ...none, openFailedCreates: new Set(["cr"]) })).toEqual(["cr"]);
    expect(ids([create], { ...none, openFailedCreates: new Set() })).toEqual([]);
  });
});

describe("a waiting scheduled job whose entry was deleted (AC-3)", () => {
  const sched = job({ id: "s", state: "failed", specFolder: "schedule-nightly", steps: ["schedule"] });

  test("has a row while its entry exists, and none once it is gone (AC-3)", () => {
    const asked: [string, string][] = [];
    const exists = (project: string, name: string) => (asked.push([project, name]), true);
    expect(ids([sched], { ...none, scheduleEntryExists: exists })).toEqual(["s"]);
    expect(asked).toEqual([["aide", "nightly"]]);
    expect(ids([sched], { ...none, scheduleEntryExists: () => false })).toEqual([]);
  });

  test("a running scheduled job does not ask whether its entry exists (AC-2)", () => {
    const running = job({ id: "r", state: "running", specFolder: "schedule-nightly", steps: ["schedule"] });
    expect(ids([running], { ...none, scheduleEntryExists: () => false })).toEqual(["r"]);
  });
});

describe("a row's title says what the job is (AC-4)", () => {
  const titleOf = (project: string, folder: string): string | undefined =>
    project === "aide" && folder === "81-queue-and-runner" ? "Queue and runner" : undefined;
  const view = (o: Partial<J> & { createTitle?: string; wikiRefresh?: boolean }) => job({ ...o }) as ReturnType<typeof job> & typeof o;

  test("a spec's step names the project, the number and title, and the step (AC-4)", () => {
    const title = jobTitle(view({ specFolder: "81-queue-and-runner", steps: ["implement"] }), "en", titleOf);
    expect(title).toContain("aide");
    expect(title).toContain("81-Queue and runner");
    expect(title).toContain("Implement");
  });

  test("with no title the folder stands alone, number not doubled (AC-4)", () => {
    const title = jobTitle(view({ specFolder: "82-untitled", steps: ["analyze"] }), "en", titleOf);
    expect(title).toContain("82-untitled");
    expect(title).not.toContain("82-82");
  });

  test("a landing archive names the step landing, not the one queued behind it (AC-4)", () => {
    const title = jobTitle(
      view({ specFolder: "81-queue-and-runner", steps: ["analyze", "implement"], stepIndex: 1, state: "queued", landing: true }),
      "en",
      titleOf,
    );
    expect(title).toContain("Analyze");
    expect(title).not.toContain("Implement");
  });

  test("a create names its title and Create (AC-4)", () => {
    const title = jobTitle(
      view({ specFolder: "new-0a1b2c3d", steps: ["create"], createTitle: "Add a thing" }),
      "en",
      titleOf,
    );
    expect(title).toContain("Add a thing");
    expect(title).toContain("Create");
  });

  test("a wiki build and a wiki refresh read Wiki build / Wiki refresh — project (AC-4)", () => {
    const wiki = { specFolder: "wiki-aide", steps: ["wiki"] };
    expect(jobTitle(view(wiki), "en", titleOf)).toBe("Wiki build — aide");
    expect(jobTitle(view({ ...wiki, wikiRefresh: true }), "en", titleOf)).toBe("Wiki refresh — aide");
  });

  test("a scheduled job reads name — project (AC-4)", () => {
    const title = jobTitle(view({ specFolder: "schedule-nightly-report", steps: ["schedule"], project: "woodstack" }), "en", titleOf);
    expect(title).toBe("nightly-report — woodstack");
  });
});

describe("what a row offers to stop it (AC-5, AC-6)", () => {
  test("a queued job that is not landing offers Cancel (AC-5)", () => {
    expect(jobControl(job({ state: "queued" }))).toBe("cancel");
  });

  test("a running or a landing job offers Stop (AC-5)", () => {
    expect(jobControl(job({ state: "running" }))).toBe("stop");
    expect(jobControl(job({ state: "done", landing: true }))).toBe("stop");
    expect(jobControl(job({ state: "queued", landing: true }))).toBe("stop");
  });

  test("a running create offers neither, and neither does a finished job (AC-5)", () => {
    expect(jobControl(job({ state: "running", steps: ["create"], specFolder: "new-0a1b2c3d" }))).toBeUndefined();
    for (const state of ["done", "failed", "stopped", "interrupted", "cancelled"] as const) {
      expect(jobControl(job({ state }))).toBeUndefined();
    }
  });

  test("no state gives a Run (AC-6)", () => {
    const states = ["queued", "running", "done", "failed", "stopped", "interrupted", "cancelled"] as const;
    for (const state of states) {
      for (const landing of [false, true]) {
        expect([undefined, "cancel", "stop"]).toContain(jobControl(job({ state, landing })));
      }
    }
  });
});

describe("where a job belongs (AC-5)", () => {
  test("a spec's step belongs on the spec's page (AC-5)", () => {
    expect(jobHome(job({ project: "aide", specFolder: "81-queue" }))).toBe("/specs/aide/81-queue");
  });

  test("a create belongs on the Specs list (AC-5)", () => {
    expect(jobHome(job({ specFolder: "new-0a1b2c3d", steps: ["create"] }))).toBe("/specs");
  });

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
