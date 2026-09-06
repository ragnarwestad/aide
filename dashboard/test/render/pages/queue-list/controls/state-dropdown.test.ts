import { describe, expect, test } from "bun:test";
import { renderQueuePage, type QueuePageOptions, type QueueRowView } from "../../../../../src/render.ts";
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

const page = (opts: Partial<QueuePageOptions> = {}, rows: QueueRowView[] = []): string =>
  renderQueuePage(rows, "2026-08-30T00:00:00Z", [{ label: "Projects", path: "/projects" }], {
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

describe("the state dropdown (spec 289)", () => {
  test("renders one details.menu.state, not six separate pill links", () => {
    const html = page();
    expect(html).toContain('<details class="menu state" data-filter="state">');
    // The old per-chip markup is gone: no standalone `.filters` group
    // for the state control.
    expect(html).not.toMatch(/<span class="filters" data-filter="state">/);
  });

  test("every option appears in order inside the panel, each a data-nav link (REQ-3, REQ-6)", () => {
    const html = page();
    const panel = panelOf(html);
    const order = ["All", "Active", "Running", "Done", "Problems", "Archived"];
    for (const label of order) expect(optionByLabel(panel, label)).not.toBe("");
    const positions = order.map((label) => panel.indexOf(optionByLabel(panel, label)));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("with no state param, All carries aria-checked=true and the trigger shows its own label and count (REQ-1)", () => {
    const html = page();
    const panel = panelOf(html);
    expect(optionByLabel(panel, "All")).toContain('aria-checked="true"');
    const trigger = triggerOf(panel);
    expect(trigger).toMatch(/>All \(\d+\)/);
  });

  test("with state=problem, Problems carries aria-checked=true and Active carries aria-checked=false", () => {
    const html = page({ filter: { state: "problem" } });
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Problems")).toContain('aria-checked="true"');
    expect(optionByLabel(panel, "Active")).toContain('aria-checked="false"');
  });

  test("the panel reports a single-choice list to assistive tech", () => {
    const html = page();
    const panel = panelOf(html);
    expect(panel).toContain('<div class="menupanel" role="radiogroup">');
    const order = ["All", "Active", "Running", "Done", "Problems", "Archived"];
    for (const label of order) {
      expect(optionByLabel(panel, label)).toContain('role="radio"');
    }
  });

  test("exactly one option carries aria-checked=true at a time", () => {
    const html = page({ filter: { state: "done" } });
    const panel = panelOf(html);
    const order = ["All", "Active", "Running", "Done", "Problems", "Archived"];
    const checked = order.filter((label) => optionByLabel(panel, label).includes('aria-checked="true"'));
    const unchecked = order.filter((label) => optionByLabel(panel, label).includes('aria-checked="false"'));
    expect(checked).toEqual(["Done"]);
    expect(unchecked).toEqual(order.filter((label) => label !== "Done"));
  });

  test("picking Done from an open=... view keeps the open key on the option's href", () => {
    const html = page({ filter: { state: "problem", open: "aide/90-x" } });
    const panel = panelOf(html);
    const doneOption = optionByLabel(panel, "Done");
    const doneHref = doneOption.match(/href="([^"]*)"/)?.[1] ?? "";
    expect(doneHref).toContain("open=aide%2F90-x");
    expect(doneHref).toContain("state=done");
  });

  test('the "(?)" popover carries the search-scope sentence, not the old runs-help text', () => {
    const html = page();
    expect(html).toContain(
      "Searches the project:folder, the title, the description — the whole " +
        "description, including the part the row does not show.",
    );
    expect(html).not.toContain("A few jobs run side by side here");
  });

  test('no class="listnote" appears anywhere on the page', () => {
    const html = page();
    expect(html).not.toContain('class="listnote"');
    expect(html).not.toContain('class="muted small listnote"');
  });

  test("a plain Search submit still carries the active state filter forward (regression guard)", () => {
    const html = page({ filter: { state: "done", q: "foo" } });
    expect(html).toContain('<input type="hidden" name="state" value="done">');
  });

  test('the "All" option carries its own explicit state=all (REQ-4, spec 338)', () => {
    const html = page({ filter: { state: "done" } });
    const panel = panelOf(html);
    const allOption = optionByLabel(panel, "All");
    const allHref = allOption.match(/href="([^"]*)"/)?.[1] ?? "";
    expect(allHref).toContain("state=all");
  });

  test('the trigger keeps "States" as its accessible title, with no "State:"/"States:" prefix in its visible text (REQ-1)', () => {
    const html = page();
    const panel = panelOf(html);
    const trigger = triggerOf(panel);
    expect(trigger).toContain('title="States"');
    expect(trigger).toContain('aria-label="States"');
    expect(trigger).not.toContain("States:");
    expect(trigger).not.toContain("State:");
  });

  test("sits on the controls line between the (?) popover and New spec (spec 305)", () => {
    const html = page({ createProjects: ["aide"] });
    const introIndex = html.indexOf('<details class="intro"');
    const stateIndex = html.indexOf('<details class="menu state"');
    const newSpecIndex = html.indexOf('<a class="btn primary"');
    expect(introIndex).toBeGreaterThan(-1);
    expect(stateIndex).toBeGreaterThan(-1);
    expect(newSpecIndex).toBeGreaterThan(-1);
    expect(stateIndex).toBeGreaterThan(introIndex);
    expect(stateIndex).toBeLessThan(newSpecIndex);
  });
});

describe("the Running entry (spec 381, REQ-3/REQ-4)", () => {
  const jobs: QueueRowView[] = [
    row({ id: "a", specFolder: "1-a", state: "running", steps: ["analyze"], stepIndex: 0 }),
    row({ id: "b", specFolder: "2-b", state: "queued", steps: ["implement"], stepIndex: 0 }),
    row({ id: "c", specFolder: "3-c", state: "running", steps: ["analyze"], stepIndex: 0 }),
  ];

  test("Running counts everything in flight, regardless of step, with no per-step option beside it (REQ-3)", () => {
    const html = page({}, jobs);
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Running")).toMatch(/Running \(3\)/);
    expect(panel).not.toMatch(/Running-\w/);
  });

  test("choosing Running shows every queued-or-running spec regardless of step, and the trigger reads Running (REQ-3)", () => {
    const html = page({ filter: { state: "active:all" } }, jobs);
    expect(html).toContain("1-a");
    expect(html).toContain("2-b");
    expect(html).toContain("3-c");
    const panel = panelOf(html);
    expect(triggerOf(panel)).toMatch(/>Running \(3\)/);
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
    expect(withOldStep).toContain("2-b");
    expect(withOldStep).toContain("3-c");
    const triggerOfHtml = (html: string) => triggerOf(panelOf(html));
    expect(triggerOfHtml(withOldStep)).toEqual(triggerOfHtml(withNew));
    expect(optionByLabel(panelOf(withOldStep), "Running")).toContain('aria-checked="true"');
  });
});
