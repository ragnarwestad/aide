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

describe("the Running entry", () => {
  const jobs: QueueRowView[] = [
    row({ id: "a", specFolder: "1-a", state: "running", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "b", specFolder: "2-b", state: "queued", steps: ["implement"], stepIndex: 0 }),
    row({ id: "c", specFolder: "3-c", state: "running", steps: ["analyze"], stepIndex: 0 }),
  ];

  test("Running counts only running or landing jobs, never a plain queued one, with no per-step option beside it", () => {
    const html = page({}, jobs);
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Running")).toMatch(/Running \(2\)/);
    expect(panel).not.toMatch(/Running-\w/);
  });

  test("choosing Running shows only the running/landing specs, not the plain queued one, and counts them", () => {
    const html = page({ filter: { state: "active:all" } }, jobs);
    expect(html).toContain("1-a");
    expect(html).not.toContain("2-b");
    expect(html).toContain("3-c");
    expect(shownCount(html)).toBe(2);
    expect(optionByLabel(panelOf(html), "Running")).toContain('aria-checked="true"');
  });

  test("the legacy bare active key behaves exactly as active:all", () => {
    const withLegacy = page({ filter: { state: "active" } }, jobs);
    const withNew = page({ filter: { state: "active:all" } }, jobs);
    expect(shownCount(withLegacy)).toBe(shownCount(withNew));
    expect(optionByLabel(panelOf(withLegacy), "Running")).toContain('aria-checked="true"');
  });

  test("an old per-step key (kept in a bookmark or the aide_state cookie) renders exactly as active:all, not as All", () => {
    const withOldStep = page({ filter: { state: "active:analyze" } }, jobs);
    const withNew = page({ filter: { state: "active:all" } }, jobs);
    expect(withOldStep).toContain("1-a");
    expect(withOldStep).not.toContain("2-b");
    expect(withOldStep).toContain("3-c");
    expect(shownCount(withOldStep)).toBe(shownCount(withNew));
    expect(optionByLabel(panelOf(withOldStep), "Running")).toContain('aria-checked="true"');
  });
});

describe("Running and settled spec progress", () => {
  test("a done job whose branch is still landing counts under Running", () => {
    const jobs: QueueRowView[] = [
      row({ id: "a", specFolder: "1-a", state: "done", landing: true, steps: ["implement"], stepIndex: 0 }),
    ];
    const html = page({}, jobs);
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Running")).toMatch(/Running \(1\)/);
    expect(optionByLabel(panel, "Created")).toMatch(/Created \(0\)/);
  });

  test("a held-back queued job keeps the spec at Created", () => {
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
    expect(optionByLabel(panel, "Created")).toMatch(/Created \(1\)/);
  });
});

describe("old bookmarked state values fall back to All", () => {
  test.each(["done", "problem"])("state=%s resolves to All", (oldKey) => {
    const html = page({ filter: { state: oldKey } });
    expect(optionByLabel(panelOf(html), "All")).toContain('aria-checked="true"');
  });
});

test("several states are checkbox links that toggle their key (AC-14)", () => {
  const html = page({ filter: { state: "created,running", q: "needle", sort: "state" } });
  const panel = panelOf(html);
  expect(optionByLabel(panel, "Created")).toContain('role="checkbox" aria-checked="true"');
  expect(optionByLabel(panel, "Running")).toContain('role="checkbox" aria-checked="true"');
  const running = new URL(`http://x${optionByLabel(panel, "Running").match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&")}`);
  expect(running.searchParams.get("state")).toBe("created");
  expect(running.searchParams.get("q")).toBe("needle");
});

test("the count beside the dropdown is the number of specs the table shows, after the states and the search", () => {
  const jobs: QueueRowView[] = [
    row({ id: "a", specFolder: "1-needle-a", state: "failed", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "b", specFolder: "2-needle-b", state: "stopped", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "c", specFolder: "3-hay-c", state: "failed", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "d", specFolder: "4-needle-d", state: "running", steps: ["analyze"], stepIndex: 0 }),
  ];
  const html = page({ filter: { state: "created,running", q: "needle" } }, jobs);
  expect(shownCount(html)).toBe(3);
  expect(specRows(html)).toBe(3);
  expect(shownCount(page({}, jobs))).toBe(4);
});
