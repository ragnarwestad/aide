// The runs list under a scheduled job's report: which run is marked, the
// order, where its rows and headings lead, and nothing when it never ran.
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Job } from "../../../../src/queue/types.ts";
import { renderScheduleRuns, type ScheduleRunsOptions } from "../../../../src/render/pages/schedule-page/runs.ts";
import { scheduleRunPath } from "../../../../src/render";

function run(id: string, state: string, startedAt: string, finishedAt?: string): Job {
  return {
    id, project: "aide", specFolder: "schedule-nightly-report", steps: ["schedule"], stepIndex: 0, state,
    timeoutSec: {}, permissionMode: {}, model: {}, createdAt: startedAt, startedAt,
    ...(finishedAt ? { finishedAt } : {}),
  } as unknown as Job;
}

// Newest first, the order the route hands them in.
const R3 = run("r3", "running", "2026-09-03T03:00:00Z");
const R2 = run("r2", "failed", "2026-09-02T03:00:00Z", "2026-09-02T03:00:05Z");
const R1 = run("r1", "done", "2026-09-01T03:00:00Z", "2026-09-01T03:02:00Z");
const RUNS = [R3, R2, R1];

function draw(o: Partial<ScheduleRunsOptions> = {}): Document {
  const window = new Window();
  window.document.body.innerHTML = renderScheduleRuns({ lang: "en", project: "aide", name: "nightly-report", runs: RUNS, ...o });
  return window.document as unknown as Document;
}

const runOf = (href: string | null): string | null => new URL(href!, "http://board").searchParams.get("run");
const rows = (doc: Document): Element[] => [...doc.querySelectorAll("#runs tbody tr")];
const order = (doc: Document): (string | null)[] => rows(doc).map((tr) => runOf(tr.getAttribute("data-row-href")));
const marked = (doc: Document): (string | null)[] =>
  rows(doc).filter((tr) => tr.getAttribute("aria-current") === "true").map((tr) => runOf(tr.getAttribute("data-row-href")));
/** Each heading as [its text, its link's address, its `aria-sort`]. */
const headings = (doc: Document): [string, URL, string | null][] =>
  [...doc.querySelectorAll("#runs thead th")].map((th) => [
    th.textContent ?? "",
    new URL(th.querySelector("a")!.getAttribute("href")!, "http://board"),
    th.getAttribute("aria-sort"),
  ]);
const query = (u: URL): Record<string, string> => Object.fromEntries(u.searchParams);

describe("the runs list", () => {
  test("has the columns Started, State and Duration (AC-4)", () => {
    expect(headings(draw()).map(([word]) => word)).toEqual(["Started", "State", "Duration"]);
  });

  test("its words follow the reader's language (AC-4)", () => {
    expect(headings(draw({ lang: "nb" })).map(([word]) => word)).toEqual(["Startet", "Tilstand", "Varighet"]);
  });

  test("marks the run being shown, and no other (AC-3)", () => {
    expect(marked(draw({ shown: "r1" }))).toEqual(["r1"]);
    expect(marked(draw({ shown: "r2" }))).toEqual(["r2"]);
    expect(marked(draw())).toEqual([]);
  });

  test("in its default order, every row and its Started link go to the run's own address (AC-3)", () => {
    for (const tr of rows(draw())) {
      const id = runOf(tr.getAttribute("data-row-href"))!;
      expect(tr.getAttribute("data-row-href")).toBe(scheduleRunPath("aide", "nightly-report", id));
      expect(tr.querySelector("a")!.getAttribute("href")).toBe(scheduleRunPath("aide", "nightly-report", id));
    }
  });

  test("by default runs newest start first, with Started marked descending (AC-5)", () => {
    const doc = draw({ runs: [R1, R3, R2] });
    expect(order(doc)).toEqual(["r3", "r2", "r1"]);
    expect(headings(doc).map(([, , sort]) => sort)).toEqual(["descending", null, null]);
  });

  test("a heading links to its column in its first direction, the sorted one turned round (AC-5)", () => {
    expect(headings(draw()).map(([, u]) => query(u))).toEqual([
      { sort: "started", dir: "asc" },
      { sort: "state" },
      { sort: "duration" },
    ]);
    const byState = draw({ sort: "state" });
    expect(order(byState)).toEqual(["r1", "r2", "r3"]);
    expect(headings(byState).map(([, u, sort]) => [query(u), sort])).toEqual([
      [{ sort: "started" }, null],
      [{ sort: "state", dir: "desc" }, "ascending"],
      [{ sort: "duration" }, null],
    ]);
    expect(headings(byState).every(([, u]) => u.hash === "#runs")).toBe(true);
  });

  test("an unknown sort is Started newest first, an unknown direction the column's first (AC-5)", () => {
    const unknown = draw({ sort: "bogus", dir: "sideways" });
    expect(order(unknown)).toEqual(["r3", "r2", "r1"]);
    expect(headings(unknown)[0]![2]).toBe("descending");
    const stateBogusDir = draw({ sort: "state", dir: "sideways" });
    expect(headings(stateBogusDir)[1]![2]).toBe("ascending");
  });

  test("by duration, the longest first and a running run last; turned round with asc (AC-5)", () => {
    expect(order(draw({ sort: "duration" }))).toEqual(["r1", "r2", "r3"]);
    expect(headings(draw({ sort: "duration" }))[2]![2]).toBe("descending");
    expect(order(draw({ sort: "duration", dir: "asc" }))).toEqual(["r3", "r2", "r1"]);
  });

  test("a run link keeps the sort, and a heading keeps the run being shown (AC-5)", () => {
    const doc = draw({ shown: "r1", sort: "state" });
    for (const [, u] of headings(doc)) expect(u.searchParams.get("run")).toBe("r1");
    for (const tr of rows(doc)) {
      expect(new URL(tr.getAttribute("data-row-href")!, "http://board").searchParams.get("sort")).toBe("state");
      expect(new URL(tr.querySelector("a")!.getAttribute("href")!, "http://board").searchParams.get("sort")).toBe("state");
    }
    for (const [, u] of headings(draw({ sort: "state" }))) expect(u.searchParams.has("run")).toBe(false);
  });

  test("an entry that has never run draws nothing (AC-6)", () => {
    expect(renderScheduleRuns({ lang: "en", project: "aide", name: "nightly-report", runs: [] })).toBe("");
  });
});
