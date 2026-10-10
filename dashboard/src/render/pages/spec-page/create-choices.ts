// The choices made on New spec's Options tab that a spec cannot change
// afterwards, drawn in the banner beside "acceptance ticking required":
// whether AI formulated the acceptance criteria, how strictly they are
// checked, and whether the person chooses the approach. Shown as chosen,
// never as a field the banner's form posts.

import { helpPopover, labelledCheckbox } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { createChoicesIn, type CreateChoices, type CriteriaChecks } from "../../../project/discover";
import { CRITERIA_CHECKS } from "../../../project/discover/criteria-checks.ts";

/** What a description with nothing recorded runs with. */
const DEFAULTS: CreateChoices = createChoicesIn("");

const LEVEL_WORD: Record<CriteriaChecks, TranslationKey> = {
  off: "spec.checksOff",
  warn: "spec.checksWarn",
  stop: "spec.checksStop",
};

const yesNo = (lang: Language, value: boolean): string => t(lang, value ? "spec.valueYes" : "spec.valueNo");

/** The three choices of a live spec: two boxes and a select, all disabled
 *  and none with a field name, one "(?)" saying why they cannot change. */
export function createChoicesControls(choices: CreateChoices | undefined, lang: Language): string {
  const c = choices ?? DEFAULTS;
  const label = t(lang, "spec.criteriaChecks");
  const level =
    `<span class="row" aria-disabled="true"><span>${esc(label)}</span>` +
    `<select disabled aria-label="${esc(label)}">` +
    CRITERIA_CHECKS.map(
      (v) => `<option value="${v}"${v === c.criteriaChecks ? " selected" : ""}>${esc(t(lang, LEVEL_WORD[v]))}</option>`,
    ).join("") +
    `</select></span>`;
  return (
    `<p class="row">${labelledCheckbox({ label: t(lang, "spec.formulateCriteria"), disabled: true, checked: c.aiFormulate })}</p>` +
    `<p class="row">${level}</p>` +
    `<p class="row">${labelledCheckbox({
      label: t(lang, "spec.chooseApproach"),
      disabled: true,
      checked: c.chooseApproach,
      help: helpPopover(t(lang, "spec.createChoicesTitle"), t(lang, "spec.createChoicesBody")),
    })}</p>`
  );
}

/** The same three as label and value, for an archived spec's facts. The
 *  value is escaped. */
export function createChoicesFacts(choices: CreateChoices | undefined, lang: Language): { label: string; value: string }[] {
  const c = choices ?? DEFAULTS;
  return [
    { label: t(lang, "spec.formulateCriteria"), value: yesNo(lang, c.aiFormulate) },
    { label: t(lang, "spec.criteriaChecks"), value: esc(t(lang, LEVEL_WORD[c.criteriaChecks])) },
    { label: t(lang, "spec.chooseApproach"), value: yesNo(lang, c.chooseApproach) },
  ];
}
