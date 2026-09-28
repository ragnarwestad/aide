import { describe, expect, test } from "bun:test";
import { renderSpecsPage, type SpecsPageOptions, type QueueRowView } from "../../../../../src/render";
import { row } from "../../fixtures.ts";

// Spec 289: the per-state filter chips became one dropdown, so this is
// the first test file to exercise the dropdown's OWN markup —
// `filterPills`/`FilterPill` were generic, shared markup with nothing
// dropdown-specific to test before this.
//
// Spec 374 dropped the "State:"/"States:" prefix from the closed
// trigger in favour of the chosen option's own label and count, and
// split the flat "Running" choice into one sub-entry per workflow step
// plus "all". Spec 381 collapsed that sub-menu back to the single
// "Running" entry it was before spec 374 — both changes are covered
// below.

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

const triggerOf = (panel: string): string => panel.match(/<summary[^>]*>.*?<\/summary>/)?.[0] ?? "";

describe("the Running entry (spec 381, REQ-3/REQ-4)", () => {
  const jobs: QueueRowView[] = [
    row({ id: "a", specFolder: "1-a", state: "running", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "b", specFolder: "2-b", state: "queued", steps: ["implement"], stepIndex: 0 }),
    row({ id: "c", specFolder: "3-c", state: "running", steps: ["analyze"], stepIndex: 0 }),
  ];

  test("Running counts only running or landing jobs, never a plain queued one, with no per-step option beside it (REQ-3)", () => {
    const html = page({}, jobs);
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Running")).toMatch(/Running \(2\)/);
    expect(panel).not.toMatch(/Running-\w/);
  });

  test("choosing Running shows only the running/landing specs, not the plain queued one, and the trigger reads Running (REQ-3)", () => {
    const html = page({ filter: { state: "active:all" } }, jobs);
    expect(html).toContain("1-a");
    expect(html).not.toContain("2-b");
    expect(html).toContain("3-c");
    const panel = panelOf(html);
    expect(triggerOf(panel)).toMatch(/>Running \(2\)/);
    expect(optionByLabel(panel, "Running")).toContain('aria-checked="true"');
  });

  test("the legacy bare active key behaves exactly as active:all (REQ-4)", () => {
    const withLegacy = page({ filter: { state: "active" } }, jobs);
    const withNew = page({ filter: { state: "active:all" } }, jobs);
    const triggerOfHtml = (html: string) => triggerOf(panelOf(html));
    expect(triggerOfHtml(withLegacy)).toEqual(triggerOfHtml(withNew));
    expect(optionByLabel(panelOf(withLegacy), "Running")).toContain('aria-checked="true"');
  });

  test("an old per-step key (kept in a bookmark or the aide_state cookie) renders exactly as active:all, not as All (REQ-4)", () => {
    const withOldStep = page({ filter: { state: "active:analyze" } }, jobs);
    const withNew = page({ filter: { state: "active:all" } }, jobs);
    expect(withOldStep).toContain("1-a");
    expect(withOldStep).not.toContain("2-b");
    expect(withOldStep).toContain("3-c");
    const triggerOfHtml = (html: string) => triggerOf(panelOf(html));
    expect(triggerOfHtml(withOldStep)).toEqual(triggerOfHtml(withNew));
    expect(optionByLabel(panelOf(withOldStep), "Running")).toContain('aria-checked="true"');
  });
});

describe("Kjører/Venter split on a landing job (AC-3, AC-4)", () => {
  test("a done job whose branch is still landing counts under Running, not Waiting", () => {
    const jobs: QueueRowView[] = [
      row({ id: "a", specFolder: "1-a", state: "done", landing: true, steps: ["implement"], stepIndex: 0 }),
    ];
    const html = page({}, jobs);
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Running")).toMatch(/Running \(1\)/);
    expect(optionByLabel(panel, "Waiting")).toMatch(/Waiting \(0\)/);
  });

  test("a held-back queued job counts under Waiting (AC-4's explicit held-back wording)", () => {
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
    expect(optionByLabel(panel, "Waiting")).toMatch(/Waiting \(1\)/);
  });
});

describe("old bookmarked state values fall back to All (AC-9)", () => {
  test.each(["done", "problem"])("state=%s resolves the trigger to All", (oldKey) => {
    const html = page({ filter: { state: oldKey } });
    const panel = panelOf(html);
    expect(triggerOf(panel)).toMatch(/>All \(\d+\)/);
    expect(optionByLabel(panel, "All")).toContain('aria-checked="true"');
  });
});
