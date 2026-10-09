// The Jobs tab's view: which rows a search, a project and a state entry leave,
// in which order, and what the two dropdowns offer and count. One test per
// rule, on plain objects: a spec's facts as the Specs list's group holds them,
// a wiki or scheduled job's facts from `jobFacts`.

import { describe, expect, test } from "bun:test";
import type { SpecsFilter } from "../../../../src/render/pages/specs-list/data-model";
import {
  JOBS_STATE_FILTERS,
  jobFacts,
  jobsProjectOptions,
  jobsSortPatch,
  jobsStateFilter,
  jobsStateOptions,
  jobsViewPath,
  jobsViewRows,
  type RowFacts,
} from "../../../../src/render/pages/jobs-page/view.ts";
import { byTabPlace, jobPlace, type TabPlace } from "../../../../src/render/pages/jobs-page/rows.ts";
import type { QueueRowView } from "../../../../src/render/ui/job-state";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const T = (day: number, hour = 10): string => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;

const jobRowView = (o: Partial<QueueRowView>): QueueRowView =>
  ({
    id: "j", project: "aide", specFolder: "wiki-aide", steps: ["wiki"], stepIndex: 0, state: "queued",
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

/** A wiki or scheduled job's row: its facts from `jobFacts`, its place from its own stamps. */
const jobEntry = (name: string, row: Partial<QueueRowView>): Entry => {
  const view = jobRowView(row);
  return { name, facts: jobFacts(view, "en", NOW), place: jobPlace(view) };
};

const running = spec("run81", { specFolder: "81-queue-and-runner", state: "running", createdAt: T(8) });
const stopped = spec("idle83", { specFolder: "83-idle", state: "stopped", createdAt: T(5) });
const failedWiki = jobEntry("wiki-other", {
  project: "other", specFolder: "wiki-other", steps: ["wiki"], state: "failed", createdAt: T(6),
  startedAt: T(6), finishedAt: T(6, 11), spentUsd: 0.4,
});
const nightly = jobEntry("nightly", {
  project: "aide", specFolder: "schedule-nightly", steps: ["schedule"], state: "queued", createdAt: T(7),
});
const tab = [running, stopped, failedWiki, nightly];

const names = (rows: Entry[]): string[] => rows.map((r) => r.name);
const view = (rows: Entry[], f: SpecsFilter): string[] => names(jobsViewRows(rows, f));
const factsOf = (rows: Entry[]): RowFacts[] => rows.map((r) => r.facts);

describe("the state, the project and the search narrow the rows as the Specs list's do (AC-1)", () => {
  test("a state entry, a project and a search each leave only the rows they match (AC-1)", () => {
    expect(view(tab, { state: "stopped" })).toEqual(["idle83"]);
    expect(view(tab, { state: "failed" })).toEqual(["wiki-other"]);
    expect(view(tab, { project: "other" })).toEqual(["wiki-other"]);
    expect(view(tab, { q: "queue" })).toEqual(["run81"]);
    expect(view(tab, { project: "aide", state: "waiting" })).toEqual(["nightly"]);
  });

  test("the project dropdown offers every project first, then each with a row by name, counted over the state and the search (AC-1)", () => {
    const options = jobsProjectOptions(factsOf(tab), { state: "failed" });
    expect(options.map((o) => [o.project, o.count])).toEqual([["", 1], ["aide", 0], ["other", 1]]);
    expect(options.filter((o) => o.on).map((o) => o.project)).toEqual([""]);
  });

  test("a project in the view that has no row is offered too, marked, with none (AC-1)", () => {
    const options = jobsProjectOptions(factsOf(tab), { project: "gone" });
    expect(options.find((o) => o.project === "gone")).toEqual({ project: "gone", count: 0, on: true });
    expect(options.filter((o) => o.on).map((o) => o.project)).toEqual(["gone"]);
  });
});

describe("the state filter offers the states a row on the tab can be in (AC-2)", () => {
  test("its entries are All, Running, Waiting, Stopped, Failed and Not verified, in that order (AC-2)", () => {
    expect(JOBS_STATE_FILTERS.map((s) => s.key)).toEqual(["all", "active:all", "waiting", "stopped", "failed", "not-verified"]);
  });

  test("a key the tab does not offer is All, and filters as All does (AC-2)", () => {
    for (const key of [undefined, "", "archived", "closed", "not-archived", "no-such-entry"]) {
      expect(jobsStateFilter(key).key).toBe("all");
    }
    expect(jobsStateFilter("failed").key).toBe("failed");
    expect(view(tab, { state: "closed" })).toEqual(view(tab, {}));
    expect(view(tab, { state: "archived" })).toEqual(view(tab, {}));
  });

  test("the dropdown counts each entry over the rows the project and the search let through, and marks the chosen one (AC-2)", () => {
    const options = jobsStateOptions(factsOf(tab), { project: "aide" });
    expect(options.map((o) => [o.key, o.count])).toEqual([
      ["all", 3], ["active:all", 1], ["waiting", 1], ["stopped", 1], ["failed", 0], ["not-verified", 0],
    ]);
    expect(options.filter((o) => o.on).map((o) => o.key)).toEqual(["all"]);
    expect(jobsStateOptions(factsOf(tab), { state: "stopped" }).find((o) => o.on)?.key).toBe("stopped");
    expect(jobsStateOptions(factsOf(tab), { state: "archived" }).find((o) => o.on)?.key).toBe("all");
  });

  test("a job row is never Not verified: only the spec with an open criterion is left (AC-2)", () => {
    const unverified = spec("unverified", { specFolder: "84-held", state: "done", notVerified: 1 });
    expect(view([unverified, failedWiki], { state: "not-verified" })).toEqual(["unverified"]);
  });
});

describe("a wiki build or scheduled job is matched on its title and its project (AC-3)", () => {
  test("a word of the wiki build's title finds it and not the scheduled job; its folder name is not the title (AC-3)", () => {
    expect(failedWiki.facts.title).toBe("Wiki build");
    expect(view([failedWiki, nightly], { q: "build" })).toEqual(["wiki-other"]);
    expect(view([failedWiki, nightly], { q: "night" })).toEqual(["nightly"]);
    expect(view([failedWiki, nightly], { project: "other" })).toEqual(["wiki-other"]);
  });

  test("a job's facts read as a spec's group reads: a landing is running, the wiki's time spans its start to its finish (AC-3)", () => {
    const landing = jobFacts(jobRowView({ state: "done", landing: true }), "en", NOW);
    expect(landing.state).toBe("running");
    expect(failedWiki.facts.totalDurationMs).toBe(60 * 60 * 1000);
    const going = jobFacts(jobRowView({ state: "running", startedAt: T(9, 11) }), "en", NOW);
    expect(going.totalDurationMs).toBe(60 * 60 * 1000);
    expect(jobFacts(jobRowView({ state: "queued" }), "en", NOW).totalDurationMs).toBe(0);
  });
});

describe("the columns sort as the Specs list's do, and no sorting is the tab's own order (AC-4)", () => {
  const inTabOrder = ["run81", "nightly", "wiki-other", "idle83"];

  test("with no sort, or one that is not a column, the rows keep the tab's own order whatever order they come in (AC-4)", () => {
    const shuffled = [stopped, nightly, failedWiki, running];
    expect(view(shuffled, {})).toEqual(inTabOrder);
    expect(view(shuffled, { sort: "no-such-column" })).toEqual(inTabOrder);
    expect([...tab].sort((a, b) => byTabPlace(a.place, b.place)).map((r) => r.name)).toEqual(inTabOrder);
  });

  test("a column the view names orders rows of both kinds, in the column's direction (AC-4)", () => {
    const priced = [
      spec("cheap", { specFolder: "90-cheap", state: "stopped", spentUsd: 0.1 }),
      spec("dear", { specFolder: "91-dear", state: "stopped", spentUsd: 9 }),
      jobEntry("wiki", { specFolder: "wiki-aide", state: "failed", spentUsd: 3 }),
    ];
    expect(view(priced, { sort: "cost" })).toEqual(["dear", "wiki", "cheap"]);
    expect(view(priced, { sort: "cost", dir: "asc" })).toEqual(["cheap", "wiki", "dear"]);
  });

  test("the time column orders by the figure each row's Time cell shows, longest first (AC-4)", () => {
    const rows = [
      spec("short-spec", { specFolder: "90-a", state: "stopped", totalDurationMs: 1000 }),
      jobEntry("long-wiki", { specFolder: "wiki-aide", state: "failed", startedAt: T(2), finishedAt: T(2, 12) }),
      spec("mid-spec", { specFolder: "91-b", state: "stopped", totalDurationMs: 60_000 }),
    ];
    expect(view(rows, { sort: "started" })).toEqual(["long-wiki", "mid-spec", "short-spec"]);
  });

  test("a press on a heading sorts by it, a second turns it round, a third returns to the tab's order (AC-4)", () => {
    expect(jobsSortPatch({}, "cost")).toEqual({ sort: "cost", dir: "" });
    expect(jobsSortPatch({ sort: "cost" }, "cost")).toEqual({ sort: "cost", dir: "asc" });
    expect(jobsSortPatch({ sort: "cost", dir: "asc" }, "cost")).toEqual({ sort: "", dir: "" });
    expect(jobsSortPatch({ sort: "state" }, "state")).toEqual({ sort: "state", dir: "desc" });
    expect(jobsSortPatch({ sort: "state", dir: "desc" }, "state")).toEqual({ sort: "", dir: "" });
    expect(jobsSortPatch({ sort: "cost" }, "state")).toEqual({ sort: "state", dir: "" });
  });

  test("a view link leads to the Jobs tab, always names its state entry, and drops what the patch empties (AC-4)", () => {
    expect(jobsViewPath({ sort: "cost", dir: "asc" }, jobsSortPatch({ sort: "cost", dir: "asc" }, "cost"))).toBe("/?state=all");
    const link = new URL(`http://x${jobsViewPath({ state: "failed", q: "wiki" }, { project: "other" })}`);
    expect(link.pathname).toBe("/");
    expect(Object.fromEntries(link.searchParams)).toEqual({ state: "failed", q: "wiki", project: "other" });
    expect(new URL(`http://x${jobsViewPath({ state: "closed" }, {})}`).searchParams.get("state")).toBe("all");
  });
});
