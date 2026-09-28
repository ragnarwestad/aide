import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type SpecsPageOptions, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import { row, openKeys } from "../../fixtures.ts";

// --- spec 124: one phase list, and the actions in a stack of their own -------
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
// column for a stack of their own — and left that too in spec 157,
// which draws ONE control per row, in the State column, and gives the
// phase lines the left edge. What this block still guards is the half
// that did not move: one phase list, one box per line, and the six
// columns every row kind has to agree on.
describe("spec 124: one phase list, and one action beside the state", () => {
  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (
    list: QueueRowView[],
    targets: SpecTarget[] = [target("124-stack")],
    opts: Partial<SpecsPageOptions> = {},
  ) =>
    renderSpecsRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  const box = (line: string, step: string) =>
    line.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "";

  /** Every cell of one row, in order — the content between one cell's
   *  opening tag and the next one's. */
  const cells = (tr: string): string[] =>
    tr
      .replace(/<t[dh]\b[^>]*data-col="fold"[^>]*>[\s\S]*?<\/t[dh]>/g, "")
      .split(/<t[dh]\b[^>]*>/)
      .slice(1)
      .map((s) => s.replace(/<\/t[dh]>[\s\S]*$/, ""));
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
   *  of the table (spec 124), which put every button in the page's left
   *  gutter and pushed the whole table sideways; the spec column's own
   *  spanning cell (2026-08-19); the head row's State cell beside the
   *  badge (spec 157); and the end of the name box, where the pips had
   *  been (2026-09-07). */
  const actionCell = (chunk: string): string => {
    const caption = chunk.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
    return cells(caption)[2] ?? "";
  };

  // --- the structural invariant, before any behaviour ------------------------

  // --- the Created column is not in the list ---------------------------------

  // --- criteria 1, 3, 4, 5, 15: the checkbox lives on the phase line ---------

  // It carried no box at all until 2026-08-21 and the hole read as a
  // different kind of line. It has one now — ticked, disabled, nameless
  // — and what criterion 15 was really about survives: create is
  // history, and no press can run it again.
  test("create's box is ticked, disabled and unpostable — it is history (criterion 15)", () => {
    const line = subRow(rows([]), "create");
    expect(line).toMatch(/<input type="checkbox" value="create" checked disabled/);
    expect(line).not.toContain('name="steps" value="create"');
  });

  test("a spec nothing has run pre-ticks every phase (criterion 3)", () => {
    const html = rows([]);
    expect(box(subRow(html, "analyze"), "analyze")).toContain('value="analyze" checked');
    expect(box(subRow(html, "implement"), "implement")).toContain('value="implement" checked');
    expect(box(subRow(html, "archive"), "archive")).toContain('value="archive" checked');
  });

  // Spec 124's own point was that "done" should not be said twice, by
  // the State column AND a green check on the box. Spec 267 keeps that
  // rule but answers a different question with the box: not "is this
  // phase done" (the State column's job, unchanged) but "has this
  // phase run at all" — which a done phase answers yes to, ticked and
  // locked.
  test("a done phase's box can be ticked again; the State column carries 'done' (criterion 4)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "124-stack", state: "done" })],
      [target("124-stack", { done: ["analyze"] })],
    );
    for (const step of ["analyze"]) {
      const b = box(subRow(html, step), step);
      expect(b).not.toContain("checked");
      expect(b).not.toContain("disabled");
      expect(subRow(html, step)).toContain('class="badge b-done"');
    }
    expect(box(subRow(html, "implement"), "implement")).toContain('value="implement" checked');
  });

  test("the running phase's box reads ticked; the others go inert with the reason (criterion 5)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "124-stack", steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("124-stack")],
    );
    const running = box(subRow(html, "implement"), "implement");
    expect(running).toContain('class="phase checked"');
    expect(running).toContain("disabled");
    expect(running).not.toContain('class="spin"');
    for (const step of ["analyze", "archive"]) {
      const b = box(subRow(html, step), step);
      // Not in this job's steps, so unticked — and unticked is what it
      // looks like, no padlock over it (spec 145).
      expect(b).toContain('class="phase default"');
      expect(b).toContain("disabled");
      // Spec 454: the reason is not the box's own `title`.
      expect(b).not.toContain('title="Implement is running"');
    }
    // Nothing is offered as ticked while nothing can be started.
    expect(html).not.toContain('value="analyze" checked');
  });

  // --- criteria 6-12: the row's one action ----------------------------------

  test("a spec no job has ever touched offers its next phases alone (criterion 8)", () => {
    const cell = actionCell(group(rows([]), "124-stack"));
    expect(cell).toContain(">Analyze</button>");
    expect(cell).not.toContain("/approve");
    expect(cell).not.toContain("/cancel");
    expect(cell).not.toContain("/merge");
  });

  // --- spec 149: the buttons that merged and approved are gone ------------
  //
  // Every step lands the work it produced, so there is nothing left for a
  // person to merge by hand and no stop between steps to approve. The
  // routes are gone (`queue-routes.test.ts`); this is the half that says
  // nothing draws a form for them either.
  test("no row draws a Merge or an Approve, in any state (spec 149)", () => {
    for (const state of ["queued", "running", "done", "failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ id: "j1", specFolder: "124-stack", state })],
        [target("124-stack")],
      );
      expect(`${state}: ${html.includes(">Merge</button>")}`).toBe(`${state}: false`);
      expect(`${state}: ${html.includes(">Approve</button>")}`).toBe(`${state}: false`);
      expect(`${state}: ${html.includes("/merge")}`).toBe(`${state}: false`);
      expect(`${state}: ${html.includes("/approve")}`).toBe(`${state}: false`);
      // "ready to merge" stops being a state the row reports: there is
      // no press behind it any more. The branch badge says what the
      // branch is waiting FOR instead, which is not an instruction.
      expect(`${state}: ${html.includes("ready to merge")}`).toBe(`${state}: false`);
    }
  });

  test("a job with no stored reason offers the ordinary next phase", () => {
    const clean = [row({ id: "j1", specFolder: "124-stack", state: "done" })];
    const cleanCell = actionCell(group(rows(clean, [target("124-stack")]), "124-stack"));
    // One phase, not the fresh spec's pair: this spec HAS a job.
    expect(cleanCell).toContain(">Analyze</button>");
  });

  // Spec 171: a merge that fails is the merging step's problem, not a
  // step of its own. A conflict archive could not resolve still SHOWS —
  // the failure text names the branch — and the row offers what every
  // other failed step offers, an ordinary re-run.
  test("a conflicted row offers the ordinary Run (spec 171)", () => {
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

  // Criterion 12 was that the shut row and the open one drew the SAME
  // one control. A shut row draws none at all since 2026-09-08: the
  // action rides the caption line, which is part of what the fold
  // opens. What is left of the criterion is that the fold is the only
  // difference — the open row's control is the ordinary one, whatever
  // state the row is in, and the shut row is information alone.
  test("a shut row draws no control; the open one draws the ordinary Run", () => {
    const conflicted = [
      row({ id: "j1", specFolder: "124-stack", state: "done", errorReason: "conflict" }),
    ];
    const shutGroup = group(rows(conflicted, [target("124-stack")], { filter: {} }), "124-stack");
    expect(shutGroup).not.toContain("<button");
    expect(shutGroup).not.toContain('class="rowrun"');
    expect(shutGroup).not.toContain('type="checkbox"');

    // Open, the same conflicted row: no control of its own since spec
    // 171 — the ordinary re-run, and the boxes that say what it runs.
    const open = actionCell(group(rows(conflicted, [target("124-stack")]), "124-stack"));
    expect(open).not.toContain(">Resolve</button>");
    expect(open).toMatch(/<button[^>]*form="rowrun/);
    expect(open).not.toContain("/cancel");

    // A spec with every phase behind it still offers Archive: a row
    // that exists is a spec that is not archived (2026-08-21).
    const done = ["analyze", "implement", "archive"];
    const idle = actionCell(group(rows([], [target("124-stack", { done })]), "124-stack"));
    expect(idle).toContain(">Archive</button>");
  });

  // A greyed-out Run with the reason in its title was how a busy row
  // read until spec 157. One control per row now, and while a job is
  // in flight that control is Cancel — the reason is the badge beside
  // it, which says "implementing" in the same breath.
  test("no Run at all while the spec is busy — Cancel stands in its place", () => {
    const cell = actionCell(
      group(
        rows(
          [row({ id: "j1", specFolder: "124-stack", steps: ["implement"], stepIndex: 0, state: "running" })],
          [target("124-stack")],
        ),
        "124-stack",
      ),
    );
    expect(cell).not.toMatch(/<button[^>]*form="rowrun/);
    // Three buttons now (spec 423): Cancel itself, plus the OK and
    // dismiss buttons behind the confirmation it opens.
    expect(cell.match(/<button/g)).toHaveLength(3);
    expect(cell).toContain(">Cancel</button>");
  });
});
