// Split out of phase-controls-and-progress.test.ts by theme.

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

// --- spec 195: a phase line shows its mark and nothing else -------------------
//
// A qualifier is a sentence, and spec 108 drew it in a `<div>` under the
// phase's badge. A `<div>` is a line of its own, so a phase with
// something to say was taller than the phase above it — and everything
// below the row moved the moment a run started, stopped, or a status
// file fell out of step with the git history. Spec 176 already moved the
// stale mark and the tries count BESIDE the badge for exactly this
// reason; the qualifier is the occupant it did not touch.
//
// The sentence is not lost: it goes into the panel spec 143 built for
// "a sentence too long for a cell", named for the phase it is about.
describe("spec 195: a phase line shows its mark and nothing else", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    extra: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...extra,
      },
      Date.parse("2026-08-22T12:00:00Z"),
    );
  const panel = (html: string) => html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  const BUILT = ["analyze", "implement"];

  // Criterion 4: the ordinary case, and the one that must stay silent.
  // A phase whose file and history agree has nothing to say anywhere —
  // a panel that repeats what a badge already shows is the same clutter
  // in a new place.
  test("a phase whose file and history agree says nothing, on the line or in the panel", () => {
    const html = rows([], [target("195-agreeing", { done: ["analyze"] })]);
    expect(subRow(html, "analyze")).toContain("b-done");
    expect(subRow(html, "analyze")).not.toContain("disagree");
    expect(panel(html)).toBe("");
  });

  // Criterion 5: two phases disagreeing at once is the case
  // 1-description.md flags ("three of these can fire at once"). The
  // panel has one slot, so it states the EARLIEST phase in workflow
  // order and names it — never an arbitrary pick, and never a
  // concatenation that grows without bound.
  test("two disagreeing phases collapse to the earlier one, named", () => {
    const html = rows(
      [
        row({ id: "reanalyze", specFolder: "195-both", steps: ["analyze"], state: "cancelled" }),
        row({ id: "impl", specFolder: "195-both", steps: ["implement"], state: "done" }),
      ],
      [target("195-both", { done: ["analyze"] })],
    );
    expect(panel(html)).toContain("analyze: last re-run cancelled");
    expect(panel(html)).not.toContain("implement:");
    expect(subRow(html, "analyze")).not.toContain("last re-run cancelled");
    expect(subRow(html, "implement")).not.toContain("disagree");
  });

  // Criterion 6: the rule itself, rather than one string at a time. No
  // phase line, in any state `wordPhase()` can produce, carries a
  // block-level element — which is what made one line taller than
  // another.
  test("no phase line carries block-level free text, in any state", () => {
    const cases: { name: string; html: string; step: string }[] = [
      {
        name: "done, agreeing",
        html: rows([], [target("195-a", { done: ["analyze"] })]),
        step: "analyze",
      },
      {
        name: "done, with a re-run that disagrees",
        html: rows(
          [row({ id: "c", specFolder: "195-b", steps: ["analyze"], state: "cancelled" })],
          [target("195-b", { done: ["analyze"] })],
        ),
        step: "analyze",
      },
      {
        name: "held back",
        html: rows(
          [row({ id: "h", specFolder: "195-c", steps: ["archive"], state: "done" })],
          [target("195-c", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
        ),
        step: "archive",
      },
      {
        name: "held back, with a qualifier of its own",
        html: rows(
          [row({ id: "h2", specFolder: "195-d", steps: ["archive"], state: "failed" })],
          [target("195-d", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
        ),
        step: "archive",
      },
      {
        name: "stopped, with no attempt left to say so",
        html: rows([], [target("195-e", { done: ["analyze"], stopped: { implement: "timeout" } })]),
        step: "implement",
      },
      {
        name: "the files disagree and nothing has been attempted",
        html: rows([], [target("195-f", { done: ["analyze"], fileDisagrees: ["implement"] })]),
        step: "implement",
      },
      {
        name: "running",
        html: rows(
          [row({ id: "r", specFolder: "195-g", steps: ["analyze"], state: "running" })],
          [target("195-g")],
        ),
        step: "analyze",
      },
    ];
    for (const c of cases) {
      expect(subRow(c.html, c.step)).not.toBe("");
      expect(`${c.name}: ${subRow(c.html, c.step)}`).not.toContain('<div class="muted small">');
    }
  });

  // Criterion 7: the new producer is the LOWEST of the four. A refusal
  // answers a button the reader just pressed, and a job's own error says
  // why the row is not moving — both outrank a standing disagreement.
  test("a refusal outranks a phase's disagreement in the panel", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "195-refused", steps: ["implement"], state: "done" })],
      [target("195-refused", { done: ["analyze"] })],
      { errorSpec: "aide/195-refused", error: "a job is already queued for this spec" },
    );
    expect(panel(html)).toContain("a job is already queued for this spec");
    expect(panel(html)).not.toContain("the files disagree");
  });

  test("a job's own error outranks a phase's disagreement in the panel", () => {
    const html = rows(
      [
        row({
          id: "impl",
          specFolder: "195-errored",
          steps: ["implement"],
          state: "failed",
          error: "the specs tree is dirty: /Users/ragnar/develop/aide-specs",
        }),
      ],
      [target("195-errored", { done: ["analyze"], fileDisagrees: ["analyze"] })],
    );
    expect(panel(html)).toContain("the specs tree is dirty");
    expect(panel(html)).not.toContain("the files disagree");
  });
});

// --- spec 210: a running implement says which third it is in -----------------
//
// An implement runs for an hour and the row says only "running". Which
// of its three parts it is in — writing the failing tests, making them
// pass, or the suite afterwards — is the difference between nearly done
// and barely started. `aide-implement` already reports each boundary and
// `AideRunStore` already keeps it; nothing read it.
//
// Two readers, one field. The phase LINE says the word (`running
// (green)`); the spec head row's pip fills a third at a time. The pip's
// own width never changes — a pip that grew would move everything on the
// line beside it.
describe("spec 210: a running implement says which third it is in", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    extra: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        filter: { open: openKeys(list, targets) },
        ...extra,
      },
      Date.parse("2026-08-23T12:00:00Z"),
    );
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
/** The pips came off the specs list on 2026-09-07: what a running
   *  third says in WORDS is on the phase line, and the pips themselves
   *  — thirds included, from the same phase data — are drawn and tested
   *  on the spec page's own Overview
   *  (`spec-page-head-standing.test.ts`). */

  // Criterion 2. `green` means RED is behind it: one third of three, not
  // two. The natural-looking mapping is off by one and nothing in the
  // type system catches it, so the worked value is pinned here.
  test("a running implement in GREEN reads (green) and fills one third", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-green", steps: ["implement"], state: "running", tddPhase: "green" })],
      [target("210-green")],
    );
    expect(subRow(html, "implement")).toContain("running (green)");
  });

  // Criterion 3.
  test("a running implement in REFACTOR reads (refactor) and fills two thirds", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-ref", steps: ["implement"], state: "running", tddPhase: "refactor" })],
      [target("210-ref")],
    );
    expect(subRow(html, "implement")).toContain("running (refactor)");
  });

  // Criterion 4: zero thirds complete renders identically to "no report
  // arrived". A pip that looked 1/3 done five seconds into RED would
  // actively misinform, which is worse than saying nothing.
  test("a running implement in RED reads (red) and fills nothing", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-red", steps: ["implement"], state: "running", tddPhase: "red" })],
      [target("210-red")],
    );
    expect(subRow(html, "implement")).toContain("running (red)");
  });

  // Criterion 6: the report never arrived. Nothing throws, and the row
  // reads exactly as it does today.
  test("a running implement nobody reported on reads plain running, unfilled", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-silent", steps: ["implement"], state: "running" })],
      [target("210-silent")],
    );
    expect(subRow(html, "implement")).toContain("running");
    expect(subRow(html, "implement")).not.toContain("running (");
  });

  // Criterion 5: analyze has no phase reports and is out of scope, so
  // its rows arrive without a `tddPhase` and read as they always did.
  // WHICH steps are given one is `jobRow`'s rule and is asserted where
  // that rule lives, in queue-detail.test.ts — naming the step a second
  // time here would be a second copy of it, which is this repo's own
  // recurring cost.
  test("a running step that is not implement is untouched", () => {
    const html = rows(
      [row({ id: "an", specFolder: "210-analyze", steps: ["analyze"], state: "running" })],
      [target("210-analyze")],
    );
    expect(subRow(html, "analyze")).toContain("running");
    expect(subRow(html, "analyze")).not.toContain("running (");
  });

  // A job WAITING to start is in no TDD phase at all. Its own trap:
  // `inFlight` — what the phase word branches on — is queued OR
  // running, so a leftover report would have read "queued (refactor)".
  test("a queued implement carrying a phase still reads plain queued", () => {
    const html = rows(
      [row({ id: "impl", specFolder: "210-waiting", steps: ["implement"], state: "queued", tddPhase: "green" })],
      [target("210-waiting")],
    );
    expect(subRow(html, "implement")).toContain("queued");
    expect(subRow(html, "implement")).not.toContain("(green)");
  });

  // Criterion 7: the phase is over. A stale entry from the session it
  // once used must not fill a pip for a run that has stopped, nor
  // qualify a word that is no longer "running".
  test("an implement that is NOT running ignores a leftover phase", () => {
    for (const state of ["queued", "done", "failed", "stopped", "cancelled", "interrupted"] as const) {
      const html = rows(
        [row({ id: "impl", specFolder: "210-over", steps: ["implement"], state, tddPhase: "refactor" })],
        [target("210-over")],
      );
      expect(subRow(html, "implement")).not.toContain("(refactor)");
    }
  });
});
