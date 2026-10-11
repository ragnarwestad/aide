// Split out of phase-controls-and-progress.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  renderSpecsRows,
  type ArchivedSpecView,
  type SpecsPageOptions,
} from "../../../../../src/render";
import { row } from "../../fixtures.ts";

// Spec 265: an archived phase line draws the SAME aiPicker/modelPicker
// controls a live one does, disabled, instead of a second, hand-rolled
// rendering (`lockedModel`, removed). The route-level suite
// (`archived-specs.test.ts`) covers the parse-through-render path; this
// is the renderer on its own, with one fixture the bigger harness could
// not shape as precisely — a recorded model string with no space at all.
describe("spec 265: an archived phase line looks like a live one", () => {
  const TOOLS: NonNullable<SpecsPageOptions["modelChoices"]> = [
    { name: "sonnet" },
    { name: "codex-fast",  tool: "codex" },
  ];

  const archivedFixture = (folder: string, models: Record<string, string>): ArchivedSpecView => ({
    project: "aide",
    folder,
    done: ["create", "analyze"],
    models,
    phaseOutcomes: {},
  });

  /** One phase line's own markup, off a single-spec archived page opened
   *  the way the fold chevron opens it. */
  const openLine = (models: Record<string, string>, step: string): string => {
    const html = renderSpecsRows([], {
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
      '<option value="sonnet" data-tool="claude" selected>sonnet</option>',
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
      '<option value="sonnet" data-tool="claude" selected>sonnet</option>',
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
      '<option value="sonnet" data-tool="claude" selected>sonnet</option>',
    );
  });
});

// An archived spec whose branch has not merged still has a row on the
// Running tab, and the row's phase lines are locked: they say what the
// spec's own files record and offer no press.
describe("a locked phase line", () => {
  const archived = (over: Partial<ArchivedSpecView> = {}): ArchivedSpecView => ({
    project: "aide",
    folder: "50-archived",
    done: ["create", "analyze"],
    models: {},
    phaseOutcomes: {},
    ...over,
  });

  const lines = (spec: ArchivedSpecView): Record<string, string> => {
    const html = renderSpecsRows([], {
      runnerAvailable: true,
      targets: [],
      modelChoices: [{ name: "sonnet" }, { name: "claude-opus-5" }],
      defaultModels: { default: "sonnet" },
      archivedSpecs: [spec],
      filter: { state: "archived", open: "aide/50-archived" },
    });
    return Object.fromEntries(
      ["create", "analyze", "implement", "archive"].map((step) => [
        step,
        html.match(new RegExp(`<tr class="subrow"[^>]*data-step="${step}">[\\s\\S]*?</tr>`))?.[0] ?? "",
      ]),
    );
  };

  // `chosenSteps` answers "what would a press run next", which for a
  // finished spec with no recorded choice falls back to `{archive}` alone:
  // routed through it the row would tick the one step it did not have.
  test("each box is ticked by what happened, not by what a press would run", () => {
    const byStep = lines(archived());
    for (const step of ["create", "analyze"]) expect(byStep[step]).toContain(" checked");
    for (const step of ["implement", "archive"]) expect(byStep[step]).not.toContain(" checked");
  });

  test("no box can be ticked, and none would post a step if it were", () => {
    const byStep = lines(archived());
    for (const [step, line] of Object.entries(byStep)) {
      const box = line.slice(line.indexOf(`data-phase="${step}"`));
      expect([step, box.slice(0, box.indexOf("</label>")).includes(" disabled")]).toEqual([step, true]);
      expect(box.slice(0, box.indexOf("</label>"))).not.toContain('name="steps"');
    }
  });

  // The old `4-status.md` `Model (<step>):` line and the new per-phase-file
  // `Model:` line never both exist for one real archive, but the merge
  // order is fixed: the new value wins.
  test("prefers the new-format model over the old when a record carries both", () => {
    const byStep = lines(archived({
      models: { analyze: "claude claude-sonnet-5" },
      phaseOutcomes: { analyze: { model: "claude claude-opus-5" } },
    }));
    expect(byStep["analyze"]).toContain("claude-opus-5");
    expect(byStep["analyze"]).not.toContain("claude-sonnet-5");
  });
});

// The open row on the Specs list shows what each phase runs on in New
// spec's phase table. A phase still to run takes a pick, saved for the
// spec as the Running tab saves one, while no job runs on it.
describe("the open spec's phase table", () => {
  const TOOLS: NonNullable<SpecsPageOptions["modelChoices"]> = [{ name: "sonnet" }, { name: "opus" }];
  const phases = (opts: Partial<SpecsPageOptions>, key: string): string => {
    let drawn = "";
    renderSpecsRows([], {
      runnerAvailable: true,
      targets: [],
      modelChoices: TOOLS,
      defaultModels: { default: "sonnet" },
      openSpec: { key, detail: (parts) => (drawn = parts.phases) },
      ...opts,
    });
    return drawn;
  };
  const selects = (html: string) => html.match(/<select\b[^>]*>/g) ?? [];

  const line = (html: string, step: string): string[] =>
    selects(html.match(new RegExp(`<tr class="subrow" data-step="${step}">[\\s\\S]*?</tr>`))![0]);

  test("an idle spec's phases take a pick under its run form; create does not", () => {
    const html = phases({ targets: [{ project: "aide", specFolder: "81-live" }] }, "aide/81-live");
    for (const step of ["analyze", "implement", "archive"]) {
      for (const tag of line(html, step)) {
        expect([step, tag.includes(" disabled")]).toEqual([step, false]);
        expect(tag).toContain('form="rowrun-aide/81-live"');
      }
    }
    for (const tag of line(html, "create")) expect(tag).toContain(" disabled");
  });

  test("while a job runs on the spec, every phase is locked", () => {
    let drawn = "";
    renderSpecsRows([row({ specFolder: "81-queue-and-runner" })], {
      runnerAvailable: true,
      targets: [],
      modelChoices: TOOLS,
      defaultModels: { default: "sonnet" },
      openSpec: { key: "aide/81-queue-and-runner", detail: (parts) => (drawn = parts.phases) },
    });
    expect(selects(drawn).length).toBeGreaterThan(0);
    for (const tag of selects(drawn)) expect(tag).toContain(" disabled");
  });

  test("an archived spec's phase shows the model it ran on", () => {
    const html = phases(
      { archivedSpecs: [{ project: "aide", folder: "50-archived", done: ["create", "analyze"], models: { analyze: "claude opus" }, phaseOutcomes: {} }], filter: { state: "archived" } },
      "aide/50-archived",
    );
    const analyze = html.match(/<tr class="subrow" data-step="analyze">[\s\S]*?<\/tr>/)![0];
    expect(analyze).toMatch(/<option value="opus"[^>]*selected>/);
  });
});
