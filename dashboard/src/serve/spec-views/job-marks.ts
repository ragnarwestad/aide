// What a Close's, Reopen's, deploy's or scheduled job's line on the Running page lists: the steps the
// job's step log has marked (`stepMarks`), and for a job that ended any
// other way than done, or done with its merge into main stopped, the step
// it stopped at and why.
import { statSync } from "node:fs";
import { runLogPath } from "../../queue/runner/run-log-path.ts";
import { t, type Language } from "../../i18n";
import { formatSentence } from "../../messages/format.ts";
import { stepLog, stepMarks, stepPlan, stepSlices, stepTokens, schedulePlan, type LogPart, type PlannedStep, type StepMark } from "../../queue/parse-stream";
import { stepKey } from "../../queue/parse-stream/step-marks.ts";
import { inFlight, jobKind, writing, type Job } from "../../queue/queue.ts";
import { tailFileAt } from "../serve-helpers";
import { deployPlan } from "../deploy-job/plan.ts";
import { CLEANUP_OPERATIONS } from "../process-cleanup/engine.ts";
import { readRunLog } from "./job-detail.ts";

const cleanupPlan = (lang: Language, marks: StepMark[]): PlannedStep[] => {
  const count = marks.some(mark => /^Step \d+ of 4$/.test(mark.key)) ? 4 : CLEANUP_OPERATIONS.length;
  return CLEANUP_OPERATIONS.slice(0, count).map(({ label }, index) => ({ key: stepKey(`${index + 1} of ${count}`, ""), label: t(lang, label) }));
};

const LAND_LABELS = ["Merge branch", "Run tests", "Push default branch", "Delete source branch"];
const landPlan = (): PlannedStep[] => LAND_LABELS.map((label, index) => ({ key: stepKey(`${index + 1} of 4`, ""), label }));

function readJobMarks(job: Job, lang: Language): { marks: StepMark[]; reason?: string; logs: LogPart[] } {
  // The running step's file, and once it has ended and lands, its result's.
  const result = job.results.at(-1);
  const file = job.streamFile ?? result?.streamFile;
  if (!file) return { marks: [], logs: [] };
  const transcript = tailFileAt(file, Infinity);
  const { logs } = stepLog(transcript, readRunLog(file), {
    tool: result?.tool,
    final: job.state !== "running",
  });
  const marks = stepMarks(logs, stepTokens(transcript.text, result?.tool));
  const settled = job.state !== "queued" && job.state !== "running" && !(job.state === "done" && job.landing);
  // A done job whose merge into main stopped stays done, with the landing's
  // own record (`landingError`) and the merge step marked stopped.
  const mergeStopped = job.landingError !== undefined || marks.some((m) => m.state === "failed");
  if (!settled || (job.state === "done" && !mergeStopped)) return { marks, logs };
  // The step it stopped at: one the log says stopped, or else the last
  // one the log left running.
  const failed = marks.findLast((m) => m.state === "running" || m.state === "failed");
  if (failed) failed.state = job.state === "cancelled" ? "cancelled" : "failed";
  const said = job.state === "done" ? job.landingError : (job.error ?? job.landingError);
  const reason = formatSentence(lang, said) || failed?.why;
  return reason ? { marks, reason, logs } : { marks, logs };
}

type Snapshot = ReturnType<typeof readJobMarks>;
const mergeSnapshots = new Map<string, { stamp: string; snapshot: Snapshot }>();
function signature(path: string | undefined): unknown {
  if (!path) return null;
  try { const s = statSync(path); return [path, s.ino, s.size, s.mtimeMs, s.ctimeMs]; }
  catch { return [path, "missing"]; }
}

function mergeStamp(job: Job, lang: Language): string {
  const file = job.streamFile ?? job.results.at(-1)?.streamFile;
  return JSON.stringify([lang, signature(file), signature(file ? runLogPath(file) : undefined),
    job.state, job.landing, job.error, job.landingError, job.results.at(-1)]);
}

export function jobMarks(job: Job, lang: Language): Snapshot {
  if (jobKind(job) !== "land") return readJobMarks(job, lang);
  const stamp = mergeStamp(job, lang);
  const key = `${job.id}|${lang}`;
  const kept = mergeSnapshots.get(key);
  if (kept?.stamp === stamp) return structuredClone(kept.snapshot);
  const snapshot = readJobMarks(job, lang);
  mergeSnapshots.delete(key);
  mergeSnapshots.set(key, { stamp, snapshot });
  if (mergeSnapshots.size > 2000) mergeSnapshots.delete(mergeSnapshots.keys().next().value!);
  return structuredClone(snapshot);
}

/** One step of a Close, Reopen, deploy, scheduled job or a spec's phase: its state, how long it took
 *  once ended, or when it started while it runs (for a step whose start the run log dated: Aide's
 *  own, and the model's in a run whose runner recorded its marks), and the tokens the stream
 *  reported while it ran. */
export interface CloseOrReopenStep {
  key: string;
  label: string;
  state?: StepMark["state"];
  seconds?: number;
  since?: string;
  tokens?: number;
  /** The step's own part of the job's Log (`stepSlices`), once it is marked. */
  logs?: LogPart[];
}

/** The steps of a log as a line each: every step of `plan`, each in the state the log has it in (none
 *  yet is waiting), then any step the log marked that the plan did not name. `start` is when the run
 *  began, which a step's stamp counts from; `running` is whether the run still goes, so a step a dead
 *  run left open does not count for ever. */
export function stepLinesOf(marks: StepMark[], logs: LogPart[], plan: PlannedStep[], start: number, running: boolean): CloseOrReopenStep[] {
  const marked = new Map(marks.map((m) => [m.key, m]));
  const slices = stepSlices(logs);
  const own = (key: string) => (slices.has(key) ? { logs: slices.get(key)! } : {});
  const keys = new Set(plan.map((p) => p.key));
  const timed = (m: StepMark | undefined) => {
    if (m?.startedSec === undefined) return {};
    if (m.endedSec !== undefined) return { seconds: m.endedSec - m.startedSec };
    return running && m.state === "running" && Number.isFinite(start) ? { since: new Date(start + m.startedSec * 1000).toISOString() } : {};
  };
  const used = (m: StepMark | undefined) => (m?.tokens !== undefined ? { tokens: m.tokens } : {});
  return [
    ...plan.map((p) => ({ key: p.key, label: p.label, state: marked.get(p.key)?.state, ...timed(marked.get(p.key)), ...used(marked.get(p.key)), ...own(p.key) })),
    ...marks.filter((m) => !keys.has(m.key)).map((m) => ({ key: m.key, label: m.title, state: m.state, ...timed(m), ...used(m), ...own(m.key) })),
  ];
}

/** A job's steps as its row on the Running page lists them. A job held
 *  back waits, so the step its log had started is waiting again. */
function jobSteps(job: Job, plan: PlannedStep[], lang: Language): CloseOrReopenStep[] {
  const { marks, logs } = jobMarks(job, lang);
  // A done job whose merge into main is still landing goes on.
  const going = writing(job);
  const steps = stepLinesOf(marks, logs, plan, Date.parse(job.stepStartedAt ?? job.startedAt ?? ""), going);
  if (job.errorReason !== "held-back" || !inFlight(job)) return steps;
  return steps.map((step) => step.state === "running" ? { ...step, state: undefined, since: undefined } : step);
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

/** Every declared schedule step waits until the run marks it. */
export function scheduleSteps(job: Job, lang: Language, prompt = ""): CloseOrReopenStep[] {
  const { marks, logs } = jobMarks(job, lang);
  const plan = jobKind(job) === "cleanup" ? cleanupPlan(lang, marks) : schedulePlan(logs, prompt);
  return stepLinesOf(marks, logs, plan, Date.parse(job.stepStartedAt ?? job.startedAt ?? ""), writing(job));
}

export function jobStepLines(job: Job, lang: Language, prompt = ""): CloseOrReopenStep[] {
  const kind = jobKind(job);
  if (kind === "deploy") return deploySteps(job, lang);
  if (kind === "land") return jobSteps(job, landPlan(), lang);
  if (kind === "cleanup" || kind === "schedule") return scheduleSteps(job, lang, prompt);
  if (kind === "close" || kind === "reopen") return closeOrReopenSteps(job, kind, lang);
  return [];
}

/** One step of a job as its pip draws it: the step's name and its state. */
export interface JobStepPip { label: string; state?: StepMark["state"] }

const PIPS_KEPT = 2000;
const pipsRead = new Map<string, { stamp: string; pips: JobStepPip[] }>();

/** A job's steps as its row's pips draw them. A finished job's log no longer
 *  changes, so its steps are read once and kept; a queued, running or
 *  landing job's are read every time. */
export function jobStepPips(job: Job, lang: Language, prompt = ""): JobStepPip[] {
  const read = (): JobStepPip[] => jobStepLines(job, lang, prompt).map(({ label, state }) => ({ label, state }));
  if (inFlight(job)) return read();
  const stamp = jobKind(job) === "land" ? mergeStamp(job, lang) : `${job.state}|${job.finishedAt ?? ""}|${lang}|${prompt}`;
  const kept = pipsRead.get(job.id);
  if (kept?.stamp === stamp) return kept.pips;
  const pips = read();
  pipsRead.delete(job.id);
  pipsRead.set(job.id, { stamp, pips });
  if (pipsRead.size > PIPS_KEPT) pipsRead.delete(pipsRead.keys().next().value!);
  return pips;
}
