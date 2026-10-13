// The Jobs tab's rules, as pure functions: which scheduled jobs it shows,
// where every row stands, what a job row is called, what the line under its
// state says and what the row offers to stop it. They read only the fields a
// job and its row view share, so the route can run them on the raw jobs and
// the tests on plain objects.

import { scheduleNameOf } from "../../../queue/schedule.ts";
import { closeOrReopenStep, deployStep } from "../../../queue/queue.ts";
import { phaseKey } from "../specs-list/phase-messages/keys.ts";
import { stepLabel, type MessageVariant } from "../../ui/components";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { renderSentence } from "../../../i18n/message.ts";
import { waitsForPerson } from "../../../queue/steps.ts";
import { heldBackResolvesOnItsOwn, inFlight, type QueueRowView } from "../../ui/job-state";
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

/** The jobs that are rows of their own: the scheduled jobs, the Close and
 *  Reopen jobs and the board's own deploys, in flight, or waiting for a person and not yet dealt with. A
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
    if (!schedule && !closeOrReopenStep(job) && !deployStep(job)) return false;
    if (inFlight(job)) return true;
    if (!waitsForPerson(job)) return false;
    if ((newest.get(sameJob(job)) ?? 0) > at(job)) return false;
    return !schedule || o.scheduleEntryExists(job.project, scheduleNameOf(job.specFolder));
  });
}

/** What a job row is called, without its project, which the row draws
 *  before the name: the scheduled job, the Close or Reopen and its spec, or
 *  the deploy and the project it deploys. */
export function jobTitle(row: TitleRow & { project?: string }, lang: Language = "en"): string {
  if (deployStep(row)) return `${stepLabel("deploy", lang)} ${row.project ?? ""}`.trim();
  const step = closeOrReopenStep(row);
  return step ? `${stepLabel(step, lang)} ${row.specFolder}` : scheduleNameOf(row.specFolder);
}

/** The row's key, in the tab's `open`: a scheduled job's tracking key, or for a
 *  Close, Reopen or deploy its spec's (the deploy's `deploy`) and its step's, so
 *  it never folds with the spec's own row and the page hears the job's log grow
 *  while the row is open. */
export function jobKey(row: Pick<JobLike, "project" | "specFolder" | "steps" | "stepIndex">): string {
  const step = closeOrReopenStep(row) ?? deployStep(row);
  return step ? phaseKey(row.project, row.specFolder, step) : `${row.project}/${row.specFolder}`;
}

/** The line under a job row's state, or none. A job that failed, stopped or
 *  was interrupted says why, in its own sentence or, with none, in one saying
 *  how it ended, and the line carries the address of the job's own page for
 *  its Log link. A deploy held back says why it waits, with no link. Every
 *  other row has no line. */
export interface JobMessage {
  variant: MessageVariant;
  text: string;
  /** The job's own page, for the line's Log link; absent when it has none. */
  log?: string;
}

/** What the line reads: the row view's fields, with `steps` as `JobLike` has
 *  them, so the tests' plain jobs fit as `StateRow`'s do. */
type MessageRow = Pick<QueueRowView, "id" | "state" | "error" | "errorReason" | "stepIndex"> & {
  steps: readonly string[];
};

const ENDED: Partial<Record<QueueRowView["state"], TranslationKey>> = {
  failed: "jobs.endedFailed",
  stopped: "jobs.endedStopped",
  interrupted: "jobs.endedInterrupted",
};

export function jobMessage(row: MessageRow, lang: Language): JobMessage | undefined {
  const ended = ENDED[row.state];
  if (ended) {
    return {
      // The badge's own colour: a stop is amber, a failure red.
      variant: row.state === "stopped" ? "waiting" : "failed",
      text: renderSentence(lang, row.error) || t(lang, ended),
      log: `/jobs/${row.id}?tab=steps`,
    };
  }
  if (deployStep(row) && row.errorReason === "held-back") {
    const text = renderSentence(lang, row.error);
    if (text) return { variant: heldBackResolvesOnItsOwn(row) ? "info" : "waiting", text };
  }
  return undefined;
}

/** What a row offers to end its job: Cancel for a queued one, Stop for a
 *  running or landing one, nothing for a finished one. Never a Run. A Close or
 *  Reopen offers nothing: stopped part-way, it would leave the spec between
 *  its two places. A deploy offers Cancel while it is queued; once it runs it
 *  is the server itself and cannot be stopped. */
export function jobControl(row: StateRow): "cancel" | "stop" | undefined {
  if (!inFlight(row) || closeOrReopenStep(row)) return undefined;
  if (deployStep(row)) return row.state === "queued" ? "cancel" : undefined;
  return row.state === "queued" && !row.landing ? "cancel" : "stop";
}
