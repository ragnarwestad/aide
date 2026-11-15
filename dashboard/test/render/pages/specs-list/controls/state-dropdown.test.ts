import { describe, expect, test } from "bun:test";
import { renderSpecsPage, type SpecsPageOptions, type QueueRowView } from "../../../../../src/render";
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

describe("Active and settled spec progress", () => {
  test("a done job whose branch is still landing counts under Active", () => {
    const jobs: QueueRowView[] = [
      row({ id: "a", specFolder: "1-a", state: "done", landing: true, steps: ["implement"], stepIndex: 0 }),
    ];
    const html = page({}, jobs);
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Active")).toMatch(/Active \(1\)/);
    expect(optionByLabel(panel, "Created")).toMatch(/Created \(0\)/);
  });

  test("a held-back queued job is Active", () => {
    const jobs: QueueRowView[] = [
      row({
        id: "a",
        specFolder: "1-a",
        state: "queued",
        errorReason: "held-back",
        steps: ["implement"],
        stepIndex: 0,
      }),
    ];
    const html = page({}, jobs);
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Active")).toMatch(/Active \(1\)/);
  });
});

describe("old bookmarked state values fall back to All", () => {
  test.each(["done", "problem"])("state=%s resolves to All", (oldKey) => {
    const html = page({ filter: { state: oldKey } });
    expect(optionByLabel(panelOf(html), "All")).toContain('aria-checked="true"');
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
    row({ id: "b", specFolder: "2-needle-b", state: "stopped", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "c", specFolder: "3-hay-c", state: "failed", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "d", specFolder: "4-needle-d", state: "running", steps: ["analyze"], stepIndex: 0 }),
  ];
  const html = page({ filter: { state: "idle,active", q: "needle" } }, jobs);
  expect(shownCount(html)).toBe(3);
  expect(specRows(html)).toBe(3);
  expect(shownCount(page({}, jobs))).toBe(4);
});
