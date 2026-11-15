// The New spec page's Options tab: the phase table with each phase's box,
// AI and model, and the four settings about the spec as a whole beside
// it. Kept apart from the page itself, which draws the Spec tab and the
// frame.

import { helpPopover, phaseChip } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { capitalizeFirst } from "../../../messages/shared/written.ts";
import type { CriteriaChecks } from "../../../project/discover";
import type { CardLock, CardPlace, CardSetting, CardValues, CardView } from "../../../project/spec-card.ts";
import type { NewSpecPageOptions } from ".";

/** What New spec's form opens with: the four settings as they stand
 *  before anything is chosen, and no dependency. */
export const NEW_SPEC_VALUES: CardValues = {
  dependsOn: [],
  group: null,
  acceptanceRequired: true,
  aiFormulate: true,
  criteriaChecks: "off",
  chooseApproach: false,
};

/** The Options tab: the phase table, then the four settings as one group
 *  beside it, one to a line, going under it where the screen has no room
 *  for both. One `.frow`, a full-width row of the form's own wrapping
 *  flex. `card` is what `cardStep` says the card shows. */
export function optionsTab(opts: NewSpecPageOptions, formId: string, card: CardView): string {
  return (
    `<span class="frow options-row">` +
    optionsGroup({
      form: formId,
      place: "new-spec",
      locks: card.locks,
      acceptance: card.shown.acceptanceRequired,
      aiFormulate: card.shown.aiFormulate,
      showAiFormulate: false,
      criteriaChecks: card.shown.criteriaChecks as CriteriaChecks,
      chooseApproach: card.shown.chooseApproach,
      lang: opts.lang ?? "en",
    }) +
    `</span>`
  );
}

/** What the four settings show, and whether they post. A setting posts its
 *  name only while its lock is null: New spec posts all four to its form;
 *  the open row on the Specs list shows what the spec was created with and
 *  posts the three analyze reads until a job is in flight or analyze has run. */
export interface OptionsGroupValues {
  /** The form the fields post to; absent, they post with the form they
   *  sit inside. */
  form?: string;
  acceptance: boolean;
  aiFormulate: boolean;
  showAiFormulate?: boolean;
  criteriaChecks: CriteriaChecks;
  chooseApproach: boolean;
  /** The page the group is drawn on, which decides the sentinel and the
   *  checks select's id. */
  place: CardPlace;
  /** Why each setting cannot be changed, or null where it can. */
  locks: Record<CardSetting, CardLock | null>;
  /** The reader's language: the labels, the level words and the "(?)" texts. */
  lang?: Language;
  /** The checks select last, after choosing the approach. */
  checksLast?: boolean;
}

/** The four settings' labels, in the reader's language: the same words on
 *  New spec's Options tab and on the Specs list's open row. */
export function optionLabels(lang: Language): Record<"acceptance" | "aiFormulate" | "criteriaChecks" | "chooseApproach", string> {
  return {
    acceptance: capitalizeFirst(t(lang, "spec.acceptanceTickingRequired")),
    aiFormulate: t(lang, "spec.formulateCriteria"),
    criteriaChecks: t(lang, "spec.criteriaChecks"),
    chooseApproach: t(lang, "spec.chooseApproach"),
  };
}

/** The three levels of the checks select, in the reader's language. */
export function checkLevelWords(lang: Language): Record<CriteriaChecks, string> {
  return { off: t(lang, "spec.checksOff"), warn: t(lang, "spec.checksWarn"), stop: t(lang, "spec.checksStop") };
}

/** The four settings about the spec as a whole, one to a line, as one
 *  group: beside the phase table where there is room, under it where not. */
export function optionsGroup(v: OptionsGroupValues): string {
  return (
    `<span class="options-group">` +
    acceptanceField(v) +
    (v.showAiFormulate === false ? "" : aiFormulateAcceptanceField(v)) +
    (v.checksLast ? chooseApproachField(v) + criteriaChecksField(v) : criteriaChecksField(v) + chooseApproachField(v)) +
    `</span>`
  );
}

// The acceptance switch, drawn separately from the
// phase table's own rows — neither is about one phase, both are about
// the spec as a whole. Putting it inside a phase table would split this
// pair across the phase table, and beside "Depends on" in one row the
// chip was pushed up against that field's own "(?)" popover. It sits on
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
function acceptanceField(v: OptionsGroupValues): string {
  const lang = v.lang ?? "en";
  const open = v.locks.acceptanceRequired === null;
  return (
    `<span class="field"><span class="fieldhead">` +
    // What tells the route a cleared box from a locked one: a locked box
    // posts nothing, the same as a cleared one.
    (v.place === "running-row" && open ? `<input type="hidden" name="settingsEditable" value="1">` : "") +
    phaseChip({
      dataAttr: "data-acceptance",
      value: "1",
      label: optionLabels(lang).acceptance,
      name: open ? "acceptanceRequired" : "",
      form: v.form,
      checked: v.acceptance,
      disabled: !open,
      plain: true,
    }) +
    `<span class="fieldend">` +
    helpPopover(t(lang, "newSpec.optionHelpTitle"), esc(t(lang, "newSpec.help.acceptance"))) +
    `</span></span></span>`
  );
}

// Whether create spends an AI session at all.
// Checked by default, like acceptanceField above and for the same
// reason — unticking it is a deliberate action, never a default a reader
// stumbles into. Ticked, create runs exactly as it always has: the only
// path left to an AI session anywhere inside create.
function aiFormulateAcceptanceField(v: OptionsGroupValues): string {
  const lang = v.lang ?? "en";
  return (
    `<span class="field"><span class="fieldhead">` +
    phaseChip({
      dataAttr: "data-ai-formulate",
      value: "1",
      label: optionLabels(lang).aiFormulate,
      name: v.locks.aiFormulate ? "" : "aiFormulateAcceptance",
      form: v.form,
      checked: v.aiFormulate,
      disabled: v.locks.aiFormulate !== null,
      plain: true,
    }) +
    `<span class="fieldend">` +
    helpPopover(t(lang, "newSpec.optionHelpTitle"), esc(t(lang, "newSpec.help.formulate"))) +
    `</span></span></span>`
  );
}

// Whether the person asks to choose between the approaches analyze finds.
// Not ticked when the form opens: unticked, analyze picks the approach and
// implement builds it, as it always has. The runner records the choice in
// the new spec's Tracking info either way.
function chooseApproachField(v: OptionsGroupValues): string {
  const lang = v.lang ?? "en";
  return (
    `<span class="field"><span class="fieldhead">` +
    phaseChip({
      dataAttr: "data-choose-approach",
      value: "1",
      label: optionLabels(lang).chooseApproach,
      name: v.locks.chooseApproach === null ? "chooseApproach" : "",
      form: v.form,
      checked: v.chooseApproach,
      disabled: v.locks.chooseApproach !== null,
      plain: true,
    }) +
    `<span class="fieldend">` +
    helpPopover(t(lang, "newSpec.optionHelpTitle"), esc(t(lang, "newSpec.help.approach"))) +
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

// How strictly analyze checks this spec's acceptance criteria. The runner
// records it in the new spec's Tracking info, and the spec's open row can
// change it until analyze has run. Off when the form opens,
// the same level a spec with nothing recorded is checked at. Drawn the
// way the two switches beside it are — the control on the label's line,
// the "(?)" at its end — so the three read as one row.
function criteriaChecksField(v: OptionsGroupValues): string {
  const lang = v.lang ?? "en";
  // A row's own form names its select, so two open rows never share an id.
  const row = v.place === "running-row" && v.form;
  const id = row ? `${v.form}-criteria-checks` : v.place === "running-row" ? "spec-criteria-checks" : "new-spec-criteria-checks";
  return (
    `<span class="field"><span class="fieldhead"><span class="row">` +
    `<label for="${esc(id)}">${esc(optionLabels(lang).criteriaChecks)}</label>` +
    `<select ${v.locks.criteriaChecks === null ? `name="criteriaChecks"` : "disabled"}${row ? ` form="${esc(v.form!)}"` : ""} id="${esc(id)}">` +
    criteriaChecksChoices()
      .map((o) => `<option value="${o.value}"${o.value === v.criteriaChecks ? " selected" : ""}>${esc(checkLevelWords(lang)[o.value])}</option>`)
      .join("") +
    `</select></span>` +
    `<span class="fieldend">` +
    helpPopover(t(lang, "newSpec.optionHelpTitle"), esc(t(lang, "newSpec.help.checks"))) +
    `</span></span></span>`
  );
}
