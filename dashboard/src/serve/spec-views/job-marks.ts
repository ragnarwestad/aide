// What a Close's or Reopen's line on the Running page lists: the steps the
// job's step log has marked (`stepMarks`), and for a job that ended any
// other way than done, or done with its merge into main stopped, the step
// it stopped at and why — the sentence the spec page itself gives
// (`failedRoundSentence`).
import type { Language } from "../../i18n";
import { renderSentence } from "../../i18n/message.ts";
import { stepLog, stepMarks, stepPlan, type StepMark } from "../../queue/parse-stream";
import type { Job } from "../../queue/queue.ts";
import { tailFileAt } from "../serve-helpers";
import { readRunLog } from "./job-detail.ts";

export function jobMarks(job: Job, lang: Language): { marks: StepMark[]; reason?: string } {
  // The running step's file, and once it has ended and lands, its result's.
  const result = job.results.at(-1);
  const file = job.streamFile ?? result?.streamFile;
  if (!file) return { marks: [] };
  const { logs } = stepLog(tailFileAt(file, Infinity), readRunLog(file), {
    tool: result?.tool,
    final: job.state !== "running",
  });
  const marks = stepMarks(logs);
  const settled = job.state !== "queued" && job.state !== "running" && !(job.state === "done" && job.landing);
  // A done job whose merge into main stopped stays done, with the landing's
  // own record (`landingError`) and the merge step marked stopped.
  const mergeStopped = job.landingError !== undefined || marks.some((m) => m.state === "failed");
  if (!settled || (job.state === "done" && !mergeStopped)) return { marks };
  // The step it stopped at: one the log says stopped, or else the last
  // one the log left running.
  const failed = marks.find((m) => m.state === "failed") ?? marks.findLast((m) => m.state === "running");
  if (failed) failed.state = "failed";
  const said = job.state === "done" ? job.landingError : (job.error ?? job.landingError);
  const reason = renderSentence(lang, said) || failed?.why;
  return reason ? { marks, reason } : { marks };
}

/** A Close's or Reopen's steps as its line on the Running page lists them:
 *  every step its skill plans, each in the state the job's log has it in
 *  (none yet is waiting), then any step the log marked that the plan did
 *  not name. */
export function closeOrReopenSteps(
  job: Job,
  step: string,
  lang: Language,
): { key: string; label: string; state?: StepMark["state"] }[] {
  const { marks } = jobMarks(job, lang);
  const marked = new Map(marks.map((m) => [m.key, m.state]));
  const planned = stepPlan(step);
  const keys = new Set(planned.map((p) => p.key));
  return [
    ...planned.map((p) => ({ key: p.key, label: p.label, state: marked.get(p.key) })),
    ...marks.filter((m) => !keys.has(m.key)).map((m) => ({ key: m.key, label: m.title, state: m.state })),
  ];
}
