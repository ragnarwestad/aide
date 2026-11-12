// The Jobs tab's rules, as pure functions: which scheduled jobs it shows,
// where every row stands, what a job row is called, what the line under its
// state says and what the row offers to stop it. They read only the fields a
// job and its row view share, so the route can run them on the raw jobs and
// the tests on plain objects.

import { isScheduleKey, scheduleNameOf } from "../../../project/spec-names.ts";
import { inFlight, jobActivity, jobKind } from "../../../queue/queue.ts";
import { phaseKey } from "../specs-list/phase-messages/keys.ts";
import { stepLabel } from "../../ui/components";
import { type Language } from "../../../i18n";
import { waitsForPerson } from "../../../queue/steps.ts";
import { type QueueRowView } from "../../ui/job-state";
import type { SpecGroup } from "../specs-list";
import { specReference } from "../../../project/spec-folder.ts";
import { requireWorkflowStep } from "../../../workflow-steps.ts";

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
  startedAt?: string;
  finishedAt?: string;
  landingError?: unknown;
  results?: readonly { terminalReason?: string }[];
}

type StateRow = Pick<QueueRowView, "state" | "landing" | "stepIndex"> & { steps: readonly string[] };
type TitleRow = { project: string; specFolder: string; steps: readonly string[]; stepIndex: number };

/** Whether a job's row offers Dismiss, and the dismiss route takes it: a
 *  scheduled job that failed, stopped or was interrupted. */
const at = (job: JobLike): number => Date.parse(job.createdAt) || 0;

/** 0 running or landing, 1 queued, 2 waiting for the user. */
const BAND = { running: 0, landing: 0, queued: 1, idle: 3 } as const;
const group = (job: JobLike): 0 | 1 | 2 | 3 => {
  const activity = jobActivity(job);
  if (activity !== "idle") return BAND[activity];
  return waitsForPerson(job) ? 2 : 3;
};

/** Where a row stands: its band (0 running or landing, 1 queued, 2 the rest)
 *  and when it last changed, in milliseconds. */
export interface TabPlace {
  band: 0 | 1 | 2 | 3;
  changedAt: number;
}

/** The newest of a job's own stamps: made, started, finished. Not
 *  `activityMs`, which leaves out the finish and picks a spec's lead job. */
const lastStamp = (j: { createdAt: string; startedAt?: string; finishedAt?: string }): number =>
  Math.max(0, ...[j.createdAt, j.startedAt, j.finishedAt].map((s) => Date.parse(s ?? "")).filter(Number.isFinite));

export const jobPlace = (
  job: JobLike,
  history: readonly JobLike[] = [],
  scheduleEntryExists?: (project: string, name: string) => boolean,
): TabPlace => {
  const band = group(job);
  if (band !== 2) return { band, changedAt: lastStamp(job) };
  const schedule = jobKind(job) === "schedule";
  const superseded = history.some((later) =>
    later.project === job.project && later.specFolder === job.specFolder &&
    (schedule || later.state !== "cancelled") && at(later) > at(job));
  const deleted = schedule && scheduleEntryExists !== undefined &&
    !scheduleEntryExists(job.project, scheduleNameOf(job.specFolder));
  return { band: superseded || deleted ? 3 : 2, changedAt: lastStamp(job) };
};

/** A spec's band is its row's state (a landing lead already reads `running`);
 *  its change is the newest stamp of its lead job and of the jobs of its
 *  round, or, with no job, the day it was made. A spec git has not dated yet,
 *  with no job, was made moments ago: it is the newest, as the list's
 *  `sortGroups` treats it. */
export const specPlace = (g: Pick<SpecGroup, "state" | "lead" | "createdAt">, jobs: readonly JobLike[] = []): TabPlace => ({
  band: g.state === "running" ? 0 : g.state === "queued" ? 1 : ["archived", "closed"].includes(g.state) ? 3 : 2,
  changedAt:
    !g.lead && !g.createdAt && !jobs.length
      ? Number.MAX_SAFE_INTEGER
      : Math.max(g.lead ? lastStamp(g.lead) : 0, ...jobs.map(lastStamp), Date.parse(g.createdAt ?? "") || 0),
});

/** Running or landing first, then queued, then the rest; the newest change first in each. */
export const byTabPlace = (a: TabPlace, b: TabPlace): number => a.band - b.band || b.changedAt - a.changedAt;

/** The jobs that are rows of their own: the scheduled jobs, the Close and
 *  Reopen jobs and the board's own deploys, in flight, or waiting for a person and not yet dealt with. A
 *  waiting job is dealt with when a job of the same project and tracking key
 *  was created after it and was not cancelled; a scheduled job also when its
 *  entry is deleted or a person dismissed it. Any other job of a spec is never returned: its spec's row
 *  stands for it. */
export function jobsShown<T extends JobLike & { dismissedAt?: string }>(
  jobs: T[],
  o: {
    scheduleEntryExists: (project: string, name: string) => boolean;
  },
): T[] {
  void o;
  return jobs.filter((job) => {
    if (!requireWorkflowStep(job.steps[job.stepIndex] ?? "").ownRow) return false;
    return true;
  });
}

export interface SpecRound<T extends JobLike> {
  key: string;
  startedAt: string;
  jobs: T[];
}

/** Successive runs of one spec. A successful Reopen starts the next round;
 * the Reopen itself belongs to the round it started. */
export function specRounds<T extends JobLike>(jobs: T[], createdAt?: string): SpecRound<T>[] {
  if (!jobs.length) return [];
  const ordered = [...jobs].sort((a, b) => at(a) - at(b));
  const firstStart = createdAt ?? ordered[0]!.createdAt;
  const rounds: SpecRound<T>[] = [{ key: "", startedAt: firstStart, jobs: [] }];
  for (const job of ordered) {
    const startsRound = jobKind(job) === "reopen" && job.state === "done" && !job.landing;
    if (startsRound && rounds.at(-1)!.jobs.length) {
      const startedAt = job.finishedAt ?? job.startedAt ?? job.createdAt;
      rounds.push({ key: "", startedAt, jobs: [] });
    }
    rounds.at(-1)!.jobs.push(job);
  }
  return rounds.map((round, index) => ({
    ...round,
    key: index === 0
      ? `${ordered[0]!.project}/${ordered[0]!.specFolder}`
      : `${ordered[0]!.project}/${ordered[0]!.specFolder}@${encodeURIComponent(round.startedAt)}`,
  }));
}

/** The `<project>/<folder>` keys of the specs a Close or Reopen in flight
 *  stands for: the tab draws the job's row alone, so the spec is never on it
 *  twice while it moves. A failed one stands for nothing, and its spec's row
 *  stays beside it. */
export function specsStoodForByJobs(shown: readonly JobLike[]): Set<string> {
  return new Set(shown.filter((j) => ["close", "reopen"].includes(jobKind(j)) && inFlight(j)).map((j) => `${j.project}/${j.specFolder}`));
}

/** What a job row is called, without its project, which the row draws
 *  before the name: the scheduled job, the Close or Reopen and its spec, or
 *  the deploy and the project it deploys. */
export function jobTitle(row: TitleRow, lang: Language = "en"): string {
  const kind = jobKind(row);
  if (kind === "deploy") return `${stepLabel("deploy", lang)} ${row.project}`.trim();
  if (kind === "cleanup") return stepLabel("cleanup", lang);
  const step = kind === "close" || kind === "reopen" ? kind : undefined;
  return step ? `${stepLabel(step, lang)} ${specReference(row.project, row.specFolder)}` : scheduleNameOf(row.specFolder);
}

/** The row's key, in the tab's `open`: a scheduled job's tracking key, or for a
 *  Close, Reopen or deploy its spec's (the deploy's `deploy`) and its step's, so
 *  it never folds with the spec's own row and the page hears the job's log grow
 *  while the row is open. */
export function jobKey(row: Pick<JobLike, "id" | "project" | "specFolder" | "steps" | "stepIndex">): string {
  const kind = jobKind(row);
  return kind === "spec" || kind === "schedule" ? `${row.project}/${row.specFolder}` : phaseKey(row.project, row.specFolder, kind);
}

/** Each job row's own key, by job id: the newest job of a key keeps it, so
 *  the page hears its log grow while it runs, and each older one is
 *  `<key>@<its id>`, so opening one row never opens another. */
export function jobRowKeys(jobs: readonly JobLike[]): Map<string, string> {
  const newest = new Map<string, JobLike>();
  for (const job of jobs) {
    const key = jobKey(job);
    const seen = newest.get(key);
    if (!seen || at(job) > at(seen)) newest.set(key, job);
  }
  return new Map(jobs.map((job) => {
    const key = jobKey(job);
    return [job.id, newest.get(key) === job ? key : `${key}@${job.id}`];
  }));
}

/** The key the event stream listens on for a scheduled job's row key in
 *  `open`: its running step's phase key, `<project>/schedule-<name>:schedule`,
 *  the key `createStreamGrowth` gives it. Undefined for any other key. */
export function scheduleStreamKey(key: string): string | undefined {
  const slash = key.indexOf("/");
  const folder = key.slice(slash + 1);
  if (slash <= 0 || key.includes(":") || !isScheduleKey(folder)) return undefined;
  return phaseKey(key.slice(0, slash), folder, "schedule");
}

/** What a row offers to end its job: Cancel for a queued one, Stop for a
 *  running or landing one, nothing for a finished one. Never a Run. A Close or
 *  Reopen offers nothing: stopped part-way, it would leave the spec between
 *  its two places. A deploy offers Cancel while it is queued; once it runs it
 *  is the server itself and cannot be stopped. */
export function jobControl(row: StateRow): "cancel" | "stop" | undefined {
  const step = row.steps[row.stepIndex];
  const kind = step === "close" || step === "reopen" || step === "deploy" ? step : "spec";
  if (!inFlight(row) || kind === "close" || kind === "reopen") return undefined;
  if (kind === "deploy") return row.state === "queued" ? "cancel" : undefined;
  return row.state === "queued" && !row.landing ? "cancel" : "stop";
}
