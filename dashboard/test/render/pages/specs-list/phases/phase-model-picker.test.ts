import { describe, expect, test } from "bun:test";
import {
  renderSpecsRows,
  type SpecsPageOptions,
  type QueueRowView,
  type SpecTarget,
} from "../../../../../src/render";
import { row, openKeys } from "../../fixtures.ts";

// --- spec 123: the model is chosen on the phase line -------------------------
//
// Split out of listing-and-units.test.ts by theme.
//
// One dropdown for the whole row used to sit on the controls line
// between Run and the other rarely-set fields, carrying option labels
// like "fable — $12 per step". It landed beside the State column by
// accident of content width, tied to nothing around it, and the phase
// lines below it showed their model as dead text with a wide empty gap
// before it.
//
// The choice belongs where the phase is: each phase line carries its
// own picker, under a "Phase"/"Model" caption. The budget figure sits
// in the option's own visible label (spec 454) — an `<option>` cannot
// host a "(?)", so the tooltip it used to carry is not an explanation
// this dashboard can move behind one.
describe("spec 123: each phase line picks its own model", () => {
  const target = (specFolder: string, extra: Partial<SpecTarget> = {}): SpecTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  const CHOICES = [
    { name: "sonnet" },
    { name: "fable" },
  ];

  const rows = (
    list: QueueRowView[],
    targets: SpecTarget[] = [target("123-picks")],
    opts: Partial<SpecsPageOptions> = {},
  ) =>
    renderSpecsRows(
      list,
      {
        runnerAvailable: true,
        targets,
        modelChoices: CHOICES,
        filter: { open: openKeys(list, targets) },
        ...opts,
      },
      Date.parse("2026-08-19T12:00:00Z"),
    );

  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string) =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";
  /** The caption line: a subrow with no phase of its own, above them
   *  all. Marked by a data attribute rather than a class — it needs no
   *  rule of its own, and the render vocabulary is a closed set
   *  (`css-token-guard.test.ts`). */

  // --- criterion 2 -----------------------------------------------------------

  // No "default" entry (asked for 2026-08-19): the select holds real
  // names only, pre-filled with what the configuration would give the
  // step when the phase has not run yet.
  test("the options are the real names, pre-filled with the configured model", () => {
    const line = subRow(rows([], [target("123-picks")], { defaultModels: { default: "sonnet" } }), "analyze");
    const modelSelect = line.match(/<select name="model\.analyze"[\s\S]*?<\/select>/)?.[0] ?? "";
    // Spec 364's own effort select DOES carry an empty "unset" option,
    // beside this one — scoped here so that addition does not read as
    // this select's own name-only promise breaking.
    expect(modelSelect).not.toContain('<option value=""');
    expect(modelSelect).toMatch(/<option value="sonnet"[^>]*selected/);
    expect(modelSelect).toContain('value="fable"');
  });

  test("a per-step configured model beats the catch-all default", () => {
    const line = subRow(
      rows([], [target("123-picks")], { defaultModels: { analyze: "fable", default: "sonnet" } }),
      "analyze",
    );
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  // --- criterion 3 -----------------------------------------------------------

  // --- criterion 4 -----------------------------------------------------------

  // --- criterion 11 ----------------------------------------------------------

  // "last ran: X" is not spelled out any more (asked for 2026-08-19) —
  // the select's pre-filled value IS the answer.
  test("a phase that has run pre-fills its select with the model it ran on", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "fable" })],
      [target("123-picks", { done: ["analyze"] })],
    );
    const line = subRow(html, "analyze");
    expect(line).not.toContain("last ran");
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  // --- the gap the description asked to close --------------------------------

  // --- the lock spec 105 put on the shared field follows it here -------------

  test("a busy spec's phase pickers lock exactly as the shared one did", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["implement"], stepIndex: 0, state: "running" })],
      [target("123-picks")],
    );
    const select = subRow(html, "analyze").match(/<select name="model\.analyze"[^>]*>/)![0];
    expect(select).toContain("disabled");
    // Spec 454: the reason is not this select's own `title`.
    expect(select).not.toContain('title="Implement is running"');
  });

  test("a settled spec's phase pickers are live again", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["implement"], stepIndex: 0, state: "done" })],
      [target("123-picks")],
    );
    const select = subRow(html, "analyze").match(/<select name="model\.analyze"[^>]*>/)![0];
    expect(select).not.toContain("disabled");
  });

  // --- spec 308: a model picked for a phase survives leaving the page --------

  // REQ-2: a phase nobody has run yet, but that a reader picked a model
  // for on an earlier visit, pre-fills from that recorded pick rather
  // than falling straight to the configured default.
  test("REQ-2: a phase with a recorded pending choice pre-fills from it", () => {
    const line = subRow(
      rows([], [target("123-picks")], {
        defaultModels: { default: "sonnet" },
        pendingModels: { "aide/123-picks": { analyze: "fable" } },
      }),
      "analyze",
    );
    expect(line).toMatch(/<option value="fable"[^>]*selected/);
  });

  // REQ-5: a phase nobody has ever picked a model for shows the
  // configured default exactly as before this change.
  test("REQ-5: a phase with no recorded pick still shows the configured default", () => {
    const line = subRow(
      rows([], [target("123-picks")], {
        defaultModels: { default: "sonnet" },
        pendingModels: { "aide/123-picks": { implement: "fable" } },
      }),
      "analyze",
    );
    expect(line).toMatch(/<option value="sonnet"[^>]*selected/);
  });

  // A phase the running job can still be given has its model on that
  // job: a pick made while it runs goes there, and the line shows it
  // rather than the default the job has already been told not to use.
  test("a phase the running job can still take shows the job's own pick", () => {
    const html = rows(
      [row({
        id: "j1",
        specFolder: "123-picks",
        steps: ["analyze"],
        stepIndex: 0,
        state: "running",
        editableSteps: ["implement", "archive"],
        stepModels: { analyze: "sonnet", archive: "fable" },
      })],
      [target("123-picks")],
      { defaultModels: { default: "sonnet" } },
    );
    expect(subRow(html, "archive")).toMatch(/<option value="fable"[^>]*selected/);
    expect(subRow(html, "implement")).toMatch(/<option value="sonnet"[^>]*selected/);
  });

  // REQ-4: once a phase has actually run, what it ran on wins over any
  // earlier pending pick — a record of what happened outranks a choice
  // about what is to come.
  test("REQ-4: a phase that has since run shows what it ran on, not the earlier pending pick", () => {
    const html = rows(
      [row({ id: "j1", specFolder: "123-picks", steps: ["analyze"], stepIndex: 0, state: "done", model: "sonnet" })],
      [target("123-picks", { done: ["analyze"] })],
      { pendingModels: { "aide/123-picks": { analyze: "fable" } } },
    );
    const line = subRow(html, "analyze");
    expect(line).toMatch(/<option value="sonnet"[^>]*selected/);
  });
});
