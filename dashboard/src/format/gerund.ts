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
  create: "Creating", analyze: "Analyzing", implement: "Implementing", archive: "Archiving",
  explore: "Exploring", manifest: "Updating the manifest", reopen: "Reopening", reset: "Resetting",
  schedule: "Running the schedule", close: "Closing", wiki: "Building the wiki",
};
export const GERUND_NB: Record<string, string> = {
  create: "Oppretter", analyze: "Analyserer", implement: "Implementerer", archive: "Arkiverer",
  explore: "Utforsker", manifest: "Oppdaterer manifestet", reopen: "Gjenåpner", reset: "Tilbakestiller",
  schedule: "Kjører planen", close: "Lukker", wiki: "Bygger wikien",
};
export const GERUND_ES: Record<string, string> = {
  create: "Creando", analyze: "Analizando", implement: "Implementando", archive: "Archivando",
  explore: "Explorando", manifest: "Actualizando el manifest", reopen: "Reabriendo", reset: "Restableciendo",
  schedule: "Ejecutando la programación", close: "Cerrando", wiki: "Construyendo la wiki",
};
export const GERUND_DE: Record<string, string> = {
  create: "Erstellt", analyze: "Analysiert", implement: "Implementiert", archive: "Archiviert",
  explore: "Erkundet", manifest: "Aktualisiert das Manifest", reopen: "Öffnet erneut", reset: "Setzt zurück",
  schedule: "Führt den Zeitplan aus", close: "Schließt", wiki: "Baut das Wiki",
};
export const GERUND_FR: Record<string, string> = {
  create: "Crée", analyze: "Analyse", implement: "Implémente", archive: "Archive",
  explore: "Explore", manifest: "Met à jour le manifest", reopen: "Rouvre", reset: "Réinitialise",
  schedule: "Exécute la planification", close: "Ferme", wiki: "Construit le wiki",
};
const GERUND_TABLES: Partial<Record<Language, Record<string, string>>> = {
  nb: GERUND_NB, es: GERUND_ES, de: GERUND_DE, fr: GERUND_FR,
};
export function gerund(lang: Language, step: string): string {
  const table = GERUND_TABLES[lang] ?? GERUND_EN;
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
