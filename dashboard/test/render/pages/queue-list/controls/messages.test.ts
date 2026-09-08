import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderQueueRows,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";
import {
  NAV,
  detail,
  row,
  openKeys,
} from "../../fixtures.ts";

// --- spec 143: a row's long message gets a panel, not the State column -------
//
// Measured on spec 141, 2026-08-20, at 1568px: a 130-character sentence
// out of `4-status.md` was written into the State column — a cell sized
// for a word — where it ran off the right edge of the table and, on an
// open row, was drawn a second time under the archive phase line. Two
// producers feed it (the spec's own held-back reason and the job's
// `error`), and both now write into one wrapping panel row of their
// own, under the head row, once.

describe("spec 143: a long message gets a panel row of its own", () => {
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: QueueTarget[] = [],
    open = true,
    extra: Partial<QueuePageOptions> = {},
  ) =>
    renderQueueRows(
      list,
      {
        runnerAvailable: true,
        targets,
        ...(open ? { filter: { open: openKeys(list, targets) } } : {}),
        ...extra,
      },
      Date.parse("2026-08-20T12:00:00Z"),
    );
  /** Everything one spec draws: its head row, its panel and its phase
   *  lines. The duplication this spec removes is only visible across
   *  all three at once, which is why no existing helper caught it. */
  const wholeRow = (html: string) =>
    html.match(/<tr class="[^"]*spechead[\s\S]*?(?=<tr class="[^"]*spechead|<\/tbody>|$)/)?.[0] ?? "";
  const headRow = (html: string) => html.match(/<tr class="[^"]*spechead[\s\S]*?<\/tr>/)?.[0] ?? "";
  /** The State column: third cell of the head row. */
  const stateCell = (html: string) =>
    [...headRow(html).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "")[1] ?? "";
  /** The Spec column: first cell of the head row, and the one the
   *  queue's refusal used to be written into (spec 151). */
  const nameCell = (html: string) =>
    [...headRow(html).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1] ?? "")[0] ?? "";
  const panel = (html: string) =>
    html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  const BUILT = ["analyze", "implement"];
  const REASON =
    'the manual browser check (Phase 4, still "Not started"): fresh load shows ' +
    "Claude Code selected, hand ticks survive one 5s refresh";

  // Criterion 1.
  test("the held-back sentence is written once for the whole row, panel included", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "done" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
    );
    expect([...wholeRow(html).matchAll(/hand ticks survive/g)]).toHaveLength(1);
  });

  // Criterion 1: the State column keeps the word and loses the sentence.
  test("the State column says the short word and never the reason", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "done" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
    );
    // The badge says the state — the same "stopped" every other stop
    // the system made gets (2026-09-08) — and never the reason.
    expect(stateCell(html)).toContain("stopped");
    expect(stateCell(html)).not.toContain("archive held back");
    expect(stateCell(html)).not.toContain("hand ticks survive");
  });

  // Criterion 1: the panel itself — full width, and the existing
  // wrapping message component rather than new markup.
  test("the panel is a full-width row under the head row, built from rowMessage", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "done" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
    );
    expect(panel(html)).toContain('data-folder="141-says-what"');
    // Six since the Created column joined the other five (spec 317).
    expect(panel(html)).toContain(`colspan="6"`);
    expect(panel(html)).toContain("rowmsg");
    expect(panel(html)).toContain("hand ticks survive");
    // Under the head row, not above it.
    expect(html.indexOf('<tr class="specnotice"')).toBeGreaterThan(html.indexOf('<tr class="spechead'));
  });

  // Criterion 1 again, for a row nobody opened: the panel is not a
  // thing you have to expand the row to be told.
  test("a collapsed row gets the panel too", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "done" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
      false,
    );
    expect(panel(html)).toContain("hand ticks survive");
    expect(stateCell(html)).not.toContain("hand ticks survive");
  });

  // Criterion 2, as spec 195 leaves it: the phase line keeps its badge
  // word and nothing else, and BOTH sentences — the held-back reason and
  // archive's own re-run qualifier — are said in the panel, in one
  // message. Neither may win silently over the other.
  test("the archive phase line keeps its badge word and the panel says both sentences", () => {
    const html = rows(
      [row({ id: "held", specFolder: "141-says-what", steps: ["archive"], state: "failed" })],
      [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
    );
    const archive = subRow(html, "archive");
    expect(archive).toContain("held back");
    expect(archive).not.toContain("last re-run failed");
    expect(archive).not.toContain("hand ticks survive");
    expect(panel(html)).toContain("hand ticks survive");
    expect(panel(html)).toContain("last re-run failed");
    // One message, not two rows — and the phase is named once, by the
    // "archive held back —" prefix the panel already carried.
    expect([...panel(html).matchAll(/archive/g)]).toHaveLength(1);
  });

  // The second producer, and the one the description names first: a run
  // that was refused or failed writes a full sentence into `error`.
  test("a job's error is written in the panel, not in the State cell (criterion 3)", () => {
    const html = rows(
      [
        row({
          id: "dirty",
          specFolder: "141-says-what",
          steps: ["implement"],
          state: "failed",
          error: "the specs tree is dirty: /Users/ragnar/develop/aide-specs",
        }),
      ],
      [target("141-says-what")],
    );
    expect(panel(html)).toContain("the specs tree is dirty");
    expect(stateCell(html)).not.toContain("the specs tree is dirty");
    expect([...wholeRow(html).matchAll(/the specs tree is dirty/g)]).toHaveLength(1);
    // The bare cell rendering it used to get is gone from both the head
    // row and the phase line.
    expect(subRow(html, "implement")).not.toContain("the specs tree is dirty");
  });

  // Criterion 6: a message from an earlier attempt must not stand next
  // to a run that is under way.
  test("a new run on the row clears the panel", () => {
    for (const state of ["running", "queued"] as const) {
      const html = rows(
        [
          row({ id: "retry", specFolder: "141-says-what", steps: ["archive"], state }),
          row({
            id: "old",
            specFolder: "141-says-what",
            steps: ["archive"],
            state: "failed",
            error: "the specs tree is dirty: /Users/ragnar/develop/aide-specs",
          }),
        ],
        [target("141-says-what", { done: BUILT, archiveHeldBack: { reason: REASON } })],
      );
      expect(panel(html)).toBe("");
      expect(wholeRow(html)).not.toContain("hand ticks survive");
      expect(wholeRow(html)).not.toContain("the specs tree is dirty");
    }
  });

  // --- spec 151: the third producer ------------------------------------------
  //
  // The queue's own refusal of a press ("analyze on 150-… is already
  // running (job 03238f57) — cancel that one first"). It is returned at
  // enqueue time, before any job exists to carry it, so it reaches the
  // page on the query string instead — and spec 143 left it behind in
  // the name cell, where it pushed the branch marks and the title
  // around.
  const REFUSAL =
    "analyze on 150-one-page-shows-the-whole-spec is already running (job 03238f57) — " +
    "cancel that one first if you want to start over";

  test("the queue's refusal of a press is written in the panel, not the name cell", () => {
    const html = rows([], [target("150-one-page")], true, {
      error: REFUSAL,
      errorSpec: "aide/150-one-page",
    });
    expect(panel(html)).toContain("is already running (job 03238f57)");
    expect(nameCell(html)).not.toContain("is already running");
    // Once for the whole row, like every other message since spec 143.
    expect([...wholeRow(html).matchAll(/is already running/g)]).toHaveLength(1);
  });

  // The refusal answers the press just made, so it outranks a standing
  // note about an archive that declined earlier.
  test("the refusal outranks the spec's own held-back note", () => {
    const html = rows([], [target("150-one-page", { done: BUILT, archiveHeldBack: { reason: REASON } })], true, {
      error: REFUSAL,
      errorSpec: "aide/150-one-page",
    });
    expect(panel(html)).toContain("is already running (job 03238f57)");
    expect(panel(html)).not.toContain("hand ticks survive");
  });

  // A refused press on a row whose job is RUNNING is the whole of the
  // incident: the panel is otherwise blank while something is in
  // flight, and blanking this would put the reader back where they
  // started — a press that said nothing.
  test("a running job does not swallow the refusal", () => {
    const html = rows(
      [row({ id: "live", specFolder: "150-one-page", steps: ["analyze"], state: "running" })],
      [target("150-one-page")],
      true,
      { error: REFUSAL, errorSpec: "aide/150-one-page" },
    );
    expect(panel(html)).toContain("is already running (job 03238f57)");
  });

  // A spec nothing has ever run has no message and no panel: an empty
  // `.rowmsg` draws nothing, but an empty `<tr>` is still a row.
  test("a row with nothing to say has no panel row at all", () => {
    const html = rows([], [target("141-says-what")]);
    expect(html).not.toContain('<tr class="specnotice"');
  });
});

// --- spec 143: the held-back note belongs to the archive row alone -----------
//
// Requirement 2 of 1-description.md: whatever the row's panel says about
// a job is said here too. Since spec 240 there is no job-level Activity
// transcript to repeat it into — the held-back note lives in the
// archive row's own Outcome cell (asserted at "the job page's Steps tab
// says held back where the row does"), and `job.error` lives in the
// banner on every tab (asserted throughout this file). What is left to
// check here, once that duplication is gone, is that a job which did
// NOT run archive never borrows the note.
describe("spec 143: the held-back note belongs to the archive row alone", () => {
  test("a job that did not run archive carries no held-back note at all", () => {
    const html = renderJobDetailPage(
      detail({
        id: "job-implement",
        state: "done",
        steps: ["implement"],
        results: [
          {
            step: "implement", ok: true, costUsd: 0.1, costMeasured: true,
            terminalReason: "completed", at: "2026-08-20T10:01:00Z",
          },
        ],
        archiveHeldBack: "the Slack webhook (Phase 4, still unchecked)",
      }),
      "2026-08-20T10:05:00Z",
      NAV,
      { tab: "steps" },
    );
    expect(html).not.toContain("the Slack webhook");
    expect(html).toContain("<td>ok</td>");
  });
});
