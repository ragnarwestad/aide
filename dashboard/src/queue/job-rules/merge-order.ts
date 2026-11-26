// In a project the merges into main run one at a time, in the queue's
// order. A Merge job is a merge from the moment it is queued; any other job
// joins the back of the queue when it reaches its merge. A merge never goes
// before a Merge job or another merge that stands ahead of it and is waiting
// for its turn.

import type { Job } from "../types.ts";
import type { WaitingEntry } from "../waiting/types.ts";

const MERGES = new Set(["land", "archive"]);
// The holds that mean "another merge has its turn". A queued Merge job held
// for anything else is not waiting for its turn, and holds nothing back.
const TURN_HOLDS = new Set(["runner.mergeRunning", "runner.archiveRunning"]);
const stepOf = (job: Job): string => job.steps[job.stepIndex] ?? "";
const placeOf = (entries: readonly WaitingEntry[], jobId: string): number => entries.findIndex((entry) => entry.jobId === jobId);

/** A Merge job that has not merged yet, or an archive whose merge waits
 *  for its turn. A queued Merge job held for something else, such as a
 *  queued Deploy or a retry that is not due, waits for that instead. */
export function waitsForItsMerge(job: Job, admitted: ReadonlySet<string>, now = Date.now()): boolean {
  if (admitted.has(job.id) || !MERGES.has(stepOf(job))) return false;
  if (job.state !== "queued") return !!job.landing;
  if (stepOf(job) !== "land" || (job.retry?.dueAt && Date.parse(job.retry.dueAt) > now)) return false;
  const error = job.errorReason === "held-back" ? job.error : undefined;
  const hold = error && typeof error === "object" && !Array.isArray(error) ? error.key : undefined;
  return hold === undefined || TURN_HOLDS.has(hold);
}

/** The merge a merge waiting for its repository waits for: another merge in
 *  its project that is under way, or the first one ahead of it in the queue
 *  that is waiting for its turn. None when it may go now. */
function mergeAhead(
  entry: WaitingEntry,
  entries: readonly WaitingEntry[],
  jobs: readonly Job[],
  admitted: ReadonlySet<string>,
): { job: Job; underWay: boolean } | undefined {
  if (!entry.id.startsWith("merge:") || !entry.jobId || !MERGES.has(entry.operation)) return undefined;
  const others = jobs.filter((job) => job.id !== entry.jobId && job.project === entry.project);
  const underWay = others.find((job) => job.landing && admitted.has(job.id) && MERGES.has(stepOf(job)));
  if (underWay) return { job: underWay, underWay: true };
  const mine = placeOf(entries, entry.jobId);
  const waiting = others
    .map((job) => ({ job, place: placeOf(entries, job.id) }))
    .filter(({ job, place }) => place >= 0 && place < mine && waitsForItsMerge(job, admitted))
    .sort((a, b) => a.place - b.place)[0];
  return waiting && { job: waiting.job, underWay: false };
}

/** Whether a merge waiting for its repository may go now: no other merge
 *  in its project is under way, and none ahead of it is waiting. */
export function mergeHasItsTurn(
  entry: WaitingEntry,
  entries: readonly WaitingEntry[],
  jobs: readonly Job[],
  admitted: ReadonlySet<string>,
): boolean {
  return mergeAhead(entry, entries, jobs, admitted) === undefined;
}

/** What a merge waiting for its turn shows as its reason in the queue: the
 *  merge it waits for. None when it does not wait for another merge. */
export function mergeTurnReason(
  entry: WaitingEntry,
  entries: readonly WaitingEntry[],
  jobs: readonly Job[],
  admitted: ReadonlySet<string>,
): string | undefined {
  const ahead = mergeAhead(entry, entries, jobs, admitted);
  if (!ahead) return undefined;
  const name = stepOf(ahead.job) === "land"
    ? `the Merge of ${ahead.job.branch ?? ahead.job.specFolder}`
    : `the archive of ${ahead.job.specFolder}`;
  return `Waiting for ${name}, ${ahead.underWay ? "which is merging now" : "ahead of it in the queue"}`;
}

/** Whether `candidate`'s merge is still waiting, behind `job` in the queue. */
export function mergeWaitsBehind(
  candidate: Job,
  job: Job,
  entries: readonly WaitingEntry[],
  admitted: ReadonlySet<string>,
): boolean {
  if (admitted.has(candidate.id)) return false;
  const theirs = placeOf(entries, candidate.id);
  const mine = placeOf(entries, job.id);
  return theirs >= 0 && mine >= 0 && theirs > mine;
}
