import type { Language } from "../i18n";
import { stepLabel } from "./step-label.ts";

/** "analyze" → "analyzing"/"analyserer" — a per-step, per-language
 *  table (spec 350, REQ-6), replacing the English-only suffix rule this
 *  used to be outright: a rule built on `stepLabel(step) + "ing"` has no
 *  Norwegian equivalent (`2-analysis.md`'s "Why gerund() cannot simply
 *  be handed a translated stepLabel"). Keyed by the step ID, not by
 *  `stepLabel`'s output, and entirely decoupled from it — so it can
 *  carry a real Norwegian verb without touching `STEP_LABELS` or any
 *  page that reads it, `job-page.ts` included.
 *
 *  A step neither table names falls back to the OLD suffix rule, in
 *  English regardless of `lang` — the same blind spot the algorithm
 *  already had for every step before this, now narrowed to future ones
 *  only (Risk analysis, `3-solution.md`): a test pins that every member
 *  of `WORKFLOW_STEPS` has both a `GERUND_EN` and a `GERUND_NB` entry,
 *  so an omission fails `make test` rather than surfacing only in
 *  production. */
export const GERUND_EN: Record<string, string> = {
  create: "creating", analyze: "analyzing", implement: "implementing", archive: "archiving",
  explore: "exploring", manifest: "updating the manifest", reopen: "reopening", reset: "resetting",
  schedule: "running the schedule", close: "closing",
};
export const GERUND_NB: Record<string, string> = {
  create: "oppretter", analyze: "analyserer", implement: "implementerer", archive: "arkiverer",
  explore: "utforsker", manifest: "oppdaterer manifestet", reopen: "gjenåpner", reset: "tilbakestiller",
  schedule: "kjører planen", close: "lukker",
};
export function gerund(lang: Language, step: string): string {
  const table = lang === "nb" ? GERUND_NB : GERUND_EN;
  if (table[step]) return table[step]!;
  const label = stepLabel(step);
  return label.endsWith("e") ? `${label.slice(0, -1)}ing` : `${label}ing`;
}

/** The rule itself: the index of the step a landing belongs to, from the
 *  three fields that name it. Exported (spec 399) so a caller with a raw
 *  `Job` (`queue/store.ts`) rather than a `QueueRowView` can apply the
 *  same rule `landingStep` (`render/ui/job-state/resting.ts`) uses,
 *  without a type it does not have. */
export function landingStepIndex(state: string, stepIndex: number): number {
  return state === "queued" ? stepIndex - 1 : stepIndex;
}
