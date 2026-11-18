import { t, type Language, type TranslationKey } from "../../i18n/index.ts";
import { formatSentence } from "../format.ts";
import type { Message } from "../types.ts";
import type { QueueRowView } from "../../render/ui/job-state/types.ts";
import { jobPresentation } from "../../render/ui/job-state/presentation.ts";
import { getUsageLimitMessage } from "../usage-limit/get.ts";

/** The line under a job row's state, or none. A job that failed, stopped or
 *  was interrupted says why, in its own sentence or, with none, in one saying
 *  how it ended, and the line carries the address of the job's own page for
 *  its Log link. A held-back job says why it waits, with no link. Every
 *  other row has no line: the AI a step runs on is on its phase line. */
/** What the line reads: the row view's fields, with `steps` as `JobLike` has
 *  them, so the tests' plain jobs fit as `StateRow`'s do. */
type MessageRow = Pick<QueueRowView, "id" | "state" | "error" | "errorReason" | "stepIndex"> &
  Partial<Pick<QueueRowView, "stopReason" | "usageLimitWait" | "results" | "stepModels" | "model" | "provider" | "specFolder" | "landing" | "queuePosition">> & {
    steps: readonly string[];
  };

const ENDED: Partial<Record<QueueRowView["state"], TranslationKey>> = {
  failed: "jobs.endedFailed",
  stopped: "jobs.endedStopped",
  interrupted: "jobs.endedInterrupted",
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
      // The badge's own colour: a stop is amber, a failure red.
      variant: row.state === "stopped" ? "waiting" : "failed",
      text: formatSentence(lang, row.error) || t(lang, ended),
      log: `/jobs/${row.id}?tab=steps`,
    };
  }
  if (row.errorReason === "held-back") {
    const text = getUsageLimitMessage({ ...row, steps: [...row.steps] }, lang, Date.now())?.text ?? formatSentence(lang, row.error);
    if (text) return { variant: shown.queued ? "info" : "waiting", text };
  }
  return undefined;
}
