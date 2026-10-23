// What a phase's log says about the phase's state, above its transcript.
// The phase line's State/Action cell says the standard word alone; the
// sentences that explain it are said here, for the phase they are about.

import { t, type Language } from "../../../../i18n";
import { wordPhase } from "../../../ui/job-state";
import type { Phase, SpecGroup } from "../data-model";
import { prErrorOf, prErrorSentence } from "../row-shared.ts";

/** The explanations one phase has, plain text and each once: a
 *  description changed since the analysis (analyze only), a pull request
 *  the latest attempt could not open, and the phase's own qualifier. */
export function phaseExplanations(g: Pick<SpecGroup, "analyzeStale" | "done">, p: Phase, lang: Language): string[] {
  const said = [
    p.step === "analyze" && g.analyzeStale ? t(lang, "list.descriptionChangedSince") : undefined,
    prErrorOf(p) ? prErrorSentence(lang) : undefined,
    wordPhase(g.done.includes(p.step), p.heldBack, p.attempts[0], { ...p.history, fileResult: p.fileResult, step: p.step }, lang)
      .qualifier,
  ];
  return [...new Set(said.filter((s): s is string => !!s))];
}
