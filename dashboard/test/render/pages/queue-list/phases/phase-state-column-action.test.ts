// Split out of phase-rules.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import {
  row,
  openKeys,
} from "../../fixtures.ts";

// --- spec 157: one action per row, and the phases hard left -----------------
//
// The first column of a row has never settled. Spec 124 gave the
// buttons a column of their own, which pushed the whole table sideways;
// 2026-08-19 moved the stack into the spec column, leading one phase
// line and spanning the rest. Spec 149 then took Merge and Approve
// away, and spec 171 took Resolve; what is left — Run and Cancel — is
// never two things
// at once. So the row draws ONE control, in the State column, right
// after the sentence it completes ("archive held back · Implement"),
// and the phase lines take the left edge the stack vacated.
//
// The button is named for the first TICKED phase, not for the state's
// own suggestion, so a reader can see the two disagree before pressing.
describe("spec 157: the row draws one action, on its caption line", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [target("157-one-action")],
    o: { open?: boolean } & Partial<QueuePageOptions> = {},
  ) => {
    // Open, because the action this describe is about is part of what
    // the fold opens. The three tests that are about a SHUT row pass
    // `open: false` for themselves.
    const { open = true, ...opts } = o;
    return renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide"],
        ...(open ? { filter: { open: openKeys(list, targets) } } : {}),
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );
  };
  const headRow = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  const cells = (tr: string): string[] =>
    [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "");
  /** The State column: the head row's second cell, which is where spec
   *  143 pinned it. The badge is what it holds. */
  const state = (html: string) => cells(headRow(html))[1] ?? "";
  /** The caption line's State cell, which is where the row's one
   *  control lives since 2026-09-08: the head line says what the spec
   *  IS, and the line that heads what it is set to do carries the
   *  press. A SHUT row has no caption line and therefore no action at
   *  all — its own test is below. */
  const captionLine = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
  const action = (html: string) => cells(captionLine(html))[2] ?? "";
  /** What the row's one control SAYS. `<button>` for Run, and the
   *  component-built one for Cancel, whose label sits
   *  after a `<span class="lbl">`-free plain text node. */
  const labels = (cell: string) => [...cell.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  const BUILT = ["analyze"];
  const ALL = ["analyze", "implement", "archive"];
  const lead = (extra: Partial<QueueRowView> = {}) =>
    row({ id: "j1", specFolder: "157-one-action", steps: ["analyze"], state: "done", ...extra });

  // --- criteria 1, 2, 3: the button is named for what is ticked -------------

  test("the next unstarted phase names the button (criterion 1)", () => {
    const html = rows([lead()], [target("157-one-action", { done: BUILT })]);
    expect(state(html)).toContain(">ready<");
    expect(labels(action(html))).toEqual(["Implement"]);
  });

  // What the fold now costs, said outright. The head line carries the
  // spec's name, its state and its numbers and nothing to press; the
  // press is one click in, on the line that heads what the spec is set
  // to do. The state is still readable shut — only the action moved.
  test("a shut row draws no action at all, and no form to carry one", () => {
    const html = rows([lead()], [target("157-one-action", { done: BUILT })], { open: false });
    expect(state(html)).toContain(">ready<");
    // Off the table alone: the search field above it has a Search
    // button, and that is not a row's action.
    expect(html.slice(html.indexOf("<tbody"))).not.toContain("<button");
    expect(html).not.toContain('class="rowrun"');
  });

  test("a fresh spec's pre-ticked phase names the button (criterion 2)", () => {
    const html = rows([]);
    // Spec 176: the badge names the next phase here as it does on a
    // row that has run something, so it agrees with the button beside
    // it rather than saying nothing.
    expect(state(html)).toContain(">ready<");
    expect(labels(action(html))).toEqual(["Analyze"]);
  });

  // Spec 176, criterion 5: the case a hardcoded "not started" got
  // wrong. A spec whose analyze ran long enough ago that its job
  // record has aged out of the queue is `g.lead === undefined` with
  // `analyze` already in `g.done` from git — and the
  // button beside the badge already read "Implement".
  test("a spec with no job left in memory still says what comes next (spec 176)", () => {
    const html = rows([], [target("157-one-action", { done: BUILT })]);
    expect(state(html)).toContain('class="badge b-ready"');
    expect(state(html)).toContain(">ready<");
    expect(state(html)).not.toContain("not started");
    expect(labels(action(html))).toEqual(["Implement"]);
  });

  // Criterion 3 said a spec with nothing ticked draws no button. Since
  // 2026-08-21 a listed spec always has `archive` ticked — the row
  // exists, so the spec is not archived — and the no-button branch is
  // reachable only where the row is busy or conflicted, both of which
  // draw a control of their own. What survives of the criterion is the
  // rule beneath it: the button names what a press would run.
  test("a spec that has run everything is offered Archive (criterion 3)", () => {
    const html = rows([lead()], [target("157-one-action", { done: ALL })]);
    expect(labels(action(html))).toEqual(["Archive"]);
  });

  // The label is the reader's own tick, not the state's suggestion, so
  // a mismatch is visible in the same line rather than after a press.
  test("a phase ticked ahead of the state's suggestion names the button", () => {
    // `done` is empty and a lead job exists, so `preTicked` is the
    // single next phase — the state and the label agree here. The
    // disagreement this spec makes visible is the other direction: a
    // spec whose files say analyze is next but whose archive was held
    // back reads "archive held back · Analyze".
    const html = rows(
      [lead({ steps: ["archive"] })],
      [target("157-one-action", { done: BUILT, archiveHeldBack: { reason: "the tree is dirty" } })],
    );
    expect(state(html)).toContain("stopped");
    expect(labels(action(html))).toEqual(["Implement"]);
  });

  // --- criteria 4, 5: Cancel names the step it would stop -------------------

  test("a running spec offers Cancel by name (criteria 4, 5)", () => {
    const html = rows(
      [lead({ steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("157-one-action", { done: BUILT })],
    );
    // Cancel, plus the OK and dismiss buttons behind the confirmation
    // it opens (spec 423).
    expect(labels(action(html))).toEqual(["Cancel", "OK", "Cancel"]);
    expect(action(html)).toContain('action="/api/queue/j1/cancel"');
    expect(action(html)).not.toContain(">Resolve<");
    // No Run button. The run FORM is still there — it is the carrier
    // the phase boxes name — but nothing submits it while a job is in
    // flight.
    expect(action(html)).not.toMatch(/<button[^>]*form="rowrun/);
  });

  test("a queued implement cancels by the reader's own word", () => {
    const html = rows(
      [lead({ steps: ["analyze", "implement"], stepIndex: 1, state: "queued" })],
      [target("157-one-action", { done: [] })],
    );
    expect(labels(action(html))).toEqual(["Cancel", "OK", "Cancel"]);
  });

  // --- criterion 12: the boxes are the only source of `steps` --------------

  // Criterion 8 gave a SHUT row's press its phases as hidden fields,
  // because such a row draws no boxes to read them off. No row does
  // now — the press only exists where the boxes do — so the hidden
  // fields are gone from every row rather than from one kind of row,
  // and the boxes are the reader's own: a hidden field beside them
  // would post every phase twice and outvote a phase just unticked.
  test("no run form carries steps of its own; the boxes do (criterion 12)", () => {
    const html = rows([], [target("157-one-action")]);
    expect(html).not.toContain('<input type="hidden" name="steps"');
    expect(html).toContain('<input type="checkbox" name="steps" value="analyze"');
  });

  // --- criterion 14: the phase lines take the left edge ---------------------

  test("no stack cell survives anywhere, open or shut (criterion 14)", () => {
    for (const open of [true, false]) {
      expect(rows([], [target("157-one-action")], { open })).not.toContain("stackcell");
    }
  });

  test("the phase line leads with its own cell, and still fills the table (criterion 14)", () => {
    const html = rows([], [target("157-one-action")], {
      open: true,
      modelChoices: [{ name: "sonnet", budgetUsd: 3 }],
    });
    const subs = [...html.matchAll(/<tr class="subrow[^"]*"[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    for (const sub of subs) {
      expect([sub.slice(0, 60), sub.indexOf('<td class="phasecell">')]).toEqual([
        sub.slice(0, 60),
        sub.indexOf("<td"),
      ]);
      // The same count on EVERY phase line since spec 179 put a picker
      // on each of them: no line borrows a slot from a `rowspan` on
      // the line above it any more. Six since Created's blank
      // placeholder cell joined the other five (spec 317).
      expect([sub.slice(0, 60), cells(sub).length]).toEqual([sub.slice(0, 60), 6]);
    }
  });

  // The phase's own state word stays under the State header, where the
  // spec's badge is: the same question at two altitudes, in one column.
  test("the phase's state word stays in the State column", () => {
    const html = rows([lead()], [target("157-one-action", { done: BUILT })], { open: true });
    const analyze = html.match(/<tr class="subrow[^"]*" data-step="analyze">[\s\S]*?<\/tr>/)![0];
    // The third cell: the phase's name, the cell holding its three
    // controls, then the state word. The Progress column stood between
    // them until 2026-08-22, when the pips moved in beside the spec's
    // name and the column went.
    expect(cells(analyze)[2]).toContain('class="badge b-done"');
    expect(cells(analyze)[1]).toContain('data-phase="analyze"');
  });

  // A shut row's action left the last column for the State column in
  // spec 157, and nothing took its place: the column stood blank on
  // every row for as long as the header declared it, and went on
  // 2026-08-23. The row ends on Cost now, whatever the state. Five
  // cells since Created joined between State and Time (spec 317).
  test("the head row ends on the cost cell whatever the state", () => {
    for (const r of [[], [lead()], [lead({ state: "running" })], [lead({ errorReason: "conflict" })]]) {
      const row = headRow(rows(r as QueueRowView[]));
      expect(cells(row)).toHaveLength(5);
      expect(row).toMatch(/data-col="cost">[\s\S]*<\/td><\/tr>$/);
    }
  });

  // Spec 159 landed with every phase in its git history — analyze,
  // implement AND archive — because the archive step DID
  // run: it made its commit and then declined to move the folder. The
  // row therefore had nothing left to suggest and drew no button at
  // all, beside a badge reading "archive held back". The one thing on
  // that row that needed a press was the one it did not offer.
  test("a held-back archive is offered again, however the history reads", () => {
    const html = rows(
      [],
      [
        target("159-ci", {
          done: ["analyze", "implement", "archive"],
          archiveHeldBack: { reason: "the first real Actions run is unwatched" },
        }),
      ],
    );
    expect(labels(action(html))).toEqual(["Archive"]);
    // And archive alone is what a press would run. Read off the boxes,
    // which are what carries `steps` now.
    const ticked = [...html.matchAll(
      /<input type="checkbox" name="steps" value="([^"]+)" checked/g,
    )].map((m) => m[1]);
    expect(ticked).toEqual(["archive"]);
  });

  // ...and so is a spec whose archive left NO held-back note. Spec 161
  // reached exactly that state hours later: the note was cleared by
  // hand, the history still said archive had run, and the row went to
  // "done — nothing waiting on you" about a spec sitting unarchived in
  // the list. A row that exists is a spec that is not archived — the
  // note is a reason, never the evidence.
  test("a listed spec offers Archive even with no held-back note", () => {
    const html = rows(
      [],
      [target("161-cleared", { done: ["analyze", "implement", "archive"] })],
    );
    expect(labels(action(html))).toEqual(["Archive"]);
  });

  // Spec 191: the two halves of that same cell were worked out apart.
  // The button read the rule above; the badge asked `g.done` raw, found
  // every phase in it, and said "done — nothing waiting on you" beside
  // a button reading "Archive". One row, two answers. Both are read
  // here, off ONE render, so they cannot drift again without this
  // failing.
  test("the badge and the button name the same phase once archive has run and declined", () => {
    const html = rows(
      [],
      [target("191-agree", { done: ["analyze", "review-plan", "implement", "archive"] })],
    );
    expect(state(html)).toContain(">ready<");
    expect(labels(action(html))).toEqual(["Archive"]);
  });

  // Spec 161's own scenario, asked of the BADGE this time: the
  // held-back note cleared by hand while the history still lists
  // archive. Clearing the reason archiving did not happen does not
  // make it have happened.
  test("a cleared held-back note leaves the badge saying archive is ready", () => {
    const html = rows(
      [],
      [target("191-cleared", { done: ["analyze", "review-plan", "implement", "archive"] })],
    );
    expect(state(html)).toContain(">ready<");
    expect(labels(action(html))).toEqual(["Archive"]);
    expect(state(html)).not.toContain("nothing waiting on you");
  });

});

// --- spec 161: a row's one action is primary, whichever it is ----------------
//
// Spec 157 built Run as a bare `.btn` on the argument that a column of
// primary buttons says nothing about which row to look at. A row draws
// exactly ONE control now, so there is no column to differentiate and
// nothing for the colour to tell apart — it only has to say the action
// is here. Cancel came along for the same reason plus one more: in dark
// mode `--danger` and `--accent` sat close enough in hue that an
// outlined Cancel and a filled button beside it said nothing different
// to the eye (looked at live, 2026-08-21) — the accent tokens moved
// since (2026-08-31), but the same hue-family closeness is the reason
// this test still exists.
describe("spec 161: the row's one action is primary", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  // Open: the row's one control rides the caption line, which is part
  // of what the fold opens (2026-09-08).
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        projects: ["aide"],
        filter: { open: openKeys(list, targets) },
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );
  /** Every button on a ROW, as its class attribute. Read off the table
   *  alone since spec 221: the search field above it has a Search button
   *  of its own, and it is not a row's action — the rule under test is
   *  about the one control a row draws. */
  const classes = (html: string): string[] =>
    [...html.slice(html.indexOf("<tbody")).matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g)].map(
      (m) => m[1] ?? "",
    );
  const lead = (extra: Partial<QueueRowView> = {}) =>
    row({ id: "j1", specFolder: "161-one-variant", steps: ["analyze"], state: "done", ...extra });

  test("the Run button is filled, not bare (criterion 5)", () => {
    const html = rows([], [target("161-one-variant")]);
    expect(classes(html)).toEqual(["btn primary"]);
  });

  test("Cancel is filled too — it is the busy row's one action (criterion 6)", () => {
    const html = rows(
      [lead({ steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("161-one-variant", { done: ["analyze"] })],
    );
    // Filled Cancel, plus the confirmation it opens (spec 423): a
    // filled OK and a bare dismiss.
    expect(classes(html)).toEqual(["btn primary", "btn primary", "btn"]);
    expect(html).not.toContain("danger");
  });

  // Resolve was the third variant here until spec 171 retired it. A
  // conflicted row now draws the ordinary Run, and it is filled like
  // every other row's one action.
  test("a conflicted row's Run is filled like any other (criterion 7)", () => {
    const html = rows(
      [lead({ errorReason: "conflict", error: "cannot merge — conflict" })],
      [target("161-one-variant", { done: ["analyze"] })],
    );
    expect(html).not.toContain(">Resolve</button>");
    expect(classes(html)).toEqual(["btn primary"]);
  });
});
