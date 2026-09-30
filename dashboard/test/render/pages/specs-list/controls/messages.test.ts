import { describe, expect, test } from "bun:test";
import {
  renderJobDetailPage,
  renderSpecsRows,
  type SpecsPageOptions,
  type QueueRowView,
  type SpecTarget,
} from "../../../../../src/render";
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
  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });
  const rows = (
    list: QueueRowView[],
    targets: SpecTarget[] = [],
    open = true,
    extra: Partial<SpecsPageOptions> = {},
  ) =>
    renderSpecsRows(
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
  const panel = (html: string) =>
    html.match(/<tr class="specnotice"[\s\S]*?<\/tr>/)?.[0] ?? "";
  const BUILT = ["analyze", "implement"];
  const REASON =
    'the manual browser check (Phase 4, still "Not started"): fresh load shows ' +
    "Claude Code selected, hand ticks survive one 5s refresh";

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
