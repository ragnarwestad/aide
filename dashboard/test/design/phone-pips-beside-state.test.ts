// A shut row's second line on a phone: the pips at the left and the
// state badge over the phases' own state column (2026-09-11). Alone at
// the left of its line the badge read as a stray, and the pips say at
// a glance what the phase lines under a shut row cannot. A desktop
// stacks the same two in the State cell, the pips over the badge.
import { describe, expect, test } from "bun:test";
import { CSS } from "../../src/render/ui/css";
import { renderSpecsRows, type SpecTarget } from "../../src/render";

const target = (specFolder: string): SpecTarget => ({ project: "aide", specFolder });
const rows = () =>
  renderSpecsRows([], { runnerAvailable: true, targets: [target("155-x")] }, Date.parse("2026-08-21T12:00:00Z"));

function narrowBlock(css: string): string {
  const opening = "@media (max-width: 40rem) {";
  const at = css.indexOf(opening);
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = at + opening.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at + opening.length, i);
  }
  throw new Error("the narrow-width media query is never closed");
}
const NARROW = narrowBlock(CSS);
const DESKTOP = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));

describe("a phone's second line is pips, then the state", () => {
  test("the head row's State cell carries the pips before the badge", () => {
    expect(rows()).toMatch(
      /<td data-col="state"><span class="pipslot"><div class="pipwrap">[\s\S]*?<\/span><span class="badgeslot">/,
    );
  });

  test("a desktop stacks them over the badge, and an open row drops them", () => {
    expect(DESKTOP).toContain("table.list tr.spechead .pipslot { display: flex; justify-content: center; margin: 0 0 var(--sp-2); padding-left: 0; }");
    expect(DESKTOP).toContain('table.list tr.spechead:has(.fold[aria-expanded="true"]) .pipslot { display: none; }');
  });

  test("a phone lays the cell out as the caption line's own three columns", () => {
    const columns =
      "grid-template-columns: calc(var(--phase-w) + var(--aimodel-w) + var(--tick-w) + 3 * var(--sp-2)) var(--state-w) calc(var(--sp-2) + var(--time-w));";
    // The caption line (action left, state right) and the shut row's
    // line (pips left, state right) share the first column's width, so
    // the state stays put when the fold opens.
    expect(NARROW).toMatch(new RegExp(`tr\\.subrow\\[data-caption="1"\\] td\\[data-col="state"\\] > \\.actionslot \\{[^}]*${columns.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\) var\\\(--state-w/, ")\\s+var\\(--state-w")}`));
    // The shut row's first column is the same sum, but gives way to a
    // long badge instead of pushing it past the screen's edge.
    const shut = "grid-template-columns: minmax(min-content, calc(var(--phase-w) + var(--aimodel-w) + var(--tick-w) + 3 * var(--sp-2))) auto;";
    expect(NARROW).toMatch(new RegExp(`tr\\.spechead > td\\[data-col="state"\\] \\{ order: 3; flex: 0 0 100%; display: grid;\\s*${shut.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    // The caption line carries the same left air, so the button and a
    // shut row's pips start at one x.
    expect(NARROW).toMatch(/td\[data-col="state"\] > \.actionslot \{[^}]*padding-left: var\(--sp-3\); box-sizing: border-box/);
    // Cancel is a form, not a bare button, and is placed the same way.
    expect(NARROW).toContain('table.list tr.subrow[data-caption="1"] .actionslot > .actionform { grid-column: 1; grid-row: 1; justify-self: start; }');
    expect(NARROW).toContain("table.list tr.spechead .pipslot { display: inline-flex; grid-column: 1; grid-row: 1; justify-self: start; justify-content: flex-start; min-width: 0; padding-left: 0; margin: 0; }");
    // The line keeps clear of both edges; the left air comes off the
    // first column so the badge's x does not move.
    expect(NARROW).toMatch(/tr\.spechead > td\[data-col="state"\] \{[^}]*padding-left: var\(--sp-3\); padding-right: var\(--sp-3\)/);
    expect(NARROW).toContain("table.list tr.spechead .badgeslot { grid-column: 2; grid-row: 1; justify-self: start; }");
  });

  // Later in the block than the head row's generic cell rules (auto
  // width, no side padding), or those win and the line shrinks to its
  // content, pushing the table past the screen's edge.
  test("the line's rules come after the generic cell rules they override", () => {
    const line = NARROW.indexOf('tr.spechead > td[data-col="state"] { order: 3;');
    expect(line).toBeGreaterThan(NARROW.indexOf("tr.spechead > td:not(:first-child) { flex: 0 0 auto;"));
    expect(line).toBeGreaterThan(NARROW.indexOf('td[data-col="state"] { padding-left: 0; padding-right: 0; }'));
  });

  test("an open row drops the whole line, not the badge alone", () => {
    expect(NARROW).toContain('table.list tr.spechead:has(.fold[aria-expanded="true"]) > td[data-col="state"] { display: none; }');
    expect(NARROW).not.toMatch(/aria-expanded="true"\]\) \.badgeslot \{ display: none/);
  });
});

// Spec 496: the row's total on the caption line, in the Time column the
// phase lines use. The figures are measured in a browser; what a unit
// test can hold is that the rules stay where they are and stay phone-only.
describe("a phone's caption line carries the total in the phase lines' Time column", () => {
  const rule = (selector: string, css: string) =>
    css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";

  test("the total is placed in the grid's third column, on the button's own grid row", () => {
    const own = rule('table.list tr.subrow[data-caption="1"] .actionslot > .headtime', NARROW);
    expect(own).toContain("grid-column: 3");
    expect(own).toContain("grid-row: 1");
    expect(own).toContain("text-align: left");
    expect(own).toContain("white-space: nowrap");
  });

  test("the state column is derived from what the Time column leaves the row", () => {
    expect(NARROW).toContain("--time-w: 3.25rem;");
    expect(NARROW).toMatch(/--state-w: min\(5\.25rem, max\(2\.5rem, calc\(100vw - [^;]*var\(--time-w\)\)\)\);/);
  });

  test("a phase line's state cell gives way to zero, and Time is a fixed, left-aligned box", () => {
    const state = rule('table.list tr.subrow[data-step] td[data-col="state"]', NARROW);
    expect(state).toContain("flex: 0 0 var(--state-w)");
    expect(state).toContain("min-width: 0");
    const time = rule('table.list tr.subrow [data-col="started"]', NARROW);
    expect(time).toContain("flex: 0 0 var(--time-w)");
    expect(time).toContain("width: var(--time-w)");
    expect(time).toContain("text-align: left");
  });

  test("the caption line's state copy is trimmed to its column", () => {
    const copy = rule('table.list tr.subrow[data-caption="1"] .actionslot > .headstate .badge', NARROW);
    expect(copy).toContain("text-overflow: ellipsis");
    expect(copy).toContain("overflow: hidden");
  });

  test("a desktop only hides the total; every other rule for it is in a phone block", () => {
    expect(DESKTOP).toContain(
      'table.list tr.subrow[data-caption="1"] .actionslot > :is(.headstate, .headtime) { display: none; }',
    );
    const desktopNames = DESKTOP.split("\n").filter((l) => l.includes(".headtime") || l.includes("--time-w"));
    expect(desktopNames).toEqual([
      'table.list tr.subrow[data-caption="1"] .actionslot > :is(.headstate, .headtime) { display: none; }',
    ]);
    expect(NARROW).toContain(".headtime");
  });
});
