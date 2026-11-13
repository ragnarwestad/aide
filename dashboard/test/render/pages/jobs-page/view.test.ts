// The Jobs tab's view: which rows a search and a state entry leave, in which
// order, and what the state dropdown offers and counts. One test per rule, on plain objects: a spec's facts as the Specs list's group holds them,
// a scheduled job's facts from `jobFacts`.

import { describe, expect, test } from "bun:test";
import type { QueueRowView } from "../../../../src/render";
import {
  JOBS_STATE_FILTERS,
  JOBS_KIND_FILTERS,
  jobFacts,
  jobsKindFilters,
  jobsKindOptions,
  jobsKindValue,
  jobsSortPatch,
  jobsStateFilters,
  jobsStateValue,
  jobsStateOptions,
  jobsViewPath,
  jobsViewRows,
  type RowFacts,
  type JobsFilter,
} from "../../../../src/render/pages/jobs-page/view.ts";
import { jobPlace, type TabPlace } from "../../../../src/render/pages/jobs-page/rows.ts";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const T = (day: number, hour = 10): string => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;

const jobRowView = (o: Partial<QueueRowView>): QueueRowView =>
  ({
    id: "j", project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], stepIndex: 0, state: "queued",
    spentUsd: 0, timeoutSec: 0, createdAt: T(1), ...o,
  }) as QueueRowView;

type Entry = { name: string; facts: RowFacts; place: TabPlace };

/** A spec's row: its facts the way its group holds them. */
const spec = (
  name: string,
  o: Partial<RowFacts> & { project?: string; specFolder: string; state: RowFacts["state"]; place?: TabPlace },
): Entry => {
  const { place, ...facts } = o;
  const created = facts.createdAt ?? T(1);
  return {
    name,
    facts: { project: "aide", title: undefined, spentUsd: 0, createdAt: created, totalDurationMs: 0, lead: undefined, ...facts },
    place: place ?? { band: facts.state === "running" ? 0 : facts.state === "queued" ? 1 : 2, changedAt: Date.parse(created) },
  };
};

/** A scheduled job's row: its facts from `jobFacts`, its place from its own stamps. */
const jobEntry = (name: string, row: Partial<QueueRowView>): Entry => {
  const view = jobRowView(row);
  return { name, facts: jobFacts(view, NOW), place: jobPlace(view) };
};

const running = spec("run81", { specFolder: "81-queue-and-runner", state: "running", createdAt: T(8) });
const stopped = spec("idle83", { specFolder: "83-idle", state: "stopped", createdAt: T(5) });
const failedReport = jobEntry("report-other", {
  project: "other", specFolder: "schedule-report", steps: ["schedule"], state: "failed", createdAt: T(6),
  startedAt: T(6), finishedAt: T(6, 11), spentUsd: 0.4,
});
const nightly = jobEntry("nightly", {
  project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], state: "queued", createdAt: T(7),
});
const tab = [running, stopped, failedReport, nightly];

const names = (rows: Entry[]): string[] => rows.map((r) => r.name);
const view = (rows: Entry[], f: JobsFilter): string[] => names(jobsViewRows(rows, f));
const factsOf = (rows: Entry[]): RowFacts[] => rows.map((r) => r.facts);

describe("the state and the search narrow the rows as the Specs list's do", () => {
  test("several states keep every matching row (AC-2)", () => {
    expect(view(tab, { state: "stopped,failed" })).toEqual(["report-other", "idle83"]);
  });
  test("a state entry and a search each leave only the rows they match", () => {
    expect(view(tab, { state: "stopped" })).toEqual(["idle83"]);
    expect(view(tab, { state: "failed" })).toEqual(["report-other"]);
    expect(view(tab, { q: "queue" })).toEqual(["run81"]);
    expect(view(tab, { state: "waiting", q: "night" })).toEqual(["nightly"]);
  });

  test("a project in the filter narrows neither the rows nor the counts", () => {
    expect(view(tab, { project: "other" })).toEqual(view(tab, {}));
    expect(view(tab, { project: "other", q: "other:" })).toEqual(["report-other"]);
    expect(jobsStateOptions(factsOf(tab), { project: "aide" })).toEqual(jobsStateOptions(factsOf(tab), {}));
  });
});

describe("kind choices narrow rows independently of state", () => {
  const close = jobEntry("close", { specFolder: "84-close", steps: ["close"], state: "failed", createdAt: T(4) });
  const reopen = jobEntry("reopen", { specFolder: "85-reopen", steps: ["reopen"], state: "queued", createdAt: T(3) });
  const deploy = jobEntry("deploy", { specFolder: "deploy", steps: ["deploy"], state: "failed", createdAt: T(2) });
  const cleanup = jobEntry("cleanup", { specFolder: "cleanup", steps: ["cleanup"], state: "done", createdAt: T(1) });
  const group = spec("group", { specFolder: "Release", state: "running", itemCount: 2, createdAt: T(9) });
  const kinds = [running, close, reopen, deploy, nightly, cleanup, group];

  test("All is the default and several kinds keep every matching row (AC-1, AC-3)", () => {
    expect(JOBS_KIND_FILTERS).toEqual(["all", "spec", "deploy", "schedule", "cleanup", "group"]);
    expect(jobsKindFilters(undefined).map((entry) => entry.key)).toEqual(["all"]);
    expect(view(kinds, { kind: "deploy,schedule" })).toEqual(["nightly", "deploy"]);
  });

  test("kind and state both have to match (AC-4)", () => {
    expect(view(kinds, { kind: "spec", state: "waiting" })).toEqual(["reopen"]);
    expect(view(kinds, { kind: "deploy,spec", state: "failed" })).toEqual(["close", "deploy"]);
  });

  test("Close and Reopen count as Specs while execution groups count as Groups (AC-5)", () => {
    expect(view(kinds, { kind: "spec" })).toEqual(["run81", "close", "reopen"]);
    expect(view(kinds, { kind: "group" })).toEqual(["group"]);
  });

  test("kind counts use the rows left by search and mark every chosen kind (AC-6, AC-7)", () => {
    const options = jobsKindOptions(factsOf(kinds), { q: "aide", kind: "spec,group" });
    expect(options.map((option) => [option.key, option.count])).toEqual([
      ["all", 8], ["spec", 3], ["deploy", 1], ["schedule", 1], ["cleanup", 1], ["group", 2],
    ]);
    expect(options.filter((option) => option.on).map((option) => option.key)).toEqual(["spec", "group"]);
  });

  test("kind values and view links retain both filter parts (AC-7)", () => {
    expect(jobsKindValue("group,spec")).toBe("spec,group");
    const link = new URL(`http://x${jobsViewPath({ state: "failed", kind: "deploy" }, { sort: "cost" })}`);
    expect(Object.fromEntries(link.searchParams)).toEqual({ state: "failed", kind: "deploy", sort: "cost" });
  });
});

describe("the state filter offers the states a row on the tab can be in", () => {
  test("its entries are All, Active, Running, Waiting, Done, Stopped, Failed and Not verified, All selected by default (AC-5)", () => {
    expect(JOBS_STATE_FILTERS.map((s) => s.key)).toEqual(["all", "not-archived", "active:all", "waiting", "done", "stopped", "failed", "not-verified"]);
    expect(jobsStateFilters(undefined).map((entry) => entry.key)).toEqual(["all"]);
    expect(jobsStateFilters("not-archived").map((entry) => entry.key)).toEqual(["not-archived"]);
  });

  test("search returns every round row for the same spec (AC-6)", () => {
    const rounds = [
      spec("round-1", { specFolder: "144-history", state: "done", createdAt: T(1) }),
      spec("round-2", { specFolder: "144-history", state: "done", createdAt: T(5) }),
    ];
    expect(view(rounds, { q: "aide:144" })).toEqual(["round-2", "round-1"]);
  });

  test("Done shows only finished rows and remains the selected state (AC-5)", () => {
    const done = spec("done", { specFolder: "145-done", state: "done", createdAt: T(6) });
    expect(view([running, done, failedReport], { state: "done" })).toEqual(["done"]);
    expect(jobsStateFilters("done").map((entry) => entry.key)).toEqual(["done"]);
  });

  test("a key the tab does not offer is All, and filters as All does", () => {
    for (const key of [undefined, "", "archived", "closed", "no-such-entry"]) {
      expect(jobsStateFilters(key).map((entry) => entry.key)).toEqual(["all"]);
    }
    expect(jobsStateFilters("failed").map((entry) => entry.key)).toEqual(["failed"]);
    expect(view(tab, { state: "closed" })).toEqual(view(tab, {}));
    expect(view(tab, { state: "archived" })).toEqual(view(tab, {}));
  });

  test("the dropdown counts each entry over the rows the search lets through, and marks the chosen one", () => {
    const options = jobsStateOptions(factsOf(tab), { q: "other:", project: "aide" });
    expect(options.map((o) => [o.key, o.count])).toEqual([
      ["all", 1], ["not-archived", 1], ["active:all", 0], ["waiting", 0], ["done", 0], ["stopped", 0], ["failed", 1], ["not-verified", 0],
    ]);
    expect(options.filter((o) => o.on).map((o) => o.key)).toEqual(["all"]);
    expect(view(tab, { q: "other:", project: "aide" })).toEqual(["report-other"]);
    expect(jobsStateOptions(factsOf(tab), { state: "stopped" }).find((o) => o.on)?.key).toBe("stopped");
    expect(jobsStateOptions(factsOf(tab), { state: "archived" }).find((o) => o.on)?.key).toBe("all");
  });

  test("a search that names a project's rows counts those rows alone", () => {
    const counts = jobsStateOptions(factsOf(tab), { q: "aide" }).map((o) => [o.key, o.count]);
    expect(counts).toEqual([["all", 3], ["not-archived", 3], ["active:all", 1], ["waiting", 1], ["done", 0], ["stopped", 1], ["failed", 0], ["not-verified", 0]]);
  });

  test("with no search term, or only spaces, each entry counts over every row on the tab", () => {
    for (const q of [undefined, "", "   "]) {
      expect(jobsStateOptions(factsOf(tab), { q }).map((o) => o.count)).toEqual([4, 4, 1, 1, 0, 1, 1, 0]);
    }
  });

  test("a job row is never Not verified: only the spec with an open criterion is left", () => {
    const unverified = spec("unverified", { specFolder: "84-held", state: "done", notVerified: 1 });
    expect(view([unverified, failedReport], { state: "not-verified" })).toEqual(["unverified"]);
  });
});

describe("a group stands for its member specs, each by its own state", () => {
  /** A member spec's facts, as its current row holds them. */
  const member = (folder: string, state: RowFacts["state"], o: Partial<RowFacts> = {}): RowFacts =>
    spec(folder, { specFolder: folder, state, ...o }).facts;
  /** A group's row: its own state and member count, and its members' facts. */
  const group = (name: string, state: RowFacts["state"], members: RowFacts[]): Entry =>
    spec(name, { specFolder: name, state, itemCount: members.length, members });
  const counts = (rows: Entry[], f: JobsFilter = {}): Record<string, number> =>
    Object.fromEntries(jobsStateOptions(factsOf(rows), f).map((o) => [o.key, o.count]));

  test("a prepared group counts its members under their own states, never its own (AC-1)", () => {
    const prepared = group("prepared", "stopped", [member("82-queued", "queued"), member("83-new", "not-started")]);
    const c = counts([prepared]);
    expect([c.waiting, c.stopped, c.all]).toEqual([1, 0, 2]);
  });

  test("a failed member counts under Failed and a queued one under Waiting (AC-1)", () => {
    const c = counts([group("broken", "failed", [member("82-failed", "failed"), member("83-queued", "queued")])]);
    expect([c.failed, c.waiting]).toEqual([1, 1]);
  });

  test("a member with an open criterion counts under Not verified, whatever its group's state (AC-1)", () => {
    expect(counts([group("held", "done", [member("82-held", "done", { notVerified: 1 })])])["not-verified"]).toBe(1);
    expect(counts([group("held", "running", [member("82-held", "done", { notVerified: 1 })])])["not-verified"]).toBe(1);
  });

  test("Running counts only the members that run, not every member of a running group (AC-2)", () => {
    const one = group("one", "running", [member("82-run", "running"), member("83-done", "done")]);
    const waiting = group("waiting", "queued", [member("84-q", "queued"), member("85-q", "queued")]);
    expect(counts([one, waiting])["active:all"]).toBe(1);
    expect(counts([group("both", "running", [member("82-run", "running"), member("83-run", "running")])])["active:all"]).toBe(2);
  });

  test("a chosen state shows a group when at least one member has it (AC-3)", () => {
    const mixed = group("mixed", "stopped", [member("82-q", "queued"), member("83-s", "stopped")]);
    expect(view([mixed], { state: "waiting" })).toEqual(["mixed"]);
    expect(view([mixed], { state: "failed" })).toEqual([]);
    expect(view([mixed], { state: "waiting,failed" })).toEqual(["mixed"]);
  });

  test("All shows every group, one with no member row found among them too (AC-3)", () => {
    const empty = group("empty", "stopped", []);
    const full = group("full", "running", [member("82-run", "running")]);
    expect(view([empty, full], {}).sort()).toEqual(["empty", "full"]);
    expect(view([empty], { state: "stopped" })).toEqual([]);
  });

  test("Active shows and counts every spec and job not Done, a group's running member among them (AC-6)", () => {
    const at = (name: string, state: RowFacts["state"], day: number) => spec(name, { specFolder: name, state, createdAt: T(day) });
    const rows = [
      at("running", "running", 1), at("queued", "queued", 2), at("stopped", "stopped", 3), at("failed", "failed", 4),
      at("new", "not-started", 5), at("done", "done", 6), at("archived", "archived", 7), at("closed", "closed", 8),
      group("half", "running", [member("82-done", "done"), member("83-run", "running")]),
    ];
    expect(view(rows, { state: "not-archived" }).sort()).toEqual(["failed", "half", "new", "queued", "running", "stopped"]);
    expect(counts(rows)["not-archived"]).toBe(6);
  });
});

describe("a scheduled job is matched on its title and its project", () => {
  test("a word of a scheduled job's title finds it and not another; its folder's prefix is not the title", () => {
    expect(failedReport.facts.title).toBe("report");
    expect(view([failedReport, nightly], { q: "report" })).toEqual(["report-other"]);
    expect(view([failedReport, nightly], { q: "night" })).toEqual(["nightly"]);
    expect(view([failedReport, nightly], { q: "other:" })).toEqual(["report-other"]);
  });

  test("a job's facts read as a spec's group reads: a landing is running, the job's time spans its start to its finish", () => {
    const landing = jobFacts(jobRowView({ state: "done", landing: true }), NOW);
    expect(landing.state).toBe("running");
    expect(failedReport.facts.totalDurationMs).toBe(60 * 60 * 1000);
    const going = jobFacts(jobRowView({ state: "running", startedAt: T(9, 11) }), NOW);
    expect(going.totalDurationMs).toBe(60 * 60 * 1000);
    expect(jobFacts(jobRowView({ state: "queued" }), NOW).totalDurationMs).toBe(0);
  });
});

describe("the columns sort as the Specs list's do, newest created first by default", () => {
  test("missing or invalid sort uses creation time across states and row kinds", () => {
    const newest = jobEntry("newest", { state: "done", createdAt: T(9) });
    const shuffled = [stopped, newest, nightly, failedReport, running];
    const expected = ["newest", "run81", "nightly", "report-other", "idle83"];
    expect(view(shuffled, {})).toEqual(expected);
    expect(view(shuffled, { sort: "no-such-column" })).toEqual(expected);
  });

  test("a column the view names orders rows of both kinds, in the column's direction", () => {
    const priced = [
      spec("cheap", { specFolder: "90-cheap", state: "stopped", spentUsd: 0.1 }),
      spec("dear", { specFolder: "91-dear", state: "stopped", spentUsd: 9 }),
      jobEntry("job", { state: "failed", spentUsd: 3 }),
    ];
    expect(view(priced, { sort: "cost" })).toEqual(["dear", "job", "cheap"]);
    expect(view(priced, { sort: "cost", dir: "asc" })).toEqual(["cheap", "job", "dear"]);
  });

  test("the time column orders by the figure each row's Time cell shows, longest first", () => {
    const rows = [
      spec("short-spec", { specFolder: "90-a", state: "stopped", totalDurationMs: 1000 }),
      jobEntry("long-job", { state: "failed", startedAt: T(2), finishedAt: T(2, 12) }),
      spec("mid-spec", { specFolder: "91-b", state: "stopped", totalDurationMs: 60_000 }),
    ];
    expect(view(rows, { sort: "started" })).toEqual(["long-job", "mid-spec", "short-spec"]);
  });

  test("a press on a heading sorts by it, a second turns it round, a third returns to newest created first", () => {
    expect(jobsSortPatch({}, "created")).toEqual({ sort: "created", dir: "asc" });
    expect(jobsSortPatch({}, "cost")).toEqual({ sort: "cost", dir: "" });
    expect(jobsSortPatch({ sort: "cost" }, "cost")).toEqual({ sort: "cost", dir: "asc" });
    expect(jobsSortPatch({ sort: "cost", dir: "asc" }, "cost")).toEqual({ sort: "", dir: "" });
    expect(jobsSortPatch({ sort: "state" }, "state")).toEqual({ sort: "state", dir: "desc" });
    expect(jobsSortPatch({ sort: "state", dir: "desc" }, "state")).toEqual({ sort: "", dir: "" });
    expect(jobsSortPatch({ sort: "cost" }, "state")).toEqual({ sort: "state", dir: "" });
  });

  test("a view link leads to the Jobs tab, always names its state entry, and drops what the patch empties", () => {
    expect(jobsViewPath({ sort: "cost", dir: "asc" }, jobsSortPatch({ sort: "cost", dir: "asc" }, "cost"))).toBe("/?state=all&kind=all");
    const link = new URL(`http://x${jobsViewPath({ state: "failed", q: "nightly" }, { sort: "cost" })}`);
    expect(link.pathname).toBe("/");
    expect(Object.fromEntries(link.searchParams)).toEqual({ state: "failed", kind: "all", q: "nightly", sort: "cost" });
    expect(new URL(`http://x${jobsViewPath({ state: "closed" }, {})}`).searchParams.get("state")).toBe("all");
  });

  test("a state link and the search value carry every ticked entry (AC-5)", () => {
    expect(jobsStateValue("failed,stopped")).toBe("stopped,failed");
    const failed = jobsStateOptions(factsOf(tab), { state: "stopped" }).find((option) => option.key === "failed")!;
    const link = new URL(`http://x${jobsViewPath({ state: "stopped", q: "night" }, { state: failed.state })}`);
    expect(link.searchParams.get("state")).toBe("stopped,failed");
    expect(link.searchParams.get("q")).toBe("night");
  });
});
