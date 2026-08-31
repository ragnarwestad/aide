// Split out of phase-controls-and-progress.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderQueueRows,
  type ArchivedSpecView,
  type QueuePageOptions,
} from "../../../../src/render.ts";

// The markup half on its own: `pips()` is shared by the list and the job
// page, and the mark is only ever about the pip that is running.
describe("spec 210: pips() marks the completed thirds", () => {
  test("a now pip with a third carries the attribute", async () => {
    const { pips } = await import("../../../../src/render/ui/components.ts");
    expect(pips([{ kind: "now", title: "implement", third: 1 }])).toContain('data-third="1"');
    expect(pips([{ kind: "now", title: "implement", third: 2 }])).toContain('data-third="2"');
  });

  test("a now pip without a third carries nothing, exactly as before", async () => {
    const { pips } = await import("../../../../src/render/ui/components.ts");
    expect(pips([{ kind: "now", title: "implement" }])).toBe(
      `<div class="pipwrap"><div class="pipletters" aria-hidden="true"><span>i</span></div>` +
        `<div class="pips"><span class="pip now" title="implement"></span></div></div>`,
    );
  });

  test("a past or todo pip never carries the mark, whatever it is handed", async () => {
    const { pips } = await import("../../../../src/render/ui/components.ts");
    expect(pips([{ kind: "past", title: "analyze", third: 2 }])).not.toContain("data-third");
    expect(pips([{ kind: "todo", title: "archive", third: 1 }])).not.toContain("data-third");
  });
});

// Spec 265: an archived phase line draws the SAME aiPicker/modelPicker
// controls a live one does, disabled, instead of a second, hand-rolled
// rendering (`lockedModel`, removed). The route-level suite
// (`archived-specs.test.ts`) covers the parse-through-render path; this
// is the renderer on its own, with one fixture the bigger harness could
// not shape as precisely — a recorded model string with no space at all.
describe("spec 265: an archived phase line looks like a live one", () => {
  const TOOLS: NonNullable<QueuePageOptions["modelChoices"]> = [
    { name: "sonnet", budgetUsd: 3 },
    { name: "codex-fast", budgetUsd: 5, tool: "codex" },
  ];

  const archivedFixture = (folder: string, models: Record<string, string>): ArchivedSpecView => ({
    project: "aide",
    folder,
    archivedAt: "2026-08-15",
    done: ["create", "analyze"],
    models,
    phaseOutcomes: {},
  });

  /** One phase line's own markup, off a single-spec archived page opened
   *  the way the fold chevron opens it. */
  const openLine = (models: Record<string, string>, step: string): string => {
    const html = renderQueueRows([], {
      runnerAvailable: true,
      targets: [],
      modelChoices: TOOLS,
      defaultModels: { default: "sonnet" },
      archivedSpecs: [archivedFixture("50-archived", models)],
      filter: { state: "archived", open: "aide/50-archived" },
    });
    return html.match(new RegExp(`<tr class="subrow"[^>]*data-step="${step}">[\\s\\S]*?</tr>`))![0];
  };

  // The live Specs page always draws a real select through `modelOptions`
  // — every configured choice, one marked `selected`. A locked phase line
  // now draws the exact same markup, disabled, with the bare recorded
  // name selected — never the "<tool> <model>" record itself, which is
  // what used to clip to "claude so".
  test("shows the bare recorded model name, disabled, never the tool-prefixed record (criterion 1)", () => {
    const line = openLine({ analyze: "claude sonnet" }, "analyze");
    expect(line).toContain(" disabled");
    expect(line).toContain(
      '<option value="sonnet" data-tool="claude" title="$3 per step" selected>sonnet</option>',
    );
    expect(line).not.toContain("claude sonnet");
  });

  // A phase that never ran (`create`, on every archived spec today) reads
  // exactly as a live, not-yet-run phase does: the configured default,
  // never blank.
  test("shows the configured default, disabled, for a step that recorded no model — never blank (criterion 2)", () => {
    const line = openLine({}, "analyze");
    expect(line).toContain("<select");
    expect(line).toContain(" disabled");
    expect(line).toContain(
      '<option value="sonnet" data-tool="claude" title="$3 per step" selected>sonnet</option>',
    );
  });

  // A model a spec ran on can be retired or renamed by the time anyone
  // reads the archive back — the record must still win, verbatim, rather
  // than being silently swapped for whatever is configured today.
  test("still shows the exact recorded model when it is no longer a configured choice (criterion 3)", () => {
    const line = openLine({ analyze: "claude gpt-9000-old" }, "analyze");
    expect(line).toContain(" disabled");
    expect(line).toContain('<option value="gpt-9000-old" selected>gpt-9000-old</option>');
    expect(line).not.toContain("claude gpt-9000-old");
  });

  // Risk analysis's third risk: `model_value="$tool"` alone (no `$model`)
  // is the shape a run with no `--model` given leaves behind — no space
  // at all, so `phaseSubRows`'s own split (`phase-rows.ts`) yields no
  // model half. Under this fix that reads exactly as "no record": a shown,
  // disabled select pre-filled with the configured default, never a
  // crash and never blank.
  test("a recorded model with no space at all still resolves to a shown value, not a blank cell", () => {
    const line = openLine({ analyze: "claude" }, "analyze");
    expect(line).toContain(" disabled");
    expect(line).toContain(
      '<option value="sonnet" data-tool="claude" title="$3 per step" selected>sonnet</option>',
    );
  });
});
