// The header's second line: the pips first, then the state badge, then
// the figures. One shape at every width since 2026-09-22 — the title has
// a row to itself and this is the row under it, so the phone no longer
// builds the two lines by hand out of one row's cells.
//
// Alone at the left of its line the badge read as a stray, and the pips
// say at a glance what the phase lines under a shut row cannot.
import { describe, expect, test } from "bun:test";
import { CSS } from "../../../src/render/ui/css";
import { renderSpecsRows, type SpecTarget } from "../../../src/render";

const target = (specFolder: string): SpecTarget => ({ project: "aide", specFolder });
const rows = (open = "") =>
  renderSpecsRows(
    [],
    { runnerAvailable: true, targets: [target("155-x")], filter: { open } },
    Date.parse("2026-08-21T12:00:00Z"),
  );

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

describe("the header's second line is pips, then the state", () => {
  test("the pips come before the badge, each in a cell of its own", () => {
    expect(rows()).toMatch(
      /<tr class="specstate"[^>]*><td colspan="2"><span class="pipslot">[\s\S]*?<td data-col="state"><span class="badgeslot">/,
    );
  });

  // The markup is the same at every width, so the order above is the
  // order a phone gets too — what differs is only that the table's last
  // three columns are zero wide there, so the figures fall in beside the
  // badge instead of standing under their own headings.
  test("the line is a flex row on a phone, and the table's own columns elsewhere", () => {
    expect(NARROW).toContain("table.list tr.specstate { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }");
    expect(DESKTOP).not.toContain("tr.specstate { display: flex");
  });

  test("the pips start where the title above them starts, not at the row's edge", () => {
    // No padding of their own: the chevron's column is what sets the
    // left edge for both, so the two line up by the table rather than by
    // a length written down twice.
    expect(DESKTOP).toContain("table.list tr.specstate .pipslot { display: flex; justify-content: flex-start; margin: 0; padding-left: 0; }");
    expect(DESKTOP).toMatch(/col\[data-col="fold"\] \{ width: [\d.]+%; \}/);
  });

  test("an open row drops the pips: the phase lines say what they say", () => {
    expect(DESKTOP).toContain('table.list tr.spechead:has(.fold[aria-expanded="true"]) + tr.specstate .pipslot { display: none; }');
    const open = rows("aide/155-x");
    const line = open.match(/<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(line).toContain('data-col="state"');
  });

  test("a phone drops the whole line when the row is open, not the badge alone", () => {
    expect(NARROW).toContain('table.list tr.spechead:has(.fold[aria-expanded="true"]) + tr.specstate > td[data-col="state"] { display: none; }');
    expect(NARROW).not.toMatch(/aria-expanded="true"\]\) \.badgeslot \{ display: none/);
  });

});
