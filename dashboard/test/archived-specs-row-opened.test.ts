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
import {
  ALL_VIEW, ARCHIVED_VIEW, LIVE, STAMPED, STAMPED_COST, STAMPED_COST_LABEL, STAMPED_MODEL,
  STAMPED_NOT_RUN, STAMPED_STEPS, STAMPED_TIME_SPENT, TWO_TOOLS, blockFor, described, harness,
  modelChoicesWith, opened, outcome, phaseLines, specsList, stamp, start,
} from "./archived-specs-fixtures.ts";

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
    for (const step of STAMPED_STEPS) expect(lines[step]).toContain(">done<");
    for (const step of STAMPED_NOT_RUN) {
      expect(lines[step]).not.toContain(">done<");
      expect(lines[step]).toContain("not run yet");
    }
  });

  // `preTicked` answers "what would a press run next", which for a
  // finished spec is always `{archive}` alone — so routed through it a
  // locked row would tick the one step it did not have and leave the two
  // it did unticked. No press is offered, so the box says what happened.
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

  test("shows an AI/Model caption row over an archived group's phase lines, same as a live one (criterion 4)", async () => {
    const block = blockFor(await openList(), STAMPED);
    expect(block).toContain('data-step="analyze"');
    expect(block).toContain('data-cap="model"');
    expect(block).toContain('data-cap="ai"');
  });

  test("shows the mobile fold checkbox on every archived phase line, same as a live one (criterion 4)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const line of Object.values(lines)) {
      expect(line).toContain('class="foldphase"');
      expect(line).toContain('class="foldchevron"');
    }
  });

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
        '<option value="sonnet" data-tool="claude" title="$3 per step" selected>sonnet</option>',
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
    // The AI select plus the model select — the same two a live row with
    // two configured tools draws, never a single, hand-rolled one.
    expect([...line.matchAll(/<select\b/g)]).toHaveLength(2);
    expect(line).toContain(" disabled");
    expect(line).toContain(
      '<option value="sonnet" data-tool="claude" title="$3 per step" selected>sonnet</option>',
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
        status: stamp("2026-08-15", 30_000, ["create", "analyze"], { analyze: staleModel }),
      },
    });
    const lines = phaseLines(await specsList(base, `${ARCHIVED_VIEW}${opened(folder)}`), folder);
    const line = lines["analyze"]!;
    expect(line).toContain(' disabled');
    expect(line).toContain('<option value="gpt-9000-old" selected>gpt-9000-old</option>');
    expect(line).not.toContain(staleModel);
  });

  // Spec 247: the sibling gap Model's own fix (spec 244) left open —
  // `2-analysis.md`'s own Tracking info is the analyze phase's only
  // source for what it cost in time and money, and the fixture gives it
  // one (spec 247, criteria 1 and 3).
  test("shows the locked time and cost for a step that recorded them (spec 247, criteria 1, 3)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    const line = lines["analyze"]!;
    expect(line).toContain(STAMPED_TIME_SPENT);
    // Dollar-formatted, through the same `costCell()` a live row uses —
    // never the "est." mark this cost was not flagged with.
    const cell = line.slice(line.indexOf('data-col="cost"'));
    expect(cell.slice(0, cell.indexOf("</td>"))).toContain(STAMPED_COST_LABEL);
    expect(line).not.toContain("est.");
  });

  // The three steps that recorded neither (spec 247, criteria 2, 5) —
  // `create` has a file but no Tracking-info outcome block, `implement`
  // and `archive` have no phase file at all in this fixture. Nobody
  // having recorded a figure is not the same as having asked and failed,
  // so the cell stays empty, never a dash and never `0m00s`/`$0.00`.
  test("draws no time or cost for a step that recorded neither (spec 247, criteria 2, 5)", async () => {
    const lines = phaseLines(await openList(), STAMPED);
    for (const step of ["create", ...STAMPED_NOT_RUN]) {
      const line = lines[step]!;
      expect(line).toContain('<td data-col="started"></td>');
      expect(line).toContain('<td class="num" data-col="cost"></td>');
    }
  });

  // Spec 247, criterion 4: the same "est." mark a live row's own
  // unmeasured cost already carries, now on a locked phase's cost too.
  // Its own fixture, so the plain-cost assertion above stays a
  // single-value check rather than one cost doing double duty.
  test("carries the est. mark for a cost recorded as unmeasured (spec 247, criterion 4)", async () => {
    const folder = "155-a-locked-unmeasured-cost";
    const { base } = start({}, {
      [folder]: {
        description: described("A locked unmeasured cost", "One archived spec, one recorded cost."),
        status: stamp("2026-08-15", 60_000, ["create", "analyze"]),
        analysis: outcome({ cost: `${STAMPED_COST} (unmeasured)` }),
      },
    });
    const lines = phaseLines(await specsList(base, `${ARCHIVED_VIEW}${opened(folder)}`), folder);
    const line = lines["analyze"]!;
    expect(line).toContain("est.");
    expect(line).toContain(STAMPED_COST_LABEL);
  });

  // Spec 260: the locked-phase-line call site used to hardcode
  // `undefined` for tokens regardless of what the phase file recorded —
  // independent of the header-row roll-up test above, which goes
  // through `readerGroup`'s `spentTokens` sum rather than this per-phase
  // `Phase.tokens` field.
  test("shows the locked tokens for a step whose only recorded figure is tokens (spec 260, AC7)", async () => {
    const folder = "260-a-locked-tokens-only-cost";
    const { base } = start({}, {
      [folder]: {
        description: described("A locked tokens-only cost", "One archived spec, one Codex phase."),
        status: stamp("2026-08-26", 60_000, ["create", "analyze"]),
        analysis: outcome({ tokens: "9562" }),
      },
    });
    const lines = phaseLines(await specsList(base, `${ARCHIVED_VIEW}${opened(folder)}`), folder);
    const line = lines["analyze"]!;
    const cell = line.slice(line.indexOf('data-col="cost"'));
    expect(cell.slice(0, cell.indexOf("</td>"))).toContain('<span class="u-tok">9.6k tok</span>');
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
      { queueDefaults: modelChoicesWith({ "claude-opus-5": { budgetUsd: 15 } }) },
      {
        [folder]: {
          description: described("A locked model merge", "One archived spec, two model records."),
          status: stamp("2026-08-16", 60_000, ["create", "analyze"], { analyze: oldModel }),
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
