import { describe, expect, test } from "bun:test";
import { phasePips, phasesFor, renderSpecsRows, type QueueRowView } from "../../../../../src/render";
import { row, openKeys } from "../../fixtures.ts";

// The › that opens a phase's messages is a link in the cell; the name beside it is still plain text.
const noFold = (html: string): string => html.replace(/<a class="fold[^>]*>[\s\S]*?<\/a>/, "");

/** What a phase that has not run draws in the State column: a dash,
 *  the same one Created and Cost use for "nothing here" (2026-09-08).
 *  It said "not run yet" in words until then. */
const PHASE_NOT_RUN = "–";

// --- One row per spec, with its phases beneath ----------------------
//
// Split out of grouping.test.ts by theme.
//
// A spec taken through analyze, implement and archive as
// three separate jobs used to occupy three rows, repeating its own name on
// every one. It is ONE spec, and how far it has got should read without
// counting rows.
describe("the queue list groups by spec", () => {
  const job = (id: string, step: string, extra: Partial<QueueRowView> = {}): QueueRowView =>
    row({ id, specFolder: "86-grouped", steps: [step], stepIndex: 0, state: "done", ...extra });

  // Every spec open: this block is about what an expanded row holds —
  // its phase lines, its action cell — which is what every row held
  // before collapsed became the default.
  const rows = (list: QueueRowView[]) =>
    renderSpecsRows(
      list,
      { runnerAvailable: true, targets: [], filter: { open: openKeys(list) } },
      Date.parse("2026-08-17T12:00:00Z"),
    );

  const heads = (html: string) => html.match(/<tr class="[^"]*spechead/g) ?? [];
  // The cell for one phase, from its name to the end of the row.
  /** A phase's own line — an ordinary row of six cells,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  test("two jobs for one spec make one header row, not two", () => {
    const html = rows([
      job("j1", "analyze", { startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    expect(heads(html)).toHaveLength(1);
  });

  test("a phase that never ran keeps its place in the order", () => {
    const html = rows([job("j1", "analyze"), job("j2", "implement")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    expect(subRow(html, "archive")).toContain(PHASE_NOT_RUN);
  });

  test("a phase run twice shows the latest attempt and the count", () => {
    const html = rows([
      job("older", "analyze", { state: "failed", startedAt: "2026-08-16T09:00:00Z" }),
      job("newer", "analyze", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const analyze = subRow(html, "analyze");
    // The name is plain text, not a link to either attempt's
    // job page — the count beside it is what says there were two, and
    // the picker on the page is what opens the older one.
    expect(noFold(analyze)).not.toContain("<a ");
    expect(analyze).not.toContain('href="/specs/newer"');
    expect(analyze).not.toContain('href="/specs/older"');
    // The count rides with the phase's own word since 2026-09-08 — in
    // the badge when there is one, and on "not run yet" when the files
    // say nothing happened, as here: two attempts, both failed, and the
    // spec's own file still names none of them. The title repeats the
    // visible label too: a phone's fixed-width
    // state cell can ellipsis-clip the label itself.
    expect(analyze).toMatch(/title="Done \(2\) — 2 attempts" data-icon="check">Done \(2\)<\/span>/);
    expect(html.match(/data-step="analyze"/g)).toHaveLength(1);
  });

  test("the header shows what is in flight, not what finished", () => {
    const html = rows([
      job("j1", "analyze", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
      job("j2", "implement", { state: "running", startedAt: "2026-08-16T09:00:00Z" }),
    ]);
    expect(heads(html)[0]).toBeDefined();
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain('class="badge b-running"');
    expect(head).not.toContain('class="badge b-done"');
  });

  test("with nothing in flight the header shows the latest outcome", () => {
    const html = rows([
      job("j1", "analyze", { state: "failed", startedAt: "2026-08-16T09:00:00Z" }),
      job("j2", "implement", { state: "done", startedAt: "2026-08-16T11:00:00Z" }),
    ]);
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    // A resting `done` badge reads the resting state and what
    // is next, so it wears `b-ready` here. What it must not read is the
    // OLDER job's outcome, which would still be the bare word "failed".
    expect(head).toContain('class="badge b-ready"');
    expect(head).toContain(">Ready<");
    expect(head).not.toContain('class="badge b-refused"');
  });

  test("the header's cost is the whole spec's, not one job's", () => {
    const html = rows([
      job("j1", "analyze", { spentUsd: 1.2 }),
      job("j2", "implement", { spentUsd: 0.8 }),
    ]);
    const head = html.slice(html.indexOf('<tr class="'), html.indexOf('<tr class="subrow'));
    expect(head).toContain("$2.00");
  });

  test("two different specs keep their own header rows", () => {
    const html = rows([job("j1", "analyze"), job("j2", "analyze", { specFolder: "87-other" })]);
    expect(heads(html)).toHaveLength(2);
  });

  // Create is the FIRST phase line, not a straggler appended
  // after archive — and it appears exactly once, never twice.
  test("a create job leads the phase list, once", () => {
    const html = rows([job("j1", "analyze"), job("j2", "create")]);
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    expect(noFold(subRow(html, "create"))).not.toContain("<a ");
  });

  // Reopen, close, explore and schedule are steps, not phases:
  // whichever of them ran, the strip is the four.
  for (const step of ["reopen", "close", "explore", "schedule"]) {
    test(`a ${step} job leaves the phase lines at the four`, () => {
      const html = rows([job("j1", "analyze"), job("j2", step)]);
      const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
      expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    });
  }

  test("a spec with a job for each of them still draws the four, and a head row with four pips", () => {
    const html = rows(["close", "explore", "manifest", "schedule", "reopen"].map((s, i) => job(`j${i}`, s)));
    const order = [...html.matchAll(/data-step="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    const jobs = ["close", "explore", "manifest", "schedule", "reopen"].map((s, i) => job(`j${i}`, s));
    const phases = phasesFor(jobs, undefined);
    expect(phases.map((p) => p.step)).toEqual(["create", "analyze", "implement", "archive"]);
    expect((phasePips(phases, []).match(/class="pip /g) ?? []).length).toBe(4);
  });

  // A failed reopen or close keeps its sentence under the row; the strip
  // above it stays the four.
  for (const step of ["reopen", "close"]) {
    test(`a failed ${step} keeps its sentence under the row, over four lines`, () => {
      const html = rows([job("j1", step, { state: "failed", error: "It did not go through." })]);
      expect(html).toContain("It did not go through.");
      const order = [...html.matchAll(/<tr class="subrow" data-step="([^"]+)"/g)].map((m) => m[1]);
      expect(order).toEqual(["create", "analyze", "implement", "archive"]);
    });
  }
});
