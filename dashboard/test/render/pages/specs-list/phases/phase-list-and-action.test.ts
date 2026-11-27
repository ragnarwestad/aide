import { describe, expect, test } from "bun:test";
import { row, specTarget, openRowsAt } from "../../fixtures.ts";

// --- One phase list, and the actions in a stack of their own -------
//
// Split out of listing-and-units.test.ts by theme.
//
// An expanded row used to say its phases TWICE: a horizontal strip of
// checkboxes on the controls line (a green check behind every phase
// already done) and, two rows down, the phase lines saying "done" in
// their own State column. One fact, drawn twice with two different
// marks.
//
// The checkbox moves onto the phase's own line and drops the check;
// the controls line goes with it. The action buttons left the last
// column for a stack of their own — and left that too: ONE control is
// drawn per row, in the State column, and the
// phase lines get the left edge. What this block still guards is the half
// that did not move: one phase list, one box per line, and the six
// columns every row kind has to agree on.
describe("one phase list, and one action beside the state", () => {
  const target = specTarget;

  const rows = openRowsAt("2026-08-19T12:00:00Z", [target("124-stack")]);

  /** The whole row group: the header line and the phase lines under it. */
  const group = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the State cell of the CAPTION line
   *  since 2026-09-08 — the head line says what the spec is, and the
   *  line that heads what it is set to do carries the press. A shut row
   *  has no caption line, and therefore no action at all.
   *
   *  It has moved four times before: a column of its own at the front
   *  of the table, which put every button in the page's left
   *  gutter and pushed the whole table sideways; the spec column's own
   *  spanning cell (2026-08-19); the head row's State cell beside the
   *  badge; and the end of the name box, where the pips had
   *  been (2026-09-07). */
  const actionCell = (chunk: string): string => {
    return (chunk.match(/<span class="actionslot">([\s\S]*?)<\/span><\/span><\/td>/)?.[1] ?? "");
  };

  // --- the structural invariant, before any behaviour ------------------------

  // --- the Created column is not in the list ---------------------------------

  // --- the row's one action -------------------------------------------------

  // A merge that fails is the merging step's problem, not a
  // step of its own. A conflict archive could not resolve still SHOWS —
  // the failure text names the branch — and the row offers what every
  // other failed step offers, an ordinary re-run.
  test("a conflicted row offers the ordinary Run", () => {
    for (const state of ["done", "failed"] as const) {
      const conflicted = [
        row({
          id: "j1",
          specFolder: "124-stack",
          state,
          error: "cannot bring aide/124-stack up to date with origin/main in /repos/aide (conflict — merge it by hand)",
          errorReason: "conflict",
        }),
      ];
      const html = rows(conflicted, [target("124-stack")]);
      const cell = actionCell(group(html, "124-stack"));
      // The ordinary way back in: the same Run control every other
      // failed step's row carries.
      expect(`${state}: ${/<button[^>]*form="rowrun/.test(cell)}`).toBe(`${state}: true`);
    }
  });
});
