// Split out of phase-rules.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderSpecsRows,
  type SpecsPageOptions,
  type QueueRowView,
  type SpecTarget,
} from "../../../../../src/render";
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
  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: SpecTarget[] = [target("157-one-action")],
    o: { open?: boolean } & Partial<SpecsPageOptions> = {},
  ) => {
    // Open, because the action this describe is about is part of what
    // the fold opens. The three tests that are about a SHUT row pass
    // `open: false` for themselves.
    const { open = true, ...opts } = o;
    return renderSpecsRows(
      list,
      {
        runnerAvailable: true,
        targets,
        ...(open ? { filter: { open: openKeys(list, targets) } } : {}),
        ...opts,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );
  };
  const headRow = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>\s*<tr class="specstate"[\s\S]*?<\/tr>/)?.[0] ?? "";
  const cells = (tr: string): string[] =>
    [...tr.replace(/<td[^>]*data-col="fold"[^>]*>[\s\S]*?<\/td>/g, "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => m[1] ?? "");
  /** The State column of the header, by its column rather than its
   *  position: the header is two rows since 2026-09-22, and the chevron
   *  has a cell of its own. The badge is what it holds. */
  const state = (html: string) =>
    headRow(html).match(/<td[^>]*data-col="state"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? "";
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
    expect(state(html)).toContain(">Ready<");
    expect(labels(action(html))).toEqual(["Implement"]);
  });

  // What the fold now costs, said outright. The head line carries the
  // spec's name, its state and its numbers and nothing to press; the
  // press is one click in, on the line that heads what the spec is set
  // to do. The state is still readable shut — only the action moved.
  test("a shut row draws no action at all, and no form to carry one", () => {
    const html = rows([lead()], [target("157-one-action", { done: BUILT })], { open: false });
    expect(state(html)).toContain(">Ready<");
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
    expect(state(html)).toContain(">Ready<");
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
    expect(state(html)).toContain(">Ready<");
    expect(state(html)).not.toContain("not started");
    expect(labels(action(html))).toEqual(["Implement"]);
  });

  // Criterion 3 said a spec with nothing ticked draws no button. Since
  // 2026-08-21 a listed spec always has `archive` ticked — the row
  // exists, so the spec is not archived — and the no-button branch is
  // reachable only where the row is busy or conflicted, both of which
  // draw a control of their own. What survives of the criterion is the
  // rule beneath it: the button names what a press would run.
  //
  // Spec 439 narrows what "ticked" means here: the bare `done: ALL` this
  // test used to rely on is no longer enough on its own to make the
  // button ACTIVE — that default is now only the fallback for a spec
  // with no recorded choice at all (its own test lives under spec 439
  // below). An explicit record, the kind a real create or Run leaves
  // behind, is what a listed spec offering Archive, active, actually
  // means now.
  test("a spec whose recorded choice ticks archive is offered it, active (criterion 3, spec 439)", () => {
    const html = rows([lead()], [target("157-one-action", { done: ALL })], {
      pendingSteps: { "aide/157-one-action": ["archive"] },
    });
    expect(labels(action(html))).toEqual(["Archive"]);
    expect(action(html)).toMatch(/<button type="submit"/);
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
    expect(state(html)).toContain("Stopped");
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

  test("the phase line leads with its own cell, and still fills the table (criterion 14)", () => {
    const html = rows([], [target("157-one-action")], {
      open: true,
      modelChoices: [{ name: "sonnet" }],
    });
    const subs = [...html.matchAll(/<tr class="subrow[^"]*"[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    for (const sub of subs) {
      // The chevron's own column comes first and is empty on every line
      // but the header's (2026-09-22); the phase's own cell is the next.
      expect([sub.slice(0, 60), sub.indexOf('<td class="phasecell">')]).toEqual([
        sub.slice(0, 60),
        sub.indexOf('<td class="phasecell">'),
      ]);
      expect(sub.indexOf('<td data-col="fold">')).toBe(sub.indexOf("<td"));
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
      // Title, pips, state, time, cost, created — the chevron's cell is
      // dropped by `cells` above, and the pips gained one of their own
      // when the title took a row to itself (2026-09-22).
      expect(cells(row)).toHaveLength(6);
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
    expect(state(html)).toContain(">Ready<");
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
    expect(state(html)).toContain(">Ready<");
    expect(labels(action(html))).toEqual(["Archive"]);
    expect(state(html)).not.toContain("nothing waiting on you");
  });

});

// --- spec 439: a recorded phase choice survives the render (AC-1 - AC-5) ----
//
// `preTicked()` read git history alone and recomputed itself fresh on
// every render, so a choice made on New spec — or left on a row's own
// boxes after a later Run — was gone the moment the page next drew
// (AC-1). The action button had no room for "named, but not ticked"
// either: once analyze and implement were both done it read "Archive",
// always active, whatever the reader had actually ticked (AC-5).
// `opts.pendingSteps` is this fix's persisted answer to the first
// problem — the render layer's own read of the same table
// `pendingModels`/`pendingEffort` already keep — and `actionState()`'s
// `active` flag is its answer to the second.
describe("spec 439: a recorded phase choice survives the render (AC-1 - AC-5)", () => {
  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (targets: SpecTarget[], o: Partial<SpecsPageOptions> = {}) =>
    renderSpecsRows(
      [],
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys([], targets) },
        ...o,
      },
      Date.parse("2026-08-21T12:00:00Z"),
    );
  const cells = (tr: string): string[] =>
    [...tr.replace(/<td[^>]*data-col="fold"[^>]*>[\s\S]*?<\/td>/g, "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => m[1] ?? "");
  const captionLine = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
  const action = (html: string) => cells(captionLine(html))[2] ?? "";
  const labels = (cell: string) => [...cell.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  const ticked = (html: string): string[] =>
    [...html.matchAll(/<input type="checkbox" name="steps" value="([^"]+)" checked/g)].map((m) => m[1]!);

  test("a create-time choice with phases unticked survives the render, not every remaining phase re-ticked (AC-1)", () => {
    const html = rows([target("439-create")], {
      pendingSteps: { "aide/439-create": ["analyze"] },
    });
    // Every remaining phase (analyze, implement, archive) is what the
    // old, history-only derivation would tick — the recorded choice
    // says only analyze was asked for.
    expect(ticked(html)).toEqual(["analyze"]);
  });

  test("the button always names a not-yet-run phase, never one already done (AC-2)", () => {
    const html = rows([target("439-next", { done: ["analyze"] })], {
      pendingSteps: { "aide/439-next": ["implement"] },
    });
    expect(labels(action(html))).toEqual(["Implement"]);
  });

  test("the first not-yet-run phase, ticked, makes the button active (AC-3)", () => {
    const html = rows([target("439-active")], {
      pendingSteps: { "aide/439-active": ["analyze"] },
    });
    expect(action(html)).toMatch(/<button type="submit"/);
    expect(labels(action(html))).toEqual(["Analyze"]);
  });

  test("the first not-yet-run phase, unticked, makes the button disabled but still named (AC-3)", () => {
    const html = rows([target("439-disabled")], {
      pendingSteps: { "aide/439-disabled": [] },
    });
    expect(action(html)).toMatch(/<button type="submit"[^>]*disabled/);
    expect(labels(action(html))).toEqual(["Analyze"]);
  });

  test("a later ticked phase is named and active, ahead of an earlier unticked one (AC-4)", () => {
    const html = rows([target("439-later")], {
      pendingSteps: { "aide/439-later": ["archive"] },
    });
    expect(action(html)).toMatch(/<button type="submit"/);
    expect(labels(action(html))).toEqual(["Archive"]);
  });

  test("nothing ticked never shows Archive active, even with only archive left (AC-5)", () => {
    const html = rows([target("439-archive-disabled", { done: ["analyze", "implement"] })], {
      pendingSteps: { "aide/439-archive-disabled": [] },
    });
    expect(action(html)).toMatch(/<button type="submit"[^>]*disabled/);
    expect(labels(action(html))).toEqual(["Archive"]);
  });

  // The one explicitly-accepted gap (3-solution.md's Risk analysis): a
  // spec that predates this fix and has had no create or Run recorded
  // under it falls back to the old, history-only derivation — unchanged
  // until its own next interaction.
  test("a spec with no recorded choice at all keeps today's default: Archive active with nothing ticked", () => {
    const html = rows([target("439-fallback", { done: ["analyze", "implement"] })]);
    expect(action(html)).toMatch(/<button type="submit"/);
    expect(labels(action(html))).toEqual(["Archive"]);
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
  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  // Open: the row's one control rides the caption line, which is part
  // of what the fold opens (2026-09-08).
  const rows = (list: QueueRowView[], targets: SpecTarget[]) =>
    renderSpecsRows(
      list,
      {
        runnerAvailable: true,
        targets,
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

// --- spec 496: the caption line carries the row's total for a phone ---------
//
// The head row's Time cell is hidden on a phone; the caption line draws
// the same figure in its action slot (narrow.css lays it out), beside
// the button and the state copy. What breaks silently is the copy
// drifting from the head row's own figure, or losing the `data-elapsed`
// the page's one-second clock rewrites.
describe("spec 496: the caption line's total is the head row's own", () => {
  const NOW = "2026-08-16T12:00:00Z";
  const job = (extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id: "a1",
    project: "aide",
    specFolder: "496-total",
    steps: ["analyze", "implement"],
    stepIndex: 1,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T08:00:00Z",
    ...extra,
  });
  const target = (extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder: "496-total",
    ...extra,
  });
  const render = (list: QueueRowView[], targets: SpecTarget[], extra: Partial<SpecsPageOptions> = {}) =>
    renderSpecsRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: [{ name: "sonnet" }],
        filter: { open: `aide/496-total` },
        ...extra,
      },
      Date.parse(NOW),
    );
  const captionLine = (html: string) =>
    html.match(/<tr class="subrow" data-caption="1">[\s\S]*?<\/tr>/)?.[0] ?? "";
  const slot = (html: string) => captionLine(html).match(/<span class="actionslot">([\s\S]*?)<\/span><\/td>/)?.[1] ?? "";
  const headTime = (html: string) => captionLine(html).match(/<span class="headtime">([\s\S]*?)<\/span><\/span>(?=<\/td>)/)?.[1];
  // The header's own Time cell, which sits on the second of its two rows
  // (2026-09-22): the title has the first to itself.
  const headCell = (html: string) =>
    html.match(/<tr class="specstate"[^>]*data-folder="496-total">[\s\S]*?<\/tr>/)?.[0]
      ?.match(/<td[^>]*data-col="started"[^>]*>([\s\S]*?)<\/td>/)?.[1];

  const done = job({
    state: "done",
    startedAt: "2026-08-16T09:00:00Z",
    results: [
      { step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:05:00Z" },
      { step: "implement", ok: true, costUsd: 1, at: "2026-08-16T09:12:00Z" },
    ],
  });
  const running = job({
    state: "running",
    startedAt: "2026-08-16T11:00:00Z",
    results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T11:30:00Z" }],
  });
  const fixtures: [string, QueueRowView[], SpecTarget[]][] = [
    ["idle", [], [target()]],
    ["settled", [done], [target({ done: ["analyze", "implement"] })]],
    ["running", [running], [target()]],
  ];

  test("the slot holds the button, the state copy and the total, in that order (AC-1)", () => {
    const html = render([], [target()]);
    const inner = slot(html);
    const at = (needle: string) => inner.indexOf(needle);
    expect(at("<button")).toBeGreaterThan(-1);
    expect(at('class="headstate"')).toBeGreaterThan(at("<button"));
    expect(at('class="headtime"')).toBeGreaterThan(at('class="headstate"'));
  });

  test.each(fixtures)("a %s row's total is byte-equal to the head row's cell (AC-2)", (_name, list, targets) => {
    const html = render(list, targets);
    expect(headCell(html)).toBeDefined();
    expect(headTime(html)).toBe(headCell(html));
  });

  test("a running row's copy carries the start the page's clock counts from (AC-2)", () => {
    const html = render([running], [target()]);
    expect(headTime(html)).toMatch(/data-elapsed="2026-08-16T11:00:00\.000Z"/);
    expect(headTime(html)).toBe(headCell(html));
  });

  test("an archived row's total is the head row's own too (AC-2)", () => {
    const archived = {
      project: "aide",
      folder: "496-total",
      archivedAt: "2026-08-16T09:20:00Z",
      done: ["analyze", "implement", "archive"],
      models: {},
      phaseOutcomes: { analyze: { timeSpentMs: 5 * 60 * 1000 }, implement: { timeSpentMs: 7 * 60 * 1000 } },
    };
    const html = render([], [], { archivedSpecs: [archived], filter: { state: "archived", open: "aide/496-total" } });
    expect(headTime(html)).toBeDefined();
    expect(headTime(html)).toContain("12m");
    expect(headTime(html)).toBe(headCell(html));
  });

  test("with no model choices the state copy and the total are inside the slot, not loose in the row (AC-1)", () => {
    const html = render([], [target()], { modelChoices: [] });
    const line = captionLine(html);
    expect(line).toContain('class="headstate"');
    expect(slot(html)).toContain('class="headstate"');
    expect(slot(html)).toContain('class="headtime"');
    expect(line.indexOf('class="headstate"')).toBeLessThan(line.lastIndexOf('<td data-col="started">'));
  });
});
