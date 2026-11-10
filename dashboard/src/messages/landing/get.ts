import type { Language } from "../../i18n/index.ts";
import { renderSentence } from "../render.ts";
import type { Message, Sentence } from "../types.ts";

export function getLandingMessage(
  job: { landingError?: Sentence | Sentence[]; errorReason?: string },
  lang: Language,
): Message | undefined {
  if (!job.landingError) return undefined;
  return {
    variant: job.errorReason === "tests-red" ? "waiting" : "failed",
    text: renderSentence(lang, job.landingError)!,
  };
}
