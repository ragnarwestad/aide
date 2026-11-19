import { t, type Language, type TranslationKey } from "../../i18n/index.ts";
import { formatSentence } from "../format.ts";
import type { Message } from "../types.ts";
import type { QueueRowView } from "../../render/ui/job-state/types.ts";
import { jobPresentation } from "../../render/ui/job-state/presentation.ts";
import { getUsageLimitMessage } from "../usage-limit/get.ts";
import { jobDismissible } from "../../queue/steps.ts";

/** What the line reads: the row view's fields, with `steps` as `JobLike` has
 *  them, so the tests' plain jobs fit as `StateRow`'s do. */
type MessageRow = Pick<QueueRowView, "id" | "state" | "error" | "errorReason" | "stepIndex"> &
  Partial<Pick<QueueRowView, "dismissedAt" | "stopReason" | "usageLimitWait" | "results" | "stepModels" | "model" | "provider" | "specFolder" | "landing" | "queuePosition">> & {
    steps: readonly string[];
  };

const ENDED: Partial<Record<QueueRowView["state"], TranslationKey>> = {
  failed: "jobs.endedFailed",
  waiting: "jobs.endedWaiting",
};

export function getJobMessage(row: MessageRow, lang: Language): Message | undefined {
  const shown = jobPresentation(row);
  if (shown.queued && row.queuePosition?.reason) return { variant: "info", text: row.queuePosition.reason };
  if (shown.state === "needs-action" && !row.error) {
    const key = row.results?.at(-1)?.terminalReason === "approach-choice"
      ? "runner.approachChoice" : "wordPhase.stopAcceptanceCriteriaUnticked";
    const text = formatSentence(lang, { key });
    if (text) return { variant: "waiting", text };
  }
  const ended = ENDED[row.state];
  if (ended) {
    // A usage-limit stop is told in its own sentence, which names the
    // provider the stop was on.
    const limit = getUsageLimitMessage({ ...row, steps: [...row.steps] }, lang, Date.now());
    if (limit) return limit;
    return {
      // The badge's own colour: a wait is amber, a failure red.
      variant: row.state === "waiting" ? "waiting" : "failed",
      text: formatSentence(lang, row.error) || t(lang, ended),
      ...(jobDismissible({ ...row, specFolder: row.specFolder ?? "" }) ? { dismiss: `/api/queue/${row.id}/dismiss` } : {}),
    };
  }
  if (row.errorReason === "held-back") {
    const text = getUsageLimitMessage({ ...row, steps: [...row.steps] }, lang, Date.now())?.text ?? formatSentence(lang, row.error);
    if (text) return { variant: shown.queued ? "info" : "waiting", text };
  }
  return undefined;
}
