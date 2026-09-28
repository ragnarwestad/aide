// Split out of archived-specs.test.ts by theme.
//
// --- spec 224: the same row, opened ----------------------------------------
//
// The row is the ordinary one with a lock on it, so opening it does
// what opening any other row does: phase lines, in the workflow's own
// order, saying what happened. What it must NOT do is offer a press —
// every step but `reopen` is refused server-side for an archived spec
// (`ARCHIVE_ONLY_STEP`), and a control that would be refused is a
// control that should not be drawn.

import { afterEach, describe, expect, test } from "bun:test";
import { ALL_VIEW, ARCHIVED_VIEW, LIVE, STAMPED, STAMPED_MODEL, STAMPED_NOT_RUN, STAMPED_STEPS, TWO_TOOLS, blockFor, described, harness, modelChoicesWith, opened, outcome, phaseLines, specsList, stamp, start } from "./archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

describe("an archived spec's row, opened", () => {
  const openList = (query = "") =>
    specsList(start({ queueDefaults: TWO_TOOLS }).base, `${ARCHIVED_VIEW}${opened(STAMPED)}${query}`);

  test("shows a line for every phase, in the workflow's own order", async () => {
    const steps = Object.keys(phaseLines(await openList(), STAMPED));
    expect(steps).toEqual(["create", "analyze", "implement", "archive"]);
  });

  // The file's own claim, and only that: `refreshSpecCaches` never warms
  // the git-verified answer for an archived spec, so there is no second
  // source for such a row to read.
  test("each line says what 4-status.md's own line claims happened", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const step of STAMPED_STEPS) expect(lines[step]).toContain(">Done<");
    for (const step of STAMPED_NOT_RUN) {
      expect(lines[step]).not.toContain(">Done<");
      // A dash since 2026-09-08: the queue has no job for a phase an
      // archived spec's own file does not name.
      expect(lines[step]).toContain("–");
    }
  });

  // `chosenSteps` answers "what would a press run next", which for a
  // finished spec with no recorded choice falls back to `{archive}`
  // alone — so routed through it a locked row would tick the one step
  // it did not have and leave the two it did unticked. No press is
  // offered, so the box says what happened.
  test("each box is ticked by what happened, not by what a press would run", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const step of STAMPED_STEPS) expect(lines[step]).toContain(" checked");
    for (const step of STAMPED_NOT_RUN) expect(lines[step]).not.toContain(" checked");
  });

  test("no box can be ticked, and none would post a step if it were", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    // A loop over nothing passes: the row has to HAVE its four lines
    // before "none of them takes a tick" says anything at all.
    expect(Object.keys(lines)).toHaveLength(4);
    for (const [step, line] of Object.entries(lines)) {
      const box = line.slice(line.indexOf(`data-phase="${step}"`));
      expect(box.slice(0, box.indexOf("</label>"))).toContain(" disabled");
      expect(box.slice(0, box.indexOf("</label>"))).not.toContain('name="steps"');
    }
  });

  // Spec 265 reverses spec 224/257's own rule here: a locked phase line
  // now draws the SAME AI/model controls a live one does, disabled —
  // never a second, hand-rolled rendering — so the caption over them and
  // the mobile fold that shows and hides them both come back too.

  // A phase that never ran (or whose file simply names no model — every
  // archived spec's `create` line, today) reads exactly as a live,
  // not-yet-run phase does: the configured default, never blank.
  test("shows a disabled select pre-filled with the configured default for a step that recorded no model (criterion 2)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const step of STAMPED_NOT_RUN) {
      const line = lines[step]!;
      expect(line).toContain(`name="model.${step}"`);
      expect(line).toContain(" disabled");
      expect(line).toContain(
        '<option value="sonnet" data-tool="claude" selected>sonnet</option>',
      );
    }
  });

  // The live Specs page always draws a real select through `modelOptions`
  // — every configured choice, one marked `selected` — and a locked phase
  // line now draws the exact same markup, disabled, with the bare
  // recorded name selected: never the "<tool> <model>" record itself,
  // which is what used to clip to "claude so" (spec 265's own bug).
  test("shows the bare recorded model name, not the tool-prefixed string, in a locked select (criterion 1)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    const line = lines["analyze"]!;
    // The AI select and the model select — the same two a live row
    // draws, never a single, hand-rolled one.
    expect([...line.matchAll(/<select\b/g)]).toHaveLength(2);
    expect(line).toContain(" disabled");
    expect(line).toContain(
      '<option value="sonnet" data-tool="claude" selected>sonnet</option>',
    );
    expect(line).not.toContain(STAMPED_MODEL);
    expect(line).not.toContain("claude sonnet");
  });

  // A model a spec ran on can be retired or renamed by the time anyone
  // reads the archive back — the record must still win, verbatim,
  // rather than being silently swapped for whatever is configured today.
  test("still shows the exact recorded model when it is no longer a configured choice (criterion 3)", async () => {
    const folder = "70-a-retired-model";
    const staleModel = "claude gpt-9000-old";
    const { base } = start({ queueDefaults: TWO_TOOLS }, {
      [folder]: {
        description: described("A retired model", "Ran on a model nobody configures any more."),
        status: stamp("2026-08-15", ["create", "analyze"], { analyze: staleModel }),
      },
    });
    const lines = phaseLines(await specsList(base, `${ARCHIVED_VIEW}${opened(folder)}`), folder);
    const line = lines["analyze"]!;
    expect(line).toContain(' disabled');
    expect(line).toContain('<option value="gpt-9000-old" selected>gpt-9000-old</option>');
    expect(line).not.toContain(staleModel);
  });

  // Spec 247, criterion 7: the OLD `4-status.md` `Model (<step>):` line
  // and the NEW per-phase-file `Model:` line never both exist for the
  // same real archive (`2-analysis.md`'s own "Findings"), but the merge
  // order still has to be deterministic — the new value wins.
  test("prefers the new-format model over the old when a fixture carries both (spec 247, criterion 7)", async () => {
    const folder = "156-a-locked-model-merge";
    const oldModel = "claude claude-sonnet-5";
    const newModel = "claude claude-opus-5";
    const { base } = start(
      { queueDefaults: modelChoicesWith({ "claude-opus-5": { } }) },
      {
        [folder]: {
          description: described("A locked model merge", "One archived spec, two model records."),
          status: stamp("2026-08-16", ["create", "analyze"], { analyze: oldModel }),
          analysis: outcome({ model: newModel }),
        },
      },
    );
    const lines = phaseLines(await specsList(base, `${ARCHIVED_VIEW}${opened(folder)}`), folder);
    // The bare model half, not the "<tool> <model>" record — spec 265
    // moved this cell onto the live picker's own markup.
    expect(lines["analyze"]).toContain("claude-opus-5");
    expect(lines["analyze"]).not.toContain("claude-sonnet-5");
  });

  test("still carries no Run form when open (criterion 4)", async () => {
    const block = blockFor(await openList(), STAMPED);
    expect(block).toContain('data-step="analyze"');
    expect(block).not.toContain('class="rowrun"');
  });

  // A live row is not touched by any of this (criterion 8). Opened the
  // same way, in the same table, it keeps its selects and its tickable
  // boxes.
  test("a live spec opened beside it keeps every control it had", async () => {
    const html = await specsList(
      start({ queueDefaults: TWO_TOOLS }).base,
      `${ALL_VIEW}${opened(LIVE)}`,
    );
    const block = blockFor(html, LIVE);
    expect(block).toContain("<select");
    expect(block).toContain('name="steps"');
    expect(block).toContain('class="rowrun"');
  });
});
