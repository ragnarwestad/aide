import { describe, expect, test } from "bun:test";
import {
  renderQueuePage,
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
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
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("124-stack")],
    opts: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide"],
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  const head = (html: string, folder: string) =>
    html.match(new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0] ?? "";
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
      .split(/<t[dh]\b[^>]*>/)
      .slice(1)
      .map((s) => s.replace(/<\/t[dh]>[\s\S]*$/, ""));
  /** How many COLUMNS a row declares: a plain cell is one, a spanning
   *  cell is what it says. The number every row kind has to agree on. */
  const columnUnits = (tr: string): number =>
    [...tr.matchAll(/<t[dh]\b([^>]*)>/g)].reduce(
      (n, m) => n + Number(m[1]!.match(/colspan="(\d+)"/)?.[1] ?? 1),
      0,
    );
  /** The whole row group: the header line and the phase lines under it. */
  const group = (html: string, folder: string) =>
    html.match(
      new RegExp(
        `<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?` +
          `(?=<tr class="[^"]*spechead|</tbody>|$)`,
      ),
    )?.[0] ?? "";
  /** Where a row's one button is: the State cell, the head row's
   *  THIRD, open or shut alike (spec 157). It was a column of its own
   *  at the front of the table in spec 124, which put every button in
   *  the page's left gutter and pushed the whole table sideways; then
   *  the spec column's own spanning cell (2026-08-19); and the
   *  header's LAST cell for a shut row all along. */
  const actionCell = (chunk: string): string => {
    const headRow = chunk.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? chunk;
    return cells(headRow)[1] ?? "";
  };

  const CHOICES = [{ name: "sonnet", budgetUsd: 3 }];

  // --- the structural invariant, before any behaviour ------------------------

  // Four functions decide a row's cells (`sortableHead`, `specHeadRow`,
  // `phaseCaptionRow`, `phaseSubRows`) and nothing in the type system
  // makes them agree. A row short of a column does not fail loudly —
  // it shifts every column after it, on some rows and not others.
  test("every row kind declares the same five columns, and none is blank", () => {
    const html = renderQueuePage(
      [row({ id: "j1", specFolder: "124-stack", state: "done" })],
      "2026-08-19T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      {
        runnerAvailable: true,
        targets: [target("124-stack")],
        projects: ["aide"],
        modelChoices: CHOICES,
        filter: { open: "aide/124-stack" },
      },
    );
    const thead = html.match(/<thead><tr>.*?<\/tr><\/thead>/)?.[0] ?? "";
    const spechead = head(html, "124-stack");
    const firstSub = html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
    const firstPhase = subRow(html, "create");
    expect([thead, spechead, firstSub, firstPhase, subRow(html, "analyze")].every(Boolean)).toBe(true);
    // Six since the Created column went in (spec 317). It was five from
    // 2026-08-23, when the blank trailing column went; seven under spec
    // 165, which gave the row's AI a column of its own between the
    // phase name and the model; six-before-this when the pips moved in
    // beside the name and the Progress column went.
    for (const tr of [thead, spechead, firstSub, firstPhase]) {
      expect([tr.slice(0, 40), columnUnits(tr)]).toEqual([tr.slice(0, 40), 6]);
    }
    // And the same on every phase line after the first as well, since
    // spec 179: the AI column is a cell of each line's own, so no line
    // borrows a slot from a `rowspan` on the one above it.
    expect(columnUnits(subRow(html, "analyze"))).toBe(6);
    // No spare cell at either end since 2026-08-23: the one action a
    // shut row drew in the last column moved beside the state in spec
    // 157, and the column stood blank until it went. The header and
    // both row types end on Cost.
    expect(thead).toMatch(/data-col="cost"[\s\S]*<\/th><\/tr><\/thead>$/);
    expect(thead).not.toMatch(/<th><\/th>/);
    expect(spechead).toMatch(/data-col="cost">[\s\S]*<\/td><\/tr>$/);
    // And the phase lines lead with their own cell, hard left.
    expect(firstSub).toMatch(/^<tr class="subrow" data-caption="1"><td class="phasecell">/);
  });

  // --- spec 317: the Created column ------------------------------------------

  test("Created sits between State and Time, on the header and the spec row (REQ-1)", () => {
    const html = rows([], [target("124-stack", { createdAt: "2026-08-12T09:00:00Z" })]);
    const thead = html.match(/<thead><tr>.*?<\/tr><\/thead>/)?.[0] ?? "";
    // State ends the Spec/State pair, Time is `data-col="started"` — the
    // Created header has to fall strictly between the two.
    const stateAt = thead.indexOf(">State<");
    const createdAt_ = thead.indexOf('data-col="created"');
    const startedAt = thead.indexOf('data-col="started"');
    expect(stateAt).toBeGreaterThan(-1);
    expect(createdAt_).toBeGreaterThan(stateAt);
    expect(startedAt).toBeGreaterThan(createdAt_);

    const spechead = head(html, "124-stack");
    const stateCellAt = spechead.indexOf("badgeslot");
    const createdCellAt = spechead.indexOf('data-col="created"');
    const startedCellAt = spechead.indexOf('data-col="started"');
    expect(createdCellAt).toBeGreaterThan(stateCellAt);
    expect(startedCellAt).toBeGreaterThan(createdCellAt);
  });

  // REQ-4: the same plain YYYY-MM-DD format `archiveDateCell` already
  // draws for the Time column's archive date — not a full timestamp.
  test("a live row's Created cell shows a plain date (REQ-4)", () => {
    const html = rows([], [target("124-stack", { createdAt: "2026-08-12T09:14:00+02:00" })]);
    const spechead = head(html, "124-stack");
    const cell = spechead.slice(spechead.indexOf('data-col="created"'));
    expect(cell.slice(0, cell.indexOf("</td>"))).toContain("2026-08-12");
    expect(cell.slice(0, cell.indexOf("</td>"))).not.toContain("09:14");
  });

  // REQ-5: a spec git could not date — asked, and answered with nothing
  // — shows a dash, never a job's own time and never a crash.
  test("a spec git could not date shows the dash convention (REQ-5)", () => {
    const html = rows([], [target("124-stack", { createdAt: undefined, createdAtChecking: false })]);
    const spechead = head(html, "124-stack");
    const cell = spechead.slice(spechead.indexOf('data-col="created"'));
    expect(cell.slice(0, cell.indexOf("</td>"))).toContain("–");
  });

  // The other half of the same distinction every date cell on this page
  // draws: nothing has ASKED git yet is "checking…", not a dash.
  test("a spec nothing has asked git about yet shows checking…, not a dash", () => {
    const html = rows([], [target("124-stack", { createdAt: undefined, createdAtChecking: true })]);
    const spechead = head(html, "124-stack");
    const cell = spechead.slice(spechead.indexOf('data-col="created"'));
    const cellBody = cell.slice(0, cell.indexOf("</td>"));
    expect(cellBody).toContain("checking…");
    expect(cellBody).toContain('<span class="checking" title="checking…">');
    expect(cellBody).not.toContain("&lt;span class=&quot;checking&quot;");
  });

  // Every phase line and the caption row draw a blank placeholder cell
  // in the same column, purely for alignment (LIST_COLUMNS).
  test("phase lines and the caption row carry a blank Created cell", () => {
    const html = rows([], undefined, { modelChoices: CHOICES });
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain('<td data-col="created"></td>');
    const caption = html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(caption).toContain('<td data-col="created"></td>');
  });

  // --- criteria 1, 3, 4, 5, 15: the checkbox lives on the phase line ---------

  test("each runnable phase carries its own box, on its own line (criterion 1)", () => {
    const html = rows([]);
    const id = "rowrun-aide/124-stack";
    for (const step of ["analyze", "implement", "archive"]) {
      const line = subRow(html, step);
      expect(line).toContain(`<input type="checkbox" name="steps" value="${step}"`);
      expect(box(line, step)).toContain(`form="${id}"`);
    }
    // The browser posts checkboxes in document order, so the order the
    // LINES are drawn in is the order `steps` arrives in.
    const order = [...html.matchAll(/<input type="checkbox" name="steps" value="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["analyze", "implement", "archive"]);
  });

  // It carried no box at all until 2026-08-21 and the hole read as a
  // different kind of line. It has one now — ticked, disabled, nameless
  // — and what criterion 15 was really about survives: create is
  // history, and no press can run it again.
  test("create's box is ticked, disabled and unpostable — it is history (criterion 15)", () => {
    const line = subRow(rows([]), "create");
    expect(line).toMatch(/<input type="checkbox" value="create" checked disabled/);
    expect(line).not.toContain('name="steps" value="create"');
  });

  // REQ-2, REQ-3 (spec 386): the same switch as the New-spec page, drawn
  // on a row of its own beside the phase controls, unchecked by default.
  test("spec 386: the acceptance-not-required switch is drawn beside a spec row's phase controls, unchecked", () => {
    const html = rows([]);
    const chunk = group(html, "124-stack");
    const box = chunk.match(/<input type="checkbox"[^>]*name="acceptanceNotRequired"[^>]*>/)?.[0] ?? "";
    expect(box).not.toBe("");
    expect(box).not.toContain("checked");
    expect(box).toContain('value="1"');
    expect(box).toContain('form="rowrun-aide/124-stack"');
  });

  test("no strip of phase boxes and no controls line survive (criterion 2)", () => {
    const html = rows([], [target("124-stack")], { modelChoices: CHOICES });
    expect(html).not.toContain("data-controls");
    // The only `.phases` group left on this page is "also touches",
    // and this row has no other project to offer.
    expect(html).not.toContain('<span class="phases">');
    // Every box the row draws is on a phase line, so each is inside a
    // `<tr>` that names its own step.
    for (const m of html.matchAll(/<label class="phase[^"]*" data-phase="([^"]+)"/g)) {
      expect(subRow(html, m[1]!)).toContain(`data-phase="${m[1]}"`);
    }
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
  test("a done phase's box is ticked and locked; the State column still carries 'done' alone (spec 267, criterion 4)", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "124-stack", state: "done" })],
      [target("124-stack", { done: ["analyze"] })],
    );
    for (const step of ["analyze"]) {
      const b = box(subRow(html, step), step);
      expect(b).toContain("already done");
      expect(b).toContain("checked disabled");
      // The State column still says "done" — the box's own accessible
      // label is what changed, not this cell.
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
      expect(b).toContain('title="implement is running"');
    }
    // Nothing is offered as ticked while nothing can be started.
    expect(html).not.toContain('value="analyze" checked');
  });

  // --- criteria 6-12: the row's one action ----------------------------------

  test("the button sits beside the state; the header keeps its own cells (criterion 6)", () => {
    const html = rows([]);
    expect(actionCell(group(html, "124-stack"))).toContain(">Analyze</button>");
    // Five cells: name, state, created, started, cost. The Progress
    // column went into the name cell with the pips (2026-08-22), the
    // blank spare after Cost went on 2026-08-23 — the row ends on the
    // money — and Created joined between state and started (spec 317).
    expect(cells(head(html, "124-stack"))).toHaveLength(5);
    expect(head(html, "124-stack")).toMatch(
      /<td class="num" data-col="cost">[^<]*<\/td><\/tr>$/,
    );
  });

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
      expect(`${state}: ${html.includes("mergeform")}`).toBe(`${state}: false`);
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

  // Spec 171. The sixth phase is gone: a merge that fails is the
  // merging step's problem, not a step of its own. A conflict archive
  // could not resolve still SHOWS — the failure text names the branch —
  // but the row offers what every other failed step offers, an ordinary
  // re-run, and nothing on the page queues a `resolve` any more.
  test("no Resolve control is drawn for any errorReason (spec 171)", () => {
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
      expect(`${state}: ${cell.includes(">Resolve</button>")}`).toBe(`${state}: false`);
      expect(`${state}: ${cell.includes("resolveform")}`).toBe(`${state}: false`);
      expect(`${state}: ${cell.includes('value="resolve"')}`).toBe(`${state}: false`);
      // And the ordinary way back in is there instead: the same Run
      // control every other failed step's row carries.
      expect(`${state}: ${/<button[^>]*form="rowrun/.test(cell)}`).toBe(`${state}: true`);
    }
  });

  test("a shut row offers the same one control an open one does (criterion 12)", () => {
    // Until spec 157 a collapsed row offered the way out of a conflict
    // and nothing else. It offers whatever the open row offers now —
    // the same function draws both — minus the choosing.
    const conflicted = [
      row({ id: "j1", specFolder: "124-stack", state: "done", errorReason: "conflict" }),
    ];
    const shut = actionCell(group(rows(conflicted, [target("124-stack")], { filter: {} }), "124-stack"));
    // Since spec 171 a conflict draws no control of its own: the shut
    // row offers the same ordinary re-run the open one does.
    expect(shut).not.toContain(">Resolve</button>");
    expect(shut).toMatch(/<button[^>]*form="rowrun/);
    expect(shut).not.toContain("/cancel");
    // The choosing stays behind the fold: no boxes, no "also touches".
    // The run form itself is there as the button's carrier — a shut row
    // posts its phases as hidden fields, which is what the carrier is
    // for; the boxes a reader would tick are what stays behind the fold.
    expect(shut).not.toContain('type="checkbox"');
    expect(shut).not.toContain('name="extraProjects"');
    // A spec with every phase behind it still offers Archive: a row
    // that exists is a spec that is not archived (2026-08-21). What
    // criterion 12 is about is that the SHUT row and the OPEN one draw
    // the same one control, and that holds.
    const done = ["analyze", "implement", "archive"];
    const idle = actionCell(
      group(rows([], [target("124-stack", { done })], { filter: {} }), "124-stack"),
    );
    expect(idle).toContain(">Archive</button>");
    expect(idle).not.toContain('type="checkbox"');
  });

  // The run form itself is a carrier now: the button that submits it
  // and every box it posts are written OUTSIDE its tags, reaching it by
  // `form="…"` alone (the trick spec 123 introduced for the model).
  test("the Run form carries the hidden fields, and the button posts it by id", () => {
    const cell = actionCell(group(rows([], [target("124-stack")], { token: "s3cret" }), "124-stack"));
    expect(cell).toContain('<form id="rowrun-aide/124-stack" method="post" action="/api/queue"');
    expect(cell).toContain('name="project" value="aide"');
    expect(cell).toContain('name="specFolder" value="124-stack"');
    expect(cell).toContain('name="token" value="s3cret"');
    expect(cell).toMatch(/<button[^>]*form="rowrun-aide\/124-stack"[^>]*>Analyze<\/button>/);
    // Open, so the boxes on the phase lines are the only source of
    // `steps` — the form carries none of its own.
    expect(cell).not.toContain('name="steps"');
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
    expect(cell.match(/<button/g)).toHaveLength(1);
    expect(cell).toContain(">Cancel</button>");
  });
});
