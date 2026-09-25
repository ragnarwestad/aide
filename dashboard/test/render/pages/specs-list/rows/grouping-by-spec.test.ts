import { describe, expect, test } from "bun:test";
import { phasePips, phasesFor, renderSpecsRows, type QueueRowView } from "../../../../../src/render";
import { row, openKeys } from "../../fixtures.ts";

// The › that opens a phase's messages (spec 500) is a link in the cell; the name beside it is still plain text.
const noFold = (html: string): string => html.replace(/<a class="fold[^>]*>[\s\S]*?<\/a>/, "");

/** What a phase that has not run draws in the State column: a dash,
 *  the same one Created and Cost use for "nothing here" (2026-09-08).
 *  It said "not run yet" in words until then. */
const PHASE_NOT_RUN = "–";

// --- spec 86: one row per spec, with its phases beneath ----------------------
//
// Split out of grouping.test.ts by theme.
//
// A spec taken through analyze, implement and archive as
// three separate jobs used to occupy three rows, repeating its own name on
// every one. It is ONE spec, and how far it has got should read without
// counting rows.
describe("the queue list groups by spec (criteria 1-7, 12)", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "86-grouped", steps: [step], stepIndex: 0, state: "done", ...extra });

  // Every spec open: this block is about what an expanded row holds —
  // its phase lines, its action cell — which is what every row held
  // before spec 103 made collapsed the default.
  const rows = (list: QueueRowView[]) =>
    renderSpecsRows(
      list,
      { runnerAvailable: true, targets: [], filter: { open: openKeys(list) } },
      Date.parse("2026-08-17T12:00:00Z"),
    );

  const heads = (html: string) => html.match(/<tr class="[^"]*spechead/g) ?? [];
  // The cell for one phase, from its name to the end of the row.
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  test("two jobs for one spec make one header row, not two (criterion 1)", () => {
    const html = rows([
      job("j1", "analyze", { startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    expect(heads(html)).toHaveLength(1);
  });

  test("a phase that never ran keeps its place in the order (criterion 2)", () => {
    const html = rows([job("j1", "analyze"), job("j2", "implement")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    expect(subRow(html, "archive")).toContain(PHASE_NOT_RUN);
  });

  test("a phase that never ran is drawn like any other, not half-lit", () => {
    // Asked for 2026-08-20: a control is enabled or disabled, with
    // nothing in between. A row at 55% opacity reads as a disabled
    // control, and these boxes are not disabled — they tick, and a run
    // starts. The State column already says "not run yet" in words,
    // which is the same fact without the ambiguity.
    const html = rows([job("j1", "analyze")]);

    expect(subRow(html, "implement")).toContain(PHASE_NOT_RUN);
    expect(html).not.toContain("untried");
  });

  test("a phase run twice shows the latest attempt and the count (criterion 3)", () => {
    const html = rows([
      job("older", "analyze", { state: "failed", startedAt: "2026-08-16T09:00:00Z" }),
      job("newer", "analyze", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const analyze = subRow(html, "analyze");
    // Spec 451: the name is plain text, not a link to either attempt's
    // job page — the count beside it is what says there were two, and
    // the picker on the page is what opens the older one.
    expect(noFold(analyze)).not.toContain("<a ");
    expect(analyze).not.toContain('href="/specs/newer"');
    expect(analyze).not.toContain('href="/specs/older"');
    // The count rides with the phase's own word since 2026-09-08 — in
    // the badge when there is one, and on "not run yet" when the files
    // say nothing happened, as here: two attempts, both failed, and the
    // spec's own file still names none of them. The title repeats the
    // visible label too, since spec 480 (Round 2): a phone's fixed-width
    // state cell can ellipsis-clip the label itself.
    expect(analyze).toMatch(/title="Done \(2\) — 2 attempts" data-icon="check">Done \(2\)<\/span>/);
    expect(html.match(/data-step="analyze"/g)).toHaveLength(1);
  });

  test("the header shows what is in flight, not what finished (criterion 4)", () => {
    const html = rows([
      job("j1", "analyze", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
      job("j2", "implement", { state: "running", startedAt: "2026-08-16T09:00:00Z" }),
    ]);
    expect(heads(html)[0]).toBeDefined();
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain('class="badge b-running"');
    expect(head).not.toContain('class="badge b-done"');
  });

  test("with nothing in flight the header shows the latest outcome (criterion 5)", () => {
    const html = rows([
      job("j1", "analyze", { state: "failed", startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    // Spec 132: a resting `done` badge reads the resting state and what
    // is next, so it wears `b-ready` here. What it must not read is the
    // OLDER job's outcome, which would still be the bare word "failed".
    expect(head).toContain('class="badge b-ready"');
    expect(head).toContain(">Ready<");
    expect(head).not.toContain('class="badge b-refused"');
  });

  test("the header's cost is the whole spec's, not one job's (criterion 6)", () => {
    const html = rows([
      job("j1", "analyze", { spentUsd: 1.2 }),
      job("j2", "implement", { spentUsd: 0.8 }),
    ]);
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain("$2.00");
  });

  test("the action sits once on the caption line, never on a phase line (criterion 12)", () => {
    const html = rows([
      job("j1", "analyze", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { state: "running", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    // Four phase lines plus the caption line the action rides.
    expect(html.match(/<tr class="subrow/g)).toHaveLength(5);
    // Twice (spec 423): the outer Cancel form and the confirmation
    // dialog's own confirm form share the same route by design.
    expect(html.match(/<form method="post" action="\/api\/queue\/j2\/cancel"/g)).toHaveLength(2);
    // Cancel is the SPEC's one action and belongs on the caption line —
    // as does the form that runs the spec's phases. A phase line is
    // read-only.
    for (const phase of ["create", "analyze", "implement", "archive"]) {
      expect(subRow(html, phase)).not.toContain("/cancel");
      expect(subRow(html, phase)).not.toContain("/approve");
    }
  });

  test("two different specs keep their own header rows", () => {
    const html = rows([job("j1", "analyze"), job("j2", "analyze", { specFolder: "87-other" })]);
    expect(heads(html)).toHaveLength(2);
  });

  // Spec 116: create is the FIRST phase line, not a straggler appended
  // after archive — and it appears exactly once, never twice.
  test("a create job leads the phase list, once (spec 116, criterion 8)", () => {
    const html = rows([job("j1", "analyze"), job("j2", "create")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    expect(noFold(subRow(html, "create"))).not.toContain("<a ");
  });

  // Reopen, close, explore, manifest and schedule are steps, not phases:
  // whichever of them ran, the strip is the four.
  for (const step of ["reopen", "close", "explore", "manifest", "schedule"]) {
    test(`a ${step} job leaves the phase lines at the four (AC-1)`, () => {
      const html = rows([job("j1", "analyze"), job("j2", step)]);
      const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
      expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    });
  }

  test("a spec with a job for each of them still draws the four, and a head row with four pips (AC-1)", () => {
    const html = rows(["close", "explore", "manifest", "schedule", "reopen"].map((s, i) => job(`j${i}`, s)));
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    const jobs = ["close", "explore", "manifest", "schedule", "reopen"].map((s, i) => job(`j${i}`, s));
    const phases = phasesFor(jobs, undefined);
    expect(phases.map((p) => p.step)).toEqual(["create", "analyze", "implement", "archive"]);
    expect((phasePips(phases, []).match(/class="pip /g) ?? []).length).toBe(4);
  });

  // A failed reopen or close keeps its sentence under the row; the strip
  // above it stays the four (AC-1, AC-5).
  for (const step of ["reopen", "close"]) {
    test(`a failed ${step} keeps its sentence under the row, over four lines (AC-5)`, () => {
      const html = rows([job("j1", step, { state: "failed", error: "It did not go through." })]);
      expect(html).toContain("It did not go through.");
      const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
      expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    });
  }

  // Spec 451: all four of the fixed steps carry no link of their own.
  test("each of the four phases' names is plain text, not a link", () => {
    const html = rows([
      job("j1", "create"),
      job("j2", "analyze"),
      job("j3", "implement"),
      job("j4", "archive"),
    ]);
    for (const step of ["create", "analyze", "implement", "archive"]) {
      expect([step, noFold(subRow(html, step)).includes("<a ")]).toEqual([step, false]);
    }
  });

  // Spec 451: a phase with no attempt at all is plain text too — there
  // is nothing left that distinguishes it from one that has run.
  test("a phase with no attempt at all carries no link either", () => {
    const html = rows([job("j1", "analyze")]);
    const implement = subRow(html, "implement");
    expect(implement).toContain(PHASE_NOT_RUN);
    expect(implement).not.toContain("<a ");
  });
});

// Each spec is drawn as a card of its own, with air between (2026-09-25),
// and the air is an empty row that CLOSES a spec rather than opening the
// next: the page's own row swap takes a spec as its head row and
// everything up to the next head row, so a gap row in front of a head
// would belong to the spec above and be lost or doubled on every swap.
describe("every spec ends with its own gap row", () => {
  const html = renderSpecsRows(
    [row({ id: "a", specFolder: "1-first" }), row({ id: "b", specFolder: "2-second" })],
    { runnerAvailable: true, targets: [] },
  );

  test("one gap row per spec, spanning the whole table", () => {
    const gaps = html.match(/<tr class="specgap" aria-hidden="true"><td colspan="7"><\/td><\/tr>/g) ?? [];
    expect(gaps).toHaveLength(2);
  });

  test("the gap row comes after a spec's rows, never in front of a head row", () => {
    const order = [...html.matchAll(/<tr class="(spechead|specgap)/g)].map((m) => m[1]);
    expect(order).toEqual(["spechead", "specgap", "spechead", "specgap"]);
  });
});
