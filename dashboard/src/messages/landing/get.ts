import type { Language } from "../../i18n/index.ts";
import { formatSentence } from "../format.ts";
import type { Message, Sentence } from "../types.ts";

export function getLandingMessage(
  job: { landingError?: Sentence | Sentence[]; errorReason?: string },
  lang: Language,
): Message | undefined {
  if (!job.landingError) return undefined;
  return {
    variant: job.errorReason === "tests-red" ? "waiting" : "failed",
    text: formatSentence(lang, job.landingError)!,
  };
}
