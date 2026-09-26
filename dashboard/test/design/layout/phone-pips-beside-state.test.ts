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

const DESKTOP = CSS.slice(0, CSS.indexOf("@media (max-width: 40rem) {"));

describe("the header's second line is pips, then the state", () => {
  test("the pips come before the badge, each in a cell of its own", () => {
    expect(rows()).toMatch(
      /<tr class="specstate"[^>]*><td colspan="2"><span class="pipslot">[\s\S]*?<td data-col="state"><span class="badgeslot">/,
    );
  });

  test("an open row drops the pips: the phase lines say what they say", () => {
    expect(DESKTOP).toContain('table.list tr.spechead:has(.fold[aria-expanded="true"]) + tr.specstate .pipslot { display: none; }');
    const open = rows("aide/155-x");
    const line = open.match(/<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(line).toContain('data-col="state"');
  });

});
