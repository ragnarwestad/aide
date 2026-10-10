// The Jobs tab's rules, as pure functions: which wiki builds and scheduled
// jobs it shows, where every row stands, what a job row is called, where the
// job belongs and what the row offers to stop it. They read only the fields a
// job and its row view share, so the route can run them on the raw jobs and
// the tests on plain objects.

import { t, type Language } from "../../../i18n";
import { scheduleNameOf } from "../../../queue/schedule.ts";
import { isWikiBuild, waitsForPerson } from "../../../queue/steps.ts";
import { inFlight, type QueueRowView } from "../../ui/job-state";
import { projectPagePath, projectScheduleTab } from "../projects-page/routes.ts";
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
type TitleRow = StateRow & Pick<QueueRowView, "specFolder" | "wikiRefresh">;

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

/** The wiki builds and scheduled jobs the tab shows: in flight, or waiting
 *  for a person and not yet dealt with. A waiting job is dealt with when a
 *  job of the same project and tracking key was created after it and was not
 *  cancelled; a scheduled job when its entry is deleted. A spec's job is never
 *  returned: its spec's row stands for it. */
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
    if (!isWikiBuild(job) && !isScheduleJob(job)) return false;
    if (inFlight(job)) return true;
    if (!waitsForPerson(job)) return false;
    if ((newest.get(sameJob(job)) ?? 0) > at(job)) return false;
    return !isScheduleJob(job) || o.scheduleEntryExists(job.project, scheduleNameOf(job.specFolder));
  });
}

/** What a job row is called: the wiki run or the scheduled job, named without
 *  its project, which the row draws before the name. */
export function jobTitle(row: TitleRow, lang: Language): string {
  if (isWikiBuild(row)) return t(lang, row.wikiRefresh ? "jobs.wikiRefresh" : "jobs.wikiBuild");
  return scheduleNameOf(row.specFolder);
}

/** The place the job belongs. */
export function jobHome(row: Pick<JobLike, "project" | "specFolder" | "steps">): string {
  if (isWikiBuild(row)) return `${projectPagePath(row.project)}?tab=wiki&wikitab=build`;
  return projectScheduleTab(row.project);
}

/** What a row offers to end its job: Cancel for a queued one, Stop for a
 *  running or landing one, nothing for a finished one. Never a Run. */
export function jobControl(row: StateRow): "cancel" | "stop" | undefined {
  if (!inFlight(row)) return undefined;
  return row.state === "queued" && !row.landing ? "cancel" : "stop";
}
