import { t, type Language, type TranslationKey } from "../../i18n/index.ts";
import { formatSentence } from "../format.ts";
import type { Message } from "../types.ts";
import type { QueueRowView } from "../../render/ui/job-state/types.ts";
import { stepLabel } from "../../format/step-label.ts";
import { heldBackResolvesOnItsOwn } from "./holds.ts";
import { getUsageLimitMessage } from "../usage-limit/get.ts";

/** The line under a job row's state, or none. A job that failed, stopped or
 *  was interrupted says why, in its own sentence or, with none, in one saying
 *  how it ended, and the line carries the address of the job's own page for
 *  its Log link. A held-back job says why it waits, with no link. A job
 *  whose step ran on another Claude account names it: after its own sentence
 *  when it has one, on a line of its own once it is done or cancelled. Every
 *  other row has no line. */
/** What the line reads: the row view's fields, with `steps` as `JobLike` has
 *  them, so the tests' plain jobs fit as `StateRow`'s do. */
type MessageRow = Pick<QueueRowView, "id" | "state" | "error" | "errorReason" | "stepIndex"> &
  Partial<Pick<QueueRowView, "stopReason" | "usageLimitWait" | "results" | "stepModels" | "model" | "provider" | "specFolder" | "landing">> & {
    steps: readonly string[];
  };

const ENDED: Partial<Record<QueueRowView["state"], TranslationKey>> = {
  failed: "jobs.endedFailed",
  stopped: "jobs.endedStopped",
  interrupted: "jobs.endedInterrupted",
};

/** The sentence naming the provider a job's step ran on, from the newest
 *  step result that names one; none when no step ran on an AI. */
function ranOnSentence(row: MessageRow, lang: Language): string | undefined {
  const result = [...(row.results ?? [])].reverse().find((r) => r.provider);
  if (!result?.provider) return undefined;
  return t(lang, "notice.providerRan", { step: stepLabel(result.step ?? row.steps[row.stepIndex] ?? "", lang), who: result.provider.name });
}

export function getJobMessage(row: MessageRow, lang: Language): Message | undefined {
  const ended = ENDED[row.state];
  if (ended) {
    // A usage-limit stop is told in its own sentence, which names the
    // provider the stop was on.
    const limit = getUsageLimitMessage({ ...row, steps: [...row.steps] }, lang, Date.now());
    if (limit) return limit;
    const own = formatSentence(lang, row.error) || t(lang, ended);
    const ranOn = ranOnSentence(row, lang);
    return {
      // The badge's own colour: a stop is amber, a failure red.
      variant: row.state === "stopped" ? "waiting" : "failed",
      text: ranOn ? `${own}\n${ranOn}` : own,
      log: `/jobs/${row.id}?tab=steps`,
    };
  }
  if (row.errorReason === "held-back") {
    const text = getUsageLimitMessage({ ...row, steps: [...row.steps] }, lang, Date.now())?.text ?? formatSentence(lang, row.error);
    if (text) return { variant: heldBackResolvesOnItsOwn(row) ? "info" : "waiting", text };
  }
  // Scheduled jobs use the state label alone; other jobs name their provider.
  if (row.provider && row.state !== "done" && row.state !== "cancelled" && row.steps[row.stepIndex] !== "schedule") {
    const step = row.steps[row.stepIndex] ?? row.steps[row.steps.length - 1] ?? "";
    return {
      variant: "info",
      text: t(lang, "notice.providerRuns", { step: stepLabel(step, lang), who: row.provider }),
    };
  }
  // A finished job says which provider its step ran on.
  if (row.state === "done" || row.state === "cancelled") {
    const text = ranOnSentence(row, lang);
    if (text) return { variant: "info", text };
  }
  return undefined;
}
