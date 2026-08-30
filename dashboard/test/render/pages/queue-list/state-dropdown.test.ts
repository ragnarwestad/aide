import { describe, expect, test } from "bun:test";
import { renderQueuePage, type QueuePageOptions } from "../../../../src/render.ts";

// Spec 289: the per-state filter chips became one dropdown, so this is
// the first test file to exercise the dropdown's OWN markup —
// `filterPills`/`FilterPill` were generic, shared markup with nothing
// dropdown-specific to test before this.

const page = (opts: Partial<QueuePageOptions> = {}): string =>
  renderQueuePage([], "2026-08-30T00:00:00Z", [{ label: "Projects", path: "/projects" }], {
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

describe("the state dropdown (spec 289)", () => {
  test("renders one details.menu.state, not six separate pill links", () => {
    const html = page();
    expect(html).toContain('<details class="menu state" data-filter="state">');
    // The old per-chip markup is gone: no standalone `.filters` group
    // for the state control (`unitControl()`'s Units switch is the
    // remaining `.filters` user, and it carries no `data-filter="state"`).
    expect(html).not.toMatch(/<span class="filters" data-filter="state">/);
  });

  test("all six options appear in order inside the panel, each a data-nav link", () => {
    const html = page();
    const panel = panelOf(html);
    const order = ["Active", "All", "Running", "Done", "Problems", "Archived"];
    for (const label of order) expect(optionByLabel(panel, label)).not.toBe("");
    const positions = order.map((label) => panel.indexOf(optionByLabel(panel, label)));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("with no state param, Active carries aria-current and the trigger shows no count", () => {
    const html = page();
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Active")).toContain('aria-current="true"');
    const trigger = panel.match(/<summary[^>]*>.*?<\/summary>/)?.[0] ?? "";
    expect(trigger).toContain("State");
    expect(trigger).toContain("Active");
    // The count sits on each OPTION, never on the closed trigger.
    expect(trigger).not.toMatch(/Active\s*\(/);
  });

  test("with state=problem, Problems carries aria-current and Active does not", () => {
    const html = page({ filter: { state: "problem" } });
    const panel = panelOf(html);
    expect(optionByLabel(panel, "Problems")).toContain('aria-current="true"');
    expect(optionByLabel(panel, "Active")).not.toContain("aria-current");
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
});
