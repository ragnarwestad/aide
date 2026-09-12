// Split out of phase-rules.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueueRows,
  type JobDetailView,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import {
  generatedAt,
  NAV,
  detail,
  row,
  openKeys,
} from "../../fixtures.ts";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../../../src/project/parse-status.ts";

/** What a phase that has not run draws in the State column: a dash,
 *  the same one Created and Cost use for "nothing here" (2026-09-08).
 *  It said "not run yet" in words until then. */
const PHASE_NOT_RUN = "–";

/** One phase line's State cell. The dash means "nothing here" in four
 *  columns now — State, Created, Cost and Time — so a match over the
 *  whole line no longer says which column drew it. */
const stateCell = (line: string): string =>
  line.match(/<td data-col="state">.*?<\/td>/)?.[0] ?? "";

// --- spec 108: one rule for what a phase shows -------------------------------

// The row for spec 81 said three things at once: pips and phase lines
// read the JOB HISTORY (a July analysis re-run, cancelled, spoke for an
// analysis that was long since done and merged), the checkbox read the
// files unioned with that same history, and archive read "done" from a
// job that had finished without moving anything.
//
// One rule now, for every phase: the FILES say what has happened, the
// last attempt is a qualifier when it disagrees, and archive says "held
// back" with its reason when a run declined to move the folder.
describe("spec 108: one rule per phase", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[]) =>
    renderQueueRows(
      list,
      { runnerAvailable: true, targets, filter: { open: openKeys(list, targets) } },
      Date.parse("2026-08-19T12:00:00Z"),
    );
  const head = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** The Run button's own line, under the header since spec 109. */
  /** Everything one row draws: its header line and, when it is open,
   *  the phase lines under it — where the boxes live since spec 124. */
  const runLine = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** The row's one panel (spec 143), which is where every sentence a
   *  phase used to write under its own badge is said instead (spec 195). */
  const panel = (html: string) => html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  // The pips came off the list on 2026-09-07 — the button's own label
  // says how far a linear workflow has come, and the phase LINES say
  // each phase's own state in words. Every assertion that read a pip
  // here reads that line's badge instead; the pips themselves are still
  // drawn, and still tested, on the spec page's own Overview.
  // The two phases that CAN be true from the files, for a spec whose
  // only open question is archive.
  const BUILT = ["analyze", "implement"];

  test("a phase the files show done, with no job ever queued, reads done (criterion 1)", () => {
    const html = rows([], [target("108-hand-analysed", { done: ["analyze"] })]);
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain("b-done");
    expect(stateCell(analyze)).not.toContain(PHASE_NOT_RUN);
    expect(analyze).not.toContain("last re-run");
  });

  // The only motion on the page marks the one thing that is happening:
  // it was the `now` pip until 2026-09-07 and is the running badge now
  // (`badgepulse`). Draw it for a spec with nothing running and the
  // closed row says a phase is alive when none is.
  test("a spec with nothing running carries no running mark", () => {
    const html = rows([], [target("108-hand-analysed", { done: ["analyze"] })]);
    expect(head(html)).toContain("badgeslot");
    expect(head(html)).not.toContain("b-running");
  });

  test("a cancelled re-run never overturns a finished analysis (criterion 2)", () => {
    const html = rows(
      [row({ id: "recancelled", specFolder: "108-recancelled", steps: ["analyze"], state: "cancelled" })],
      [target("108-recancelled", { done: ["analyze"] })],
    );
    const analyze = subRow(html, "analyze");
    expect(analyze).toContain("b-done");
    // Spec 195: the qualifier is a sentence, and a sentence under a
    // badge makes one phase line taller than the ones beside it. The
    // row's panel says it instead — named for the phase it is about.
    expect(analyze).not.toContain("last re-run cancelled");
    expect(panel(html)).toContain("analyze last re-run cancelled");
  });

  // Criterion 3's "Run again" wording was retired 2026-08-19, and the
  // bare word "Run" with it (spec 157): the button is named for the
  // phase a press would run, which says what "again" was groping for
  // and cannot be wrong at the edges.
  test("with every phase but archive done the button is named for archive", () => {
    const html = rows([], [target("108-ready", { done: BUILT })]);
    expect(subRow(html, "archive")).toContain(PHASE_NOT_RUN);
    expect(runLine(html)).not.toContain("Run again");
    expect(runLine(html)).toContain(">Archive</button>");
  });

  test("an archive run that declined reads held back, not done (criterion 4)", () => {
    const html = rows(
      [row({ id: "declined", specFolder: "108-held", steps: ["archive"], state: "done" })],
      [
        target("108-held", {
          done: BUILT,
          archiveHeldBack: { reason: "the Slack webhook (Phase 4, still unchecked)" },
        }),
      ],
    );
    const archive = subRow(html, "archive");
    expect(archive).toContain("held back");
    // Spec 143: the REASON is the row's panel's, said once for the
    // whole row. The phase line keeps the word that is its own answer.
    expect(archive).not.toContain("the Slack webhook (Phase 4, still unchecked)");
    expect(html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "").toContain(
      "the Slack webhook (Phase 4, still unchecked)",
    );
    // The one thing it must never read as, which is what it read as
    // before this spec: an ordinary finished step.
    expect(archive).not.toContain("b-done");
  });

  // Spec 291's acceptance-criteria note reads straight off the file,
  // whether or not archive was ever attempted — so while implement is
  // still running, the Acceptance criteria are of course not all
  // ticked yet, and that must not read as archive being "held back"
  // for something well before archive is even next (reported live on
  // spec 298, 2026-08-31).
  test("archive does not read held back while implement is still running", () => {
    const html = rows(
      [row({ id: "implementing", specFolder: "298-implementing", steps: ["implement"], state: "running" })],
      [target("298-implementing", { done: ["analyze"], archiveHeldBack: { reason: ACCEPTANCE_CRITERIA_UNTICKED_NOTE } })],
    );
    const archive = subRow(html, "archive");
    expect(archive).not.toContain("held back");
    expect(archive).toContain(PHASE_NOT_RUN);
  });

  test("an archive run in flight outranks a stale held-back note (criterion 6)", () => {
    const html = rows(
      [row({ id: "retry", specFolder: "108-retry", steps: ["archive"], state: "running" })],
      [target("108-retry", { done: BUILT, archiveHeldBack: { reason: "the Slack webhook" } })],
    );
    expect(subRow(html, "archive")).toContain("b-running");
  });

  // Spec 418: the flat "the files disagree" sentence split into two,
  // on the one signal that already tells them apart — whether a
  // completion commit for the step exists anywhere in git
  // (`historyDone`).
  test("REQ-1: a finished implement job whose commit is on the branch says archiving merges it in (criterion 8)", () => {
    const html = rows(
      [row({ id: "lagging", specFolder: "108-lagging", steps: ["implement"], state: "done" })],
      [target("108-lagging", { done: ["analyze"], historyDone: ["implement"] })],
    );
    const implement = subRow(html, "implement");
    // Green: the step did its work, and the commit proves it. Only a
    // later step (archive) has anything left to do — amber here read as
    // a fault in a phase that had none (2026-09-11).
    expect(implement).toContain("b-done");
    expect(implement).not.toContain("b-waiting");
    // Never silently hidden — and never on the line either, since spec
    // 195: the row's panel is where the sentence goes, named for the
    // phase it is about.
    expect(implement).not.toContain("its work is on the branch");
    expect(panel(html)).toContain(
      "implement Last run reported done — its work is on the branch, and archiving merges it in",
    );
  });

  test("REQ-2: a finished implement job with no commit anywhere says run it again (criterion 8)", () => {
    const html = rows(
      [row({ id: "unwritten", specFolder: "108-unwritten", steps: ["implement"], state: "done" })],
      [target("108-unwritten", { done: ["analyze"] })],
    );
    const implement = subRow(html, "implement");
    expect(implement).not.toContain("b-done");
    expect(implement).not.toContain("run it again");
    expect(panel(html)).toContain(
      "implement Last run reported done, but nothing reached the files — run it again",
    );
  });

  // A graceful decline — `not-implemented-yet`, `acceptance-criteria-
  // unticked` — leaves the queue's own attempt reading `"done"`, since
  // nothing failed; only the commit records the real reason (spec
  // 299). Ticking every box removes the held-back note that used to
  // mask this and reach the branch above instead, reading as an
  // unexplained disagreement about a run that said exactly what
  // happened.
  test("a gracefully declined archive says so, not that the files disagree (spec 299)", () => {
    const html = rows(
      [row({ id: "declined", specFolder: "299-declined", steps: ["archive"], state: "done" })],
      [target("299-declined", { done: ["analyze"], stopped: { archive: "acceptance-criteria-unticked" } })],
    );
    const archive = subRow(html, "archive");
    expect(archive).toContain("stopped");
    expect(archive).not.toContain("acceptance-criteria-unticked");
    // The reason is a sentence with a move in it, not the script's own
    // token: a reader should not have to know what the token means.
    expect(panel(html)).toContain("stopped: The Acceptance criteria are not all ticked — tick them on the Checks tab");
    expect(panel(html)).not.toContain("acceptance-criteria-unticked");
    expect(panel(html)).not.toContain("archive: last run reported done, but the files disagree");
  });

  test("a decline nobody has written a sentence for is said plainly, not hidden", () => {
    const html = rows(
      [row({ id: "odd", specFolder: "299-odd", steps: ["archive"], state: "done" })],
      [target("299-odd", { done: ["analyze"], stopped: { archive: "something-new" } })],
    );
    expect(panel(html)).toContain("stopped: something-new");
  });

  test("the job page's Steps tab says held back where the row does (criterion 5)", () => {
    const archiveRun = (extra: Partial<JobDetailView> = {}): JobDetailView =>
      detail({
        id: "job-archive",
        steps: ["archive"],
        state: "done",
        results: [
          {
            step: "archive", ok: true, costUsd: 0.51, costMeasured: true,
            terminalReason: "completed", at: "2026-08-19T10:01:00Z",
          },
        ],
        ...extra,
      });
    const held = renderJobDetailPage(
      archiveRun({ archiveHeldBack: "the Slack webhook (Phase 4, still unchecked)" }),
      generatedAt,
      NAV,
      { tab: "steps" },
    );
    expect(held).toContain("held back — the Slack webhook (Phase 4, still unchecked)");
    expect(held).not.toContain("<td>ok</td>");

    // Without a reason the table is exactly what it always was.
    const plain = renderJobDetailPage(archiveRun(), generatedAt, NAV, { tab: "steps" });
    expect(plain).toContain("<td>ok</td>");
    expect(plain).not.toContain("held back");
  });
});
// --- spec 114: a spec with an unmerged dependency says so on the row ---------

// Spec 114 put a badge here — "after 106", one per dependency whose
// branch was still unmerged — so the row said what it was waiting on.
// Taken out again 2026-08-20: the title line already says "depends on
// <folder>" (spec 110) one cell to the left, and the two stood side by
// side saying nearly the same words about the same fact. The state cell
// is the sentence and nothing else again.
describe("a dependency is named once, on the title line, and not in the state cell", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (list: QueueRowView[], targets: QueueTarget[] = []) =>
    renderQueueRows(list, { runnerAvailable: true, targets }, Date.parse("2026-08-19T12:00:00Z"));
  const rowHtml = (html: string, folder: string) =>
    html.match(
      new RegExp(`<tr class="[^"]*spechead[^"]*"[^>]*data-folder="${folder}">[\\s\\S]*?</tr>`),
    )?.[0] ?? "";
  const hintCell = (html: string, folder: string) =>
    (rowHtml(html, folder).split("<td")[3] ?? "").match(
      /<div class="muted small">([\s\S]*?)<\/div><\/td>/,
    )?.[1] ?? "";
  const unmerged = (specFolder: string) => row({ specFolder, state: "done" });

  test("an unmerged dependency puts nothing in the state cell", () => {
    const html = rows([unmerged("106-x")], [target("106-x"), target("114-b", { dependsOn: ["106"] })]);

    expect(hintCell(html, "114-b")).not.toContain("after");
    // The whole cell is the sentence, and nothing else.
    expect(hintCell(html, "114-b")).toMatch(/^[^<]*$/);
  });

  test("the title line still says what the spec builds on", () => {
    const html = rows([unmerged("106-x")], [target("106-x"), target("114-b", { dependsOn: ["106"] })]);

    expect(rowHtml(html, "114-b")).toContain("depends on: 106");
  });
});

// A dash means one thing on this page: no value, because nothing ran.
// A phase whose own attempt reported done — its work on the branch, or
// nothing written at all — HAS run, and the Time column beside it draws
// that run's duration, so its State cell must not read as never run.
describe("a phase that ran never draws the not-run dash", () => {
  const TARGET: QueueTarget = { project: "aide", specFolder: "419-ran-but-unlanded" };
  const render = (historyDone: boolean): string =>
    renderQueueRows(
      [
        row({
          id: "j1",
          specFolder: "419-ran-but-unlanded",
          steps: ["implement", "archive"],
          stepIndex: 1,
          state: "queued",
          results: [
            {
              step: "implement",
              ok: true,
              costUsd: 0,
              at: "2026-09-09T08:35:25.886Z",
              startedAt: "2026-09-09T08:35:24.029Z",
            },
          ],
        }),
      ],
      {
        runnerAvailable: true,
        targets: [{ ...TARGET, historyDone: historyDone ? ["implement"] : [] }],
        filter: { open: openKeys([], [TARGET]) },
      },
      Date.parse("2026-09-09T09:00:00Z"),
    );
  const state = (html: string, step: string): string => {
    const line = html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`))?.[0] ?? "";
    return line.match(/<td data-col="state">.*?<\/td>/)?.[0] ?? "";
  };

  // Green when the step's own commit is on the branch (the step did its
  // work; archiving merges it in), amber only when nothing reached the
  // files — and the row's own message says which of the two it is.
  test("its work on the branch: a word, green, and no dash", () => {
    const cell = state(render(true), "implement");
    expect(cell).toContain("done");
    expect(cell).toContain("b-done");
    expect(cell).not.toContain(PHASE_NOT_RUN);
  });

  test("nothing written at all: the same, never a dash", () => {
    const cell = state(render(false), "implement");
    expect(cell).toContain("b-waiting");
    expect(cell).not.toContain(PHASE_NOT_RUN);
  });
});
