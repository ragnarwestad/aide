import { describe, expect, test } from "bun:test";
import { renderSpecsRows, type QueueRowView, type SpecTarget } from "../../../../../src/render";
import { ACCEPTANCE_CRITERIA_UNTICKED_NOTE } from "../../../../../src/project/parse-status";
import { row } from "../../fixtures.ts";

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
