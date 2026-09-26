import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import { offersAnotherRound } from "../../../../../src/render/pages/specs-list/row-state.ts";
import type { SpecGroup } from "../../../../../src/render/pages/specs-list";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../../../src/project/parse-status";
import { openKeys, row } from "../../fixtures.ts";

// --- spec 471: the hold is quiet while the round that clears it runs --------
//
// "Archive held back — tick the criteria" is not a memory of a refusal:
// it is worked out afresh on every render, from open criteria and a
// finished implement. Both stay true all through another round, so the
// row went on telling a reader to go and tick while the run they had
// just started was under way — beside a link offering a test server for
// a branch that was moving under it. The archive's own run was already
// excepted for exactly this reason; a round is the same case, one phase
// earlier.
describe("a round under way silences the held-back marks", () => {
  const FOLDER = "471-round-quiets-the-hold";
  const target = (extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder: FOLDER,
    done: ["analyze", "implement"],
    archiveHeldBack: { reason: ACCEPTANCE_CRITERIA_UNTICKED_NOTE },
    ...extra,
  });

  const notice = (list: QueueRowView[]) =>
    renderSpecsRows(list, { runnerAvailable: true, targets: [target()] })
      .match(new RegExp(`<tr class="specnotice"[^>]*data-folder="${FOLDER}">[\\s\\S]*?</tr>`))?.[0] ?? "";

  const HOLD = "Acceptance criteria are not all ticked";
  const LINK = "Click the link to start a test server running this branch";

  test("neither the hold nor the test-server link is drawn while analyze runs", () => {
    const html = notice([
      row({ specFolder: FOLDER, steps: ["analyze", "implement", "archive"], stepIndex: 0, state: "running" }),
    ]);
    expect(html).not.toContain(HOLD);
    expect(html).not.toContain(LINK);
  });

  test("nor while implement runs, with archive still ahead of it", () => {
    const html = notice([
      row({ specFolder: FOLDER, steps: ["analyze", "implement", "archive"], stepIndex: 1, state: "running" }),
    ]);
    expect(html).not.toContain(HOLD);
    expect(html).not.toContain(LINK);
  });

  // The state the marks exist for: a job that will run `archive` next
  // and nothing else. It sits QUEUED behind the very hold the row is
  // describing, so silencing it here would blank the note in exactly
  // the state it is there for.
  test("a job queued for archive alone keeps them", () => {
    const html = notice([row({ specFolder: FOLDER, steps: ["archive"], stepIndex: 0, state: "queued" })]);
    expect(html).toContain(HOLD);
    expect(html).toContain(LINK);
  });

  // The same job once its round is behind it: analyze and implement are
  // done, archive is the step it is waiting on.
  test("a bundled job already past implement keeps them too", () => {
    const html = notice([
      row({ specFolder: FOLDER, steps: ["analyze", "implement", "archive"], stepIndex: 2, state: "queued" }),
    ]);
    expect(html).toContain(HOLD);
    expect(html).toContain(LINK);
  });

  test("an idle row is untouched", () => {
    const html = notice([row({ specFolder: FOLDER, steps: ["archive"], stepIndex: 0, state: "done" })]);
    expect(html).toContain(HOLD);
    expect(html).toContain(LINK);
  });
});

// The same marks once the Checks tab has answered them: every criterion
// ticked since the last archive run refused, and archive not pressed
// again. The refusal on the old job and the stop in git are both about
// that last run; the row went on reading "not all ticked" and offering
// another round over a spec waiting on nobody (paceup 02, 2026-09-18).
describe("a spec whose criteria have all been ticked since archive refused", () => {
  const FOLDER = "02-selvregistrering-med-provetid";
  const refused = row({
    specFolder: FOLDER,
    steps: ["implement", "archive"],
    stepIndex: 1,
    state: "done",
    results: [
      { step: "implement", ok: true, costUsd: 1, terminalReason: "completed" },
      { step: "archive", ok: true, costUsd: 0, terminalReason: "acceptance-criteria-unticked" },
    ],
  });
  const target: SpecTarget = {
    project: "aide",
    specFolder: FOLDER,
    done: ["create", "analyze", "implement"],
    acceptanceOpen: false,
  };
  const html = renderSpecsRows([refused], {
    runnerAvailable: true,
    targets: [target],
    filter: { open: openKeys([refused], [target]) },
  });

  test("says nothing about ticking criteria, and archive reads as not run", () => {
    expect(html).not.toContain("reported done");
    expect(html).not.toContain("not all ticked");
    expect(html).not.toContain("Acceptance criteria are not all ticked");
  });

  test("offers archive, not another round of analyze and implement", () => {
    const box = (step: string) =>
      html.match(new RegExp(`<input type="checkbox"[^>]*value="${step}"[^>]*>`))?.[0] ?? "";
    expect(box("archive")).toContain("checked");
    expect(box("archive")).not.toContain("disabled");
    // Implement reads as the phase behind it, not as a round to run
    // again: done, and not a box a press would post.
    expect(box("implement")).toContain("disabled");
  });
});

// --- spec 511: a reopened spec takes the same round as a held-back one -----
describe("a reopened spec at implemented, with every row ticked", () => {
  const FOLDER = "511-reopened";
  const done = ["create", "analyze", "implement"];
  const boxes = (target: SpecTarget) => {
    const idle = row({ specFolder: FOLDER, steps: ["implement"], stepIndex: 0, state: "done" });
    const html = renderSpecsRows([idle], {
      runnerAvailable: true,
      targets: [target],
      filter: { open: openKeys([idle], [target]) },
    });
    return (step: string) => html.match(new RegExp(`<input type="checkbox"[^>]*value="${step}"[^>]*>`))?.[0] ?? "";
  };
  const base: SpecTarget = { project: "aide", specFolder: FOLDER, done, acceptanceOpen: false };

  test("offers Analyze and Implement unticked beside the ticked Archive AC-5", () => {
    const box = boxes({ ...base, reopenedRound: true });
    for (const step of ["analyze", "implement"]) {
      expect(box(step)).not.toContain("checked");
      expect(box(step)).not.toContain("disabled");
    }
    expect(box("archive")).toContain("checked");
  });

  test("a spec that is not reopened, with nothing open, offers no round AC-5", () => {
    const box = boxes(base);
    expect(box("implement")).toContain("disabled");
  });

  test("a spec reopened with reset, later declined on archive, offers none of it AC-5", () => {
    // `reopenedRound` is false for it: a Reopened mark follows the stamp.
    expect(boxes({ ...base, reopenedRound: false })("implement")).toContain("disabled");
  });

  test("a reopened spec that is only at analyzed is not offered another round AC-5", () => {
    const g = { done: ["create", "analyze"], reopenedRound: true, phases: [] } as unknown as SpecGroup;
    expect(offersAnotherRound(g, "analyze")).toBe(false);
  });
});
