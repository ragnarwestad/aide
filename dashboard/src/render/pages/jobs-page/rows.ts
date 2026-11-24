import { t } from "../../../i18n";
import { scheduleRunPath, scheduleSettingsPath } from "../schedule-page/tabs.ts";
// The Jobs tab's rules, as pure functions: which scheduled jobs it shows,
// where every row stands, what a job row is called, what the line under its
// state says and what the row offers to stop it. They read only the fields a
// job and its row view share, so the route can run them on the raw jobs and
// the tests on plain objects.

import { isScheduleKey, scheduleNameOf } from "../../../project/spec-names.ts";
import { inFlight, jobActivity, jobKind } from "../../../queue/queue.ts";
import { phaseKey } from "../specs-list/phase-messages/keys.ts";
import { stepLabel, type RowKind } from "../../ui/components";
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
  branch?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  landingError?: unknown;
  results?: readonly { terminalReason?: string }[];
  removedAt?: string;
  queuePosition?: { n: number };
}

type TitleRow = { project: string; specFolder: string; steps: readonly string[]; stepIndex: number; deployCommit?: string; branch?: string; mergeTarget?: string };

/** A standalone Jobs card needs a job or a record of work beyond creating the spec.
 *  Before the board's first specs sweep has read the specs, nothing says a spec has none. */
export function specHasWork(g: SpecGroup, specsScanned = true): boolean {
  return !specsScanned || !!g.recordedWork || !!g.lead || !!g.archive || g.done.some((step) => step !== "create") ||
    g.phases.some((phase) => phase.step !== "create" && !!(phase.history.stopped || phase.history.historyDone));
}

/** A card's rows, each marked with the kind of job it is, which colours the card's edge. */
export const markedWithKind = (html: string, kind: RowKind): string =>
  html.replace(/<tr(\s[^>]*)?>/g, (_, attrs = "") => `<tr${attrs} data-kind="${kind}">`);

/** The kind a job's row is marked as. A Close or a Reopen is work on a spec. */
export function jobRowKind(row: Pick<JobLike, "steps" | "stepIndex" | "specFolder">): RowKind {
  const kind = jobKind(row);
  return kind === "close" || kind === "reopen" ? "spec" : kind;
}

const at = (job: JobLike): number => Date.parse(job.createdAt) || 0;

/** 0 running or landing, 1 queued, 2 waiting for the user. */
const BAND = { running: 0, landing: 0, queued: 1, idle: 3 } as const;
const group = (job: JobLike): 0 | 1 | 2 | 3 => {
  const activity = jobActivity(job);
  if (activity !== "idle") return BAND[activity];
  return waitsForPerson(job) ? 2 : 3;
};

/** Where a row stands: its band (0 running or landing, 1 queued, 2 waiting
 *  for a person, 3 the rest), when it last changed, in milliseconds, and,
 *  queued, its place in the queue's own order. */
export interface TabPlace {
  band: 0 | 1 | 2 | 3;
  changedAt: number;
  queued?: number;
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
  // A place in the queue reads Queued n/N on the row, whatever the job's own
  // state, and puts it in the queue's order too.
  if (job.queuePosition) return queuedPlace(lastStamp(job), job.queuePosition);
  const band = group(job);
  if (band === 1) return queuedPlace(lastStamp(job), job.queuePosition);
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
 *  `sortGroups` treats it — unless it is archived or closed, when it is
 *  old work and stands last. */
export const specPlace = (g: Pick<SpecGroup, "state" | "lead" | "createdAt">, jobs: readonly JobLike[] = []): TabPlace => {
  const changedAt =
    !g.lead && !g.createdAt && !jobs.length
      ? ["archived", "closed"].includes(g.state) ? 0 : Number.MAX_SAFE_INTEGER
      : Math.max(g.lead ? lastStamp(g.lead) : 0, ...jobs.map(lastStamp), Date.parse(g.createdAt ?? "") || 0);
  if (g.state === "queued" || g.lead?.queuePosition) return queuedPlace(changedAt, g.lead?.queuePosition);
  return { band: g.state === "running" ? 0 : ["archived", "closed"].includes(g.state) ? 3 : 2, changedAt };
};

/** A queued row's place: the queue's own position when it has one. */
export const queuedPlace = (changedAt: number, position?: { n: number }): TabPlace =>
  position ? { band: 1, changedAt, queued: position.n } : { band: 1, changedAt };

/** Running or landing first, then queued in the order the queue starts them
 *  (a row with a place in the queue counts as queued, as its badge reads),
 *  then the rest; the newest change first everywhere else. A queued row
 *  without a position follows those with one. */
export const byTabPlace = (a: TabPlace, b: TabPlace): number =>
  a.band - b.band || byQueue(a, b) || b.changedAt - a.changedAt;

const byQueue = (a: TabPlace, b: TabPlace): number =>
  a.queued === undefined || b.queued === undefined
    ? Number(a.queued === undefined) - Number(b.queued === undefined)
    : a.queued - b.queued;

/** Standalone job cards: every attempt, Merge attempts for one branch
 *  included, until Remove takes one off. Nothing leaves Jobs on its own. */
export function jobsShown<T extends JobLike>(
  jobs: T[],
  o: {
    scheduleEntryExists: (project: string, name: string) => boolean;
  },
): T[] {
  void o;
  return jobs.filter((job) => !job.removedAt && requireWorkflowStep(job.steps[job.stepIndex] ?? "").ownRow);
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
 *  the deploy, the project it deploys and the commit its fetch reached. */
export function jobTitle(row: TitleRow, lang: Language = "en"): string {
  const kind = jobKind(row);
  if (kind === "deploy") {
    const named = `${stepLabel("deploy", lang)} ${row.project}`.trim();
    return row.deployCommit ? `${named} · ${row.deployCommit.slice(0, 7)}` : named;
  }
  if (kind === "land") {
    const title = t(lang, "jobs.mergeTo", { branch: row.mergeTarget ?? t(lang, "jobs.unknownDefaultBranch") });
    return row.branch ? `${title} · ${row.branch}` : title;
  }
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

/** Each job row's own key, by job id. A spec's row is the spec's, so its
 *  newest job keeps the spec's key and each older one is `<key>@<its id>`.
 *  Every other row is `<key>@<its id>`, newest included: a Merge, a deploy
 *  or a scheduled run is its own job, and the next one queued must not open
 *  because the last one was. The event stream reads the key before the `@`
 *  (`streamKey`), so an open row still hears its job's log grow. */
export function jobRowKeys(jobs: readonly JobLike[]): Map<string, string> {
  const newest = new Map<string, JobLike>();
  for (const job of jobs) {
    const key = jobKey(job);
    const seen = newest.get(key);
    if (!seen || at(job) > at(seen)) newest.set(key, job);
  }
  return new Map(jobs.map((job) => {
    const key = jobKey(job);
    return [job.id, jobKind(job) === "spec" && newest.get(key) === job ? key : `${key}@${job.id}`];
  }));
}

/** A row key in `open` as the event stream follows it: without the job id
 *  a row's own key ends with. */
export function streamKey(key: string): string {
  const at = key.indexOf("@");
  return at > 0 ? key.slice(0, at) : key;
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

/** A schedule's configuration and, after it ends, that run's report page. */
export function scheduleJobLinks(row: JobLike): { settings: string; report?: string } | undefined {
  if (jobKind(row) !== "schedule") return undefined;
  const name = scheduleNameOf(row.specFolder);
  return {
    settings: scheduleSettingsPath(row.project, name),
    ...(!inFlight(row) ? { report: scheduleRunPath(row.project, name, row.id) } : {}),
  };
}

/** When a spec's jobs last changed — the newest stamp any of them carries,
 *  made, started or finished — which is what its row is ordered by and the
 *  date the row shows. */
export function jobsChangedAt(jobs: readonly Pick<JobLike, "createdAt" | "startedAt" | "finishedAt">[]): string | undefined {
  const at = jobs.length ? Math.max(...jobs.map(lastStamp)) : 0;
  return at > 0 ? new Date(at).toISOString() : undefined;
}

/** A visit starts with 100 cards; opened rows are explicit exceptions. */
export { windowLimit as jobWindowLimit } from "../list-window";
import { selectWindow } from "../list-window";
export function jobWindow<T extends { key: string }>(rows: T[], requested?: string, opened: ReadonlySet<string> = new Set()): T[] {
  return selectWindow(rows, { limit: requested, opened }).rows;
}
