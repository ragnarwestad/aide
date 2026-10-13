// The Jobs tab's rules, as pure functions: which scheduled jobs it shows,
// where every row stands, what a job row is called, where the job belongs
// and what the row offers to stop it. They read only the fields a
// job and its row view share, so the route can run them on the raw jobs and
// the tests on plain objects.

import { scheduleNameOf } from "../../../queue/schedule.ts";
import { closeOrReopenStep } from "../../../queue/queue.ts";
import { phaseKey } from "../specs-list/phase-messages/keys.ts";
import { stepLabel } from "../../ui/components";
import { specPagePath } from "../spec-page/tabs.ts";
import type { Language } from "../../../i18n";
import { waitsForPerson } from "../../../queue/steps.ts";
import { inFlight, type QueueRowView } from "../../ui/job-state";
import { projectScheduleTab } from "../projects-page";
import type { SpecGroup } from "../specs-list";

/** What a job and its row view have in common, and all the rules read. */
export interface JobLike {
  id: string;
  project: string;
  specFolder: string;
  steps: readonly string[];
  stepIndex: number;
  state: QueueRowView["state"];
  landing?: boolean;
  createdAt: string;
  landingError?: unknown;
  results?: readonly { terminalReason?: string }[];
}

type StateRow = Pick<QueueRowView, "state" | "landing" | "stepIndex"> & { steps: readonly string[] };
type TitleRow = { specFolder: string; steps: readonly string[]; stepIndex: number };

export const isScheduleJob = (job: { steps: readonly string[]; specFolder: string }): boolean =>
  job.steps.length === 1 && job.steps[0] === "schedule" && job.specFolder.startsWith("schedule-");

const at = (job: JobLike): number => Date.parse(job.createdAt) || 0;
const sameJob = (job: JobLike): string => `${job.project}\0${job.specFolder}`;

/** 0 running or landing, 1 queued, 2 waiting for the user. */
const group = (job: JobLike): 0 | 1 | 2 => (job.state === "running" || job.landing ? 0 : job.state === "queued" ? 1 : 2);

/** Where a row stands: its band (0 running or landing, 1 queued, 2 the rest)
 *  and when it last changed, in milliseconds. */
export interface TabPlace {
  band: 0 | 1 | 2;
  changedAt: number;
}

/** The newest of a job's own stamps: made, started, finished. Not
 *  `activityMs`, which leaves out the finish and picks a spec's lead job. */
const lastStamp = (j: { createdAt: string; startedAt?: string; finishedAt?: string }): number =>
  Math.max(0, ...[j.createdAt, j.startedAt, j.finishedAt].map((s) => Date.parse(s ?? "")).filter(Number.isFinite));

export const jobPlace = (job: JobLike & { startedAt?: string; finishedAt?: string }): TabPlace => ({
  band: group(job),
  changedAt: lastStamp(job),
});

/** A spec's band is its row's state (a landing lead already reads `running`);
 *  its change is its lead job's newest stamp, or, with no job of its round,
 *  the day it was made. A spec git has not dated yet, with no job, was made
 *  moments ago: it is the newest, as the list's `sortGroups` treats it. */
export const specPlace = (g: Pick<SpecGroup, "state" | "lead" | "createdAt">): TabPlace => ({
  band: g.state === "running" ? 0 : g.state === "queued" ? 1 : 2,
  changedAt:
    !g.lead && !g.createdAt
      ? Number.MAX_SAFE_INTEGER
      : Math.max(g.lead ? lastStamp(g.lead) : 0, Date.parse(g.createdAt ?? "") || 0),
});

/** Running or landing first, then queued, then the rest; the newest change first in each. */
export const byTabPlace = (a: TabPlace, b: TabPlace): number => a.band - b.band || b.changedAt - a.changedAt;

/** The jobs that are rows of their own: the scheduled jobs and the Close and
 *  Reopen jobs, in flight, or waiting for a person and not yet dealt with. A
 *  waiting job is dealt with when a job of the same project and tracking key
 *  was created after it and was not cancelled; a scheduled job also when its
 *  entry is deleted. Any other job of a spec is never returned: its spec's row
 *  stands for it. */
export function jobsShown<T extends JobLike>(
  jobs: T[],
  o: {
    scheduleEntryExists: (project: string, name: string) => boolean;
  },
): T[] {
  const newest = new Map<string, number>();
  // A cancelled run is a person ending it, not a run that succeeded, so it
  // does not deal with an earlier job's failure.
  for (const job of jobs.filter((j) => j.state !== "cancelled")) newest.set(sameJob(job), Math.max(newest.get(sameJob(job)) ?? 0, at(job)));
  return jobs.filter((job) => {
    const schedule = isScheduleJob(job);
    if (!schedule && !closeOrReopenStep(job)) return false;
    if (inFlight(job)) return true;
    if (!waitsForPerson(job)) return false;
    if ((newest.get(sameJob(job)) ?? 0) > at(job)) return false;
    return !schedule || o.scheduleEntryExists(job.project, scheduleNameOf(job.specFolder));
  });
}

/** What a job row is called, without its project, which the row draws
 *  before the name: the scheduled job, or the Close or Reopen and its spec. */
export function jobTitle(row: TitleRow, lang: Language = "en"): string {
  const step = closeOrReopenStep(row);
  return step ? `${stepLabel(step, lang)} ${row.specFolder}` : scheduleNameOf(row.specFolder);
}

/** The row's key, in the tab's `open`: a scheduled job's tracking key, or for a
 *  Close or Reopen its spec's and its step's, so it never folds with the spec's
 *  own row and the page hears the job's log grow while the row is open. */
export function jobKey(row: Pick<JobLike, "project" | "specFolder" | "steps" | "stepIndex">): string {
  const step = closeOrReopenStep(row);
  return step ? phaseKey(row.project, row.specFolder, step) : `${row.project}/${row.specFolder}`;
}

/** The place the job belongs: the Schedule tab, or the spec a Close or Reopen works on. */
export function jobHome(row: Pick<JobLike, "project" | "specFolder" | "steps" | "stepIndex">): string {
  return closeOrReopenStep(row) ? specPagePath(row.project, row.specFolder) : projectScheduleTab(row.project);
}

/** What a row offers to end its job: Cancel for a queued one, Stop for a
 *  running or landing one, nothing for a finished one. Never a Run. A Close or
 *  Reopen offers nothing: stopped part-way, it would leave the spec between
 *  its two places. */
export function jobControl(row: StateRow): "cancel" | "stop" | undefined {
  if (!inFlight(row) || closeOrReopenStep(row)) return undefined;
  return row.state === "queued" && !row.landing ? "cancel" : "stop";
}
