import type { Language } from "../i18n";

/** What a phase is CALLED on the page — a proper noun, capitalized in
 *  both languages. Kept as a table so the row, the phase line, the pips
 *  and the job page have one shared place to name a step.
 *
 *  Norwegian is a real table, keyed by the step ID and decoupled from
 *  the English one — the same shape `GERUND_NB` (`gerund.ts`) already
 *  has, and for the same reason: a Norwegian name is not the English
 *  word with a rule applied to it. A step neither table names falls
 *  back to its own id, in English whatever the language; a test pins
 *  that every `WORKFLOW_STEPS` member is in the Norwegian one, so an
 *  omission fails `make test` rather than surfacing on the board. */
export const STEP_LABELS: Record<string, string> = {
  create: "Create", analyze: "Analyze", implement: "Implement", archive: "Archive",
  explore: "Explore", manifest: "Manifest", reopen: "Reopen", reset: "Reset",
  schedule: "Schedule", close: "Close",
};
export const STEP_LABELS_NB: Record<string, string> = {
  create: "Opprett", analyze: "Analyser", implement: "Implementer", archive: "Arkiver",
  explore: "Utforsk", manifest: "Manifest", reopen: "Gjenåpne", reset: "Tilbakestill",
  schedule: "Kjøring", close: "Lukk",
};

export const stepLabel = (step: string, lang: Language = "en"): string =>
  (lang === "nb" ? STEP_LABELS_NB[step] : undefined) ?? STEP_LABELS[step] ?? step;

/** The word on the row's own button for a step — an alias for
 *  `stepLabel`, in English whatever the language, because the button
 *  is. A message that tells the reader to press it names it with this,
 *  so the message and the button cannot drift apart. */
export const stepButton = (step: string): string => stepLabel(step);
