import type { Language } from "../i18n";

/** What a phase is CALLED on the page. English is empty: the step's own
 *  id is the word, and `stepLabel` falls back to it for every entry not
 *  listed here. Kept as a table (not deleted) so the row, the phase
 *  line, the pips and the job page have one shared place to name a step
 *  differently if one ever needs it.
 *
 *  Norwegian is a real table, keyed by the step ID and decoupled from
 *  the English one — the same shape `GERUND_NB` (`gerund.ts`) already
 *  has, and for the same reason: a Norwegian name is not the English
 *  word with a rule applied to it. A step neither table names falls
 *  back to its own id, in English whatever the language; a test pins
 *  that every `WORKFLOW_STEPS` member is in the Norwegian one, so an
 *  omission fails `make test` rather than surfacing on the board. */
export const STEP_LABELS: Record<string, string> = {};
export const STEP_LABELS_NB: Record<string, string> = {
  create: "oppretting", analyze: "analyse", implement: "implementering", archive: "arkivering",
  explore: "utforsking", manifest: "manifestoppdatering", reopen: "gjenåpning", reset: "tilbakestilling",
  schedule: "plankjøring", close: "lukking",
};

export const stepLabel = (step: string, lang: Language = "en"): string =>
  (lang === "nb" ? STEP_LABELS_NB[step] : undefined) ?? STEP_LABELS[step] ?? step;

/** The word on the row's own button for a step — `stepLabel` with a
 *  capital, in English whatever the language, because the button is.
 *  A message that tells the reader to press it names it with this, so
 *  the message and the button cannot drift apart. */
export const stepButton = (step: string): string => {
  const word = stepLabel(step);
  return `${word[0]!.toUpperCase()}${word.slice(1)}`;
};
