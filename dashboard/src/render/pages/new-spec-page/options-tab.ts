// The New spec page's Options tab: the four settings about the spec as a
// whole, then the phase table with each phase's box, AI and model. Kept
// apart from the page itself, which draws the Spec tab and the frame.

import { helpPopover, phaseChip, stepLabel } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import type { CriteriaChecks } from "../../../project/discover/criteria-checks.ts";
import { PHASE_LINES, type SpecGroup } from "../specs-list";
import { aiPicker, modelPicker, phaseCaptionCells, type PickerOptions } from "../specs-list/model-picker.ts";
import type { NewSpecPageOptions } from "./index.ts";

/** The Options tab: the four settings on one row, wrapping where the
 *  screen has no room for all, then the phase table. Each is a `.frow`,
 *  a full-width row of the form's own wrapping flex. */
export function optionsTab(opts: NewSpecPageOptions, formId: string): string {
  return (
    `<span class="frow row">` +
    acceptanceField(formId) +
    aiFormulateAcceptanceField(formId) +
    criteriaChecksField() +
    chooseApproachField(formId) +
    `</span>` +
    `<span class="frow">` +
    newSpecPhaseTable(opts, formId) +
    `</span>`
  );
}

// One row per phase — create, analyze, implement, archive — each with a
// tick, an AI choice and a model choice, drawn by the same
// `aiPicker`/`modelPicker`/`phaseCaptionCells` the Specs list's own spec
// row uses (spec 342): the control this page needs already exists as
// parts, and the task is reusing them, not writing a second version for
// a spec that does not exist yet.
//
// `aiPicker`/`modelPicker` derive the `<select>`'s `form="..."` from a
// `SpecGroup`'s own `project`/`specFolder` — real values a spec on this
// page has neither of, so a small, clearly-synthetic row is built once
// here, and `formIdOverride` (this page's own form id) is what actually
// ties every select to it.
function newSpecPhaseTable(opts: NewSpecPageOptions, formId: string): string {
  const pickerOpts: PickerOptions = {
    modelChoices: opts.modelChoices,
    defaultModels: opts.defaultModels,
    // No `pendingModels`: a spec that does not exist yet has no
    // `specFolder` to key a pending pick on (REQ-6) — the `pending`
    // tier of `resolveChosenModel` then falls through to `configured`
    // every time, the same answer `create`'s own picker already gave.
  };
  const row: SpecGroup = {
    project: "", specFolder: "new", named: false, state: "not-started",
    spentUsd: 0, costUnmeasured: false, phases: [], done: [],
    dependsOn: [], analyzeStale: false,
  };
  const captionRow = (opts.modelChoices ?? []).length
    ? `<tr class="subrow" data-caption="1">${phaseCaptionCells(pickerOpts, false, "", opts.lang ?? "en")}</tr>`
    : "";
  const phaseRows = PHASE_LINES.map((step) => {
    // `create` MADE the spec these lines belong to and cannot be
    // created again — the same locked, nameless box `phase-rows.ts`'s
    // own `create` line draws for an existing spec.
    const locked = step === "create";
    const box = phaseChip({
      dataAttr: "data-phase",
      value: step,
      label: "",
      ariaLabel: locked
        ? "Create — always runs, and not a step you can drop"
        : stepLabel(step),
      name: locked ? "" : "steps",
      form: formId,
      checked: true,
      disabled: locked,
      plain: true,
    });
    return (
      `<tr class="subrow" data-step="${esc(step)}"><td class="phasecell">${esc(stepLabel(step))}</td>` +
      `<td class="modelcell"><span class="row">` +
      `<span class="aimodel">${aiPicker(row, pickerOpts, step, false, false, undefined, undefined, formId)}` +
      `${modelPicker(row, pickerOpts, step, false, false, undefined, undefined, formId)}</span>` +
      `${box}</span></td></tr>`
    );
  }).join("");
  return `<table class="list"><tbody>${captionRow}${phaseRows}</tbody></table>`;
}

// Spec 394 (REQ-2): the acceptance switch, drawn separately from the
// phase table's own rows — neither is about one phase, both are about
// the spec as a whole. Spec 386's original placement (a row inside
// `newSpecPhaseTable`) split this pair across the phase table. Spec 426
// then gave the switch its own line, above "Depends on" — spec 394's
// REQ-3 had put it beside that field instead, in one row, which pushed
// the chip up against "Depends on"'s own "(?)" popover. It now sits on
// the acceptance criteria row under the project picker (`newSpecForm`,
// below), and its popover opens with the board's default rule.
//
// Said the POSITIVE way, and checked by default. It read "acceptance
// ticking not required", unticked, which meant "it IS required" — a
// double negative to unwind every time. The field posts the same way it
// reads, so nothing between here and the runner has to be read
// backwards either.
//
// Checked by default because the wrong default is expensive: `analyze`
// decides once, from this, and locks the switch after — so a spec that
// quietly skipped its acceptance table could only be put right by
// running the whole analysis again.
function acceptanceField(formId: string): string {
  return (
    `<span class="field"><span class="fieldhead">` +
    phaseChip({
      dataAttr: "data-acceptance",
      value: "1",
      label: "Acceptance ticking required",
      name: "acceptanceRequired",
      form: formId,
      checked: true,
      plain: true,
    }) +
    `<span class="fieldend">` +
    helpPopover(
      "what this does",
      "Analyze writes an acceptance-criteria table, and archive waits until every row is ticked. " +
        "Cleared, the requirements stay written down and nothing is left to tick.",
    ) +
    `</span></span></span>`
  );
}

// Spec 433 (AC-4/AC-5): whether create spends an AI session at all.
// Checked by default, like acceptanceField above and for the same
// reason — unticking it is a deliberate action, never a default a reader
// stumbles into. Ticked, create runs exactly as it always has: the only
// path left to an AI session anywhere inside create.
function aiFormulateAcceptanceField(formId: string): string {
  return (
    `<span class="field"><span class="fieldhead">` +
    phaseChip({
      dataAttr: "data-ai-formulate",
      value: "1",
      label: "Let AI formulate acceptance criteria",
      name: "aiFormulateAcceptance",
      form: formId,
      checked: true,
      plain: true,
    }) +
    `<span class="fieldend">` +
    helpPopover(
      "what this does",
      "Ticked, create runs a short AI session that writes an acceptance criterion for each " +
        "requirement in this description that has none, and keeps the criteria you wrote " +
        "yourself word for word; cleared, create writes the spec directly from what is typed " +
        "here — no AI session, done in seconds.",
    ) +
    `</span></span></span>`
  );
}

// Whether the person asks to choose between the approaches analyze finds.
// Not ticked when the form opens: unticked, analyze picks the approach and
// implement builds it, as it always has. The runner records the choice in
// the new spec's Tracking info either way.
function chooseApproachField(formId: string): string {
  return (
    `<span class="field"><span class="fieldhead">` +
    phaseChip({
      dataAttr: "data-choose-approach",
      value: "1",
      label: "Let me choose the approach",
      name: "chooseApproach",
      form: formId,
      checked: false,
      plain: true,
    }) +
    `<span class="fieldend">` +
    helpPopover(
      "what this does",
      "Ticked, analyze marks each approach it considered as a real alternative or as rejected. " +
        "When it finds two or more real alternatives, Implement waits, and the spec's row lists them " +
        "with the recommended one chosen: save it to go on, or choose another to have analyze plan " +
        "that one instead. Cleared, analyze picks the approach and Implement builds it.",
    ) +
    `</span></span></span>`
  );
}

/** The three levels of the acceptance criteria checks, in the order the
 *  select lists them; the values are what the create posts. */
export const criteriaChecksChoices = (): { value: CriteriaChecks; label: string }[] => [
  { value: "off", label: "Off" },
  { value: "warn", label: "Warn" },
  { value: "stop", label: "Stop" },
];

// How strictly analyze checks this spec's acceptance criteria. Chosen
// here, once: the runner records it in the new spec's Tracking info, and
// nothing on the board changes it afterwards. Off when the form opens,
// the same level a spec with nothing recorded is checked at. Drawn the
// way the two switches beside it are — the control on the label's line,
// the "(?)" at its end — so the three read as one row.
function criteriaChecksField(): string {
  const id = "new-spec-criteria-checks";
  return (
    `<span class="field"><span class="fieldhead"><span class="row">` +
    `<label for="${id}">Acceptance criteria checks</label>` +
    `<select name="criteriaChecks" id="${id}">` +
    criteriaChecksChoices()
      .map((o) => `<option value="${o.value}"${o.value === "off" ? " selected" : ""}>${esc(o.label)}</option>`)
      .join("") +
    `</select></span>` +
    `<span class="fieldend">` +
    helpPopover(
      "what this does",
      "How strictly analyze checks this spec's acceptance criteria — that each is written as a " +
        "testable requirement, has a scenario, contradicts no other and can be built. Off: no " +
        "checks. Warn: the plan review lists what it finds, and analyze completes. Stop: analyze " +
        "stops until the criteria are put right. Chosen here, and not changed after the spec is created.",
    ) +
    `</span></span></span>`
  );
}
