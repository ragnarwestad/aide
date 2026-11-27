import { describe, expect, test } from "bun:test";
import { renderSpecsPage, type ArchivedSpecView, type SpecsPageOptions, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import { groupBySpec, type SpecsFilter } from "../../../../../src/render/pages/specs-list/data-model";
import { stateEntries } from "../../../../../src/render/pages/specs-list/filter-bar.ts";
import { row } from "../../fixtures.ts";

// The per-state filter chips became one dropdown, so this is
// the first test file to exercise the dropdown's OWN markup —
// `filterPills`/`FilterPill` were generic, shared markup with nothing
// dropdown-specific to test before this.
//
// "Running" is a single entry rather than a sub-menu with one entry per
// workflow step plus "all". Beside the dropdown stands the number of specs
// the table shows.

const page = (opts: Partial<SpecsPageOptions> = {}, rows: QueueRowView[] = []): string =>
  renderSpecsPage(rows, "2026-08-30T00:00:00Z", [{ label: "Projects", path: "/projects" }], {
    runnerAvailable: true,
    targets: [],
    ...opts,
  });

/** The dropdown's own markup, as one string. */
const panelOf = (html: string): string =>
  html.match(/<details class="menu state"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? "";

/** One option's own `<a>...</a>`, found by its visible label — never by
 *  a substring search that could cross into a NEIGHBOURING option's own
 *  markup, since every option shares the same `<span class="check">`
 *  prefix. */
const optionByLabel = (panel: string, label: string): string =>
  panel.match(new RegExp(`<a data-nav href="[^"]*"[^>]*>(?:(?!<a data-nav).)*?${label} \\(\\d+\\)</a>`))
    ?.[0] ?? "";

/** The number the filter row says the table shows. */
const shownCount = (html: string): number => Number(html.match(/data-result-count>\((\d+)\)</)?.[1] ?? NaN);

/** The spec rows the table draws. */
const specRows = (html: string): number => html.match(/<tr[^>]*\bid="spec-/g)?.length ?? 0;

describe("the Active entry", () => {
  const jobs: QueueRowView[] = [
    row({ id: "a", specFolder: "1-a", state: "running", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "b", specFolder: "2-b", state: "queued", steps: ["implement"], stepIndex: 0 }),
    row({ id: "c", specFolder: "3-c", state: "running", steps: ["analyze"], stepIndex: 0 }),
  ];

  test("Active counts queued, running and landing jobs (AC-7)", () => {
    const html = page({}, jobs);
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Active")).toMatch(/Active \(3\)/);
  });

  test("choosing Active shows queued and running specs and counts them (AC-7)", () => {
    const html = page({ filter: { state: "active" } }, jobs);
    expect(html).toContain("1-a");
    expect(html).toContain("2-b");
    expect(html).toContain("3-c");
    expect(shownCount(html)).toBe(3);
    expect(optionByLabel(panelOf(html), "Active")).toContain('aria-checked="true"');
  });
});

test("several states are checkbox links that toggle their key (AC-5)", () => {
  const html = page({ filter: { state: "created,active", q: "needle", sort: "state" } });
  const panel = panelOf(html);
  expect(optionByLabel(panel, "Created")).toContain('role="checkbox" aria-checked="true"');
  expect(optionByLabel(panel, "Active")).toContain('role="checkbox" aria-checked="true"');
  const active = new URL(`http://x${optionByLabel(panel, "Active").match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&")}`);
  expect(active.searchParams.get("state")).toBe("created");
  expect(active.searchParams.get("q")).toBe("needle");
});

test("the count beside the dropdown is the number of specs the table shows, after the states and the search", () => {
  const jobs: QueueRowView[] = [
    row({ id: "a", specFolder: "1-needle-a", state: "failed", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "b", specFolder: "2-needle-b", state: "failed", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "c", specFolder: "3-hay-c", state: "failed", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "d", specFolder: "4-needle-d", state: "running", steps: ["analyze"], stepIndex: 0 }),
  ];
  const html = page({ filter: { state: "idle,active", q: "needle" } }, jobs);
  expect(shownCount(html)).toBe(3);
  expect(specRows(html)).toBe(3);
  expect(shownCount(page({}, jobs))).toBe(4);
});

describe("stateEntries", () => {
  const live = (specFolder: string, over: Partial<SpecTarget> = {}): SpecTarget => ({ project: "aide", specFolder, ...over });
  const archivedSpec = (folder: string): ArchivedSpecView =>
    ({ project: "aide", folder, done: ["create", "analyze", "implement", "archive"], models: {}, phaseOutcomes: {} });
  const counts = (
    o: { rows?: QueueRowView[]; targets?: SpecTarget[]; archived?: string[]; archivedSpecs?: ArchivedSpecView[]; closed?: string[]; notVerified?: string[] },
    f: SpecsFilter = {},
  ): Record<string, number> => {
    const groups = groupBySpec(o.rows ?? [], o.targets ?? [], o.archived, o.archivedSpecs);
    return Object.fromEntries(stateEntries(groups, f, o).map((e) => [e.key, e.count]));
  };
  const ticked = (f: SpecsFilter): string[] => stateEntries([], f, {}).filter((e) => e.on).map((e) => e.key);

  test("Active counts queued, running, landing and held-back work, and none of it as Created", () => {
    const c = counts({
      rows: [
        row({ id: "a", specFolder: "1-a", state: "running" }),
        row({ id: "b", specFolder: "2-b", state: "queued", steps: ["implement"] }),
        row({ id: "c", specFolder: "3-c", state: "done", landing: true, steps: ["implement"] }),
        row({ id: "d", specFolder: "4-d", state: "queued", errorReason: "held-back", steps: ["implement"] }),
      ],
    });
    expect(c.active).toBe(4);
    expect(c.created).toBe(0);
  });

  test("Not archived counts every live spec, and a never-run one is Created where a run one is Idle", () => {
    const c = counts({
      rows: [row({ id: "j1", specFolder: "90-has-run", state: "done" })],
      targets: [live("90-has-run"), live("90-never-run")],
    });
    expect([c.all, c["not-archived"], c.active, c.created, c.idle]).toEqual([2, 2, 0, 1, 1]);
  });

  test("the archived keys the page built no row for count under Archived and All", () => {
    const c = counts({ targets: [live("60-live")], archived: ["aide/50-archived", "aide/40-archived"] });
    expect([c.archived, c.all, c["not-archived"]]).toEqual([2, 3, 1]);
  });

  test("an archived spec whose row is built is counted once", () => {
    const c = counts({ targets: [live("60-live")], archived: ["aide/50-archived"], archivedSpecs: [archivedSpec("50-archived")] });
    expect([c.archived, c.all]).toEqual([1, 2]);
  });

  test("an unbuilt closed key counts under Closed and All, never Archived", () => {
    const c = counts({ archived: ["aide/50-archived", "aide/51-closed"], closed: ["aide/51-closed"] });
    expect([c.archived, c.closed, c.all]).toEqual([1, 1, 2]);
  });

  test("Not verified counts the live specs with a count and the unbuilt archived keys named, not every archived key", () => {
    const c = counts({
      targets: [live("10-live-with", { notVerified: 1 }), live("11-live-none")],
      archived: ["aide/20-arch-with", "aide/21-arch-none", "aide/22-arch-none"],
      notVerified: ["aide/20-arch-with"],
    });
    expect(c["not-verified"]).toBe(2);
  });

  test("a search term counts only the rows it matches and drops every unbuilt key", () => {
    const c = counts(
      {
        targets: [live("10-findme", { notVerified: 1 }), live("11-other")],
        archived: ["aide/20-arch-with", "aide/21-closed"],
        closed: ["aide/21-closed"],
        notVerified: ["aide/20-arch-with"],
      },
      { q: "findme" },
    );
    expect([c.all, c["not-verified"], c.archived, c.closed]).toEqual([1, 1, 0, 0]);
  });

  test("the entries the state value names are ticked, and All ticks every entry", () => {
    expect(ticked({ state: "created,active" })).toEqual(["active", "created"]);
    expect(ticked({ state: "all" })).toHaveLength(stateEntries([], {}, {}).length);
  });

  test.each(["done", "problem"])("an old bookmarked state=%s falls back to All", (oldKey) => {
    expect(ticked({ state: oldKey })).toEqual(ticked({ state: "all" }));
  });
});
