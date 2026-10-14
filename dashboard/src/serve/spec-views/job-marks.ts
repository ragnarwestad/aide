// What a Close's, Reopen's or deploy's line on the Running page lists: the steps the
// job's step log has marked (`stepMarks`), and for a job that ended any
// other way than done, or done with its merge into main stopped, the step
// it stopped at and why.
import type { Language } from "../../i18n";
import { renderSentence } from "../../i18n/message.ts";
import { stepLog, stepMarks, stepPlan, stepSlices, type LogPart, type PlannedStep, type StepMark } from "../../queue/parse-stream";
import type { Job } from "../../queue/queue.ts";
import { tailFileAt } from "../serve-helpers";
import { deployPlan } from "../deploy-job/plan.ts";
import { readRunLog } from "./job-detail.ts";

export function jobMarks(job: Job, lang: Language): { marks: StepMark[]; reason?: string; logs: LogPart[] } {
  // The running step's file, and once it has ended and lands, its result's.
  const result = job.results.at(-1);
  const file = job.streamFile ?? result?.streamFile;
  if (!file) return { marks: [], logs: [] };
  const { logs } = stepLog(tailFileAt(file, Infinity), readRunLog(file), {
    tool: result?.tool,
    final: job.state !== "running",
  });
  const marks = stepMarks(logs);
  const settled = job.state !== "queued" && job.state !== "running" && !(job.state === "done" && job.landing);
  // A done job whose merge into main stopped stays done, with the landing's
  // own record (`landingError`) and the merge step marked stopped.
  const mergeStopped = job.landingError !== undefined || marks.some((m) => m.state === "failed");
  if (!settled || (job.state === "done" && !mergeStopped)) return { marks, logs };
  // The step it stopped at: one the log says stopped, or else the last
  // one the log left running.
  const failed = marks.find((m) => m.state === "failed") ?? marks.findLast((m) => m.state === "running");
  if (failed) failed.state = "failed";
  const said = job.state === "done" ? job.landingError : (job.error ?? job.landingError);
  const reason = renderSentence(lang, said) || failed?.why;
  return reason ? { marks, reason, logs } : { marks, logs };
}

/** One step of a Close, Reopen or deploy: its state, and for Aide's own steps
 *  how long it took once ended, or when it started while it runs. */
export interface CloseOrReopenStep {
  key: string;
  label: string;
  state?: StepMark["state"];
  seconds?: number;
  since?: string;
  /** The step's own part of the job's Log (`stepSlices`), once it is marked. */
  logs?: LogPart[];
}

/** A job's steps as its row on the Running page lists them: every step of
 *  `plan`, each in the state the job's log has it in (none yet is waiting),
 *  then any step the log marked that the plan did not name. */
function jobSteps(job: Job, plan: PlannedStep[], lang: Language): CloseOrReopenStep[] {
  const { marks, logs } = jobMarks(job, lang);
  const marked = new Map(marks.map((m) => [m.key, m]));
  const slices = stepSlices(logs);
  const own = (key: string) => (slices.has(key) ? { logs: slices.get(key)! } : {});
  const keys = new Set(plan.map((p) => p.key));
  const start = Date.parse(job.stepStartedAt ?? job.startedAt ?? "");
  const timed = (m: StepMark | undefined) => {
    if (m?.startedSec === undefined) return {};
    if (m.endedSec !== undefined) return { seconds: m.endedSec - m.startedSec };
    return m.state === "running" && Number.isFinite(start) ? { since: new Date(start + m.startedSec * 1000).toISOString() } : {};
  };
  return [
    ...plan.map((p) => ({ key: p.key, label: p.label, state: marked.get(p.key)?.state, ...timed(marked.get(p.key)), ...own(p.key) })),
    ...marks.filter((m) => !keys.has(m.key)).map((m) => ({ key: m.key, label: m.title, state: m.state, ...timed(m), ...own(m.key) })),
  ];
}

/** A Close's or Reopen's steps: every step its skill plans. */
export function closeOrReopenSteps(job: Job, step: string, lang: Language): CloseOrReopenStep[] {
  return jobSteps(job, stepPlan(step), lang);
}

/** A deploy's five steps, in the reader's language. The process that starts
 *  after the restart marks its two in the same log, so they read done there. */
export function deploySteps(job: Job, lang: Language): CloseOrReopenStep[] {
  return jobSteps(job, deployPlan(lang), lang);
}
