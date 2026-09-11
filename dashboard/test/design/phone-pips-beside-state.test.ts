// A shut row's second line on a phone: the pips at the left and the
// state badge over the phases' own state column (2026-09-11). Alone at
// the left of its line the badge read as a stray, and the pips say at
// a glance what the phase lines under a shut row cannot. A desktop
// stacks the same two in the State cell, the pips over the badge.
import { describe, expect, test } from "bun:test";
import { CSS } from "../../src/render/ui/css.ts";
import { renderQueueRows, type QueueTarget } from "../../src/render.ts";

const target = (specFolder: string): QueueTarget => ({ project: "aide", specFolder });
const rows = () =>
  renderQueueRows([], { runnerAvailable: true, targets: [target("155-x")] }, Date.parse("2026-08-21T12:00:00Z"));

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

  test("a phone lays the cell out as the caption line's own two columns", () => {
    const columns = "grid-template-columns: calc(4.7rem + 8rem - 10px + 2.5rem + 3 * var(--sp-2) - var(--sp-3)) 1fr;";
    // The caption line (action left, state right) and the shut row's
    // line (pips left, state right) share the first column's width, so
    // the state stays put when the fold opens.
    expect(NARROW).toMatch(new RegExp(`tr\\.subrow\\[data-caption="1"\\] td\\[data-col="state"\\] > \\.actionslot \\{[^}]*${columns.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    // The shut row's first column is the same sum, but gives way to a
    // long badge instead of pushing it past the screen's edge.
    const shut = "grid-template-columns: minmax(min-content, calc(4.7rem + 8rem - 10px + 2.5rem + 3 * var(--sp-2) - var(--sp-3))) auto;";
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
