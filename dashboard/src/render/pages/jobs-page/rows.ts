// The Jobs tab's rules, as pure functions: which jobs it shows, what a row
// is called, where the job belongs and what the row offers to stop it. They
// read only the fields a job and its row view share, so the route can run
// them on the raw jobs and the tests on plain objects.

import { stepLabel } from "../../../format/step-label.ts";
import { t, type Language } from "../../../i18n";
import { createEndedWithoutSpec, isProvisionalKey } from "../../../queue/create-failure.ts";
import { scheduleNameOf } from "../../../queue/schedule.ts";
import { isWikiBuild, waitsForPerson } from "../../../queue/steps.ts";
import { currentStep, inFlight } from "../../ui/job-state/format.ts";
import { landingStep } from "../../ui/job-state/resting.ts";
import type { QueueRowView } from "../../ui/job-state/types.ts";
import { projectPagePath, projectScheduleTab } from "../projects-page/routes.ts";
import { specPagePath } from "../spec-page/tabs.ts";

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
type TitleRow = StateRow & Pick<QueueRowView, "project" | "specFolder" | "createTitle" | "wikiRefresh">;

export const isScheduleJob = (job: { steps: readonly string[]; specFolder: string }): boolean =>
  job.steps.length === 1 && job.steps[0] === "schedule" && job.specFolder.startsWith("schedule-");

const at = (job: JobLike): number => Date.parse(job.createdAt) || 0;
const sameJob = (job: JobLike): string => `${job.project}\0${job.specFolder}`;

/** 0 running or landing, 1 queued, 2 waiting for the user. */
const group = (job: JobLike): number => (job.state === "running" || job.landing ? 0 : job.state === "queued" ? 1 : 2);

/** The jobs the tab shows, in the order it shows them: in flight, or waiting
 *  for a person and not yet dealt with. A waiting job is dealt with when a
 *  job of the same project and tracking key was created after it and was not
 *  cancelled; a scheduled job when its entry is deleted. A create that ended
 *  without a spec is never a row: the Specs list's message for it stands, from
 *  a record kept until Dismiss is pressed. */
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
  const shown = jobs.filter((job) => {
    if (inFlight(job)) return true;
    if (createEndedWithoutSpec(job)) return false;
    if (!waitsForPerson(job)) return false;
    if ((newest.get(sameJob(job)) ?? 0) > at(job)) return false;
    return !isScheduleJob(job) || o.scheduleEntryExists(job.project, scheduleNameOf(job.specFolder));
  });
  return shown.sort((a, b) => group(a) - group(b) || at(b) - at(a));
}

/** What a row is called: the spec's name and step, the wiki run, or the
 *  scheduled job. The wiki run and the scheduled job are named without their
 *  project, which their row draws before the name. `titleOf` is the spec's
 *  own title. */
export function jobTitle(
  row: TitleRow,
  lang: Language,
  titleOf: (project: string, specFolder: string) => string | undefined,
): string {
  if (isWikiBuild(row)) return t(lang, row.wikiRefresh ? "jobs.wikiRefresh" : "jobs.wikiBuild");
  if (isScheduleJob(row)) return scheduleNameOf(row.specFolder);
  if (isProvisionalKey(row.specFolder)) return `${row.createTitle ?? row.specFolder} — ${stepLabel("create", lang)}`;
  // As the Specs list's head row builds a spec's name: the folder's number,
  // then the title; with no title, the folder.
  const title = titleOf(row.project, row.specFolder);
  const number = row.specFolder.split("-")[0];
  const name = title ? (number ? `${number}-${title}` : title) : row.specFolder;
  const step = row.landing ? landingStep(row) : currentStep(row);
  return `${row.project}: ${name} — ${stepLabel(step, lang)}`;
}

/** The place the job belongs. */
export function jobHome(row: Pick<JobLike, "project" | "specFolder" | "steps">): string {
  if (isWikiBuild(row)) return `${projectPagePath(row.project)}?tab=wiki&wikitab=build`;
  if (isScheduleJob(row)) return projectScheduleTab(row.project);
  // A create has no spec page yet, or never got one.
  if (isProvisionalKey(row.specFolder)) return "/specs";
  return specPagePath(row.project, row.specFolder);
}

/** What a row offers to end its job: Cancel for a queued one, Stop for a
 *  running or landing one, nothing for a finished one. Nothing while `create`
 *  is the step, as on the Specs list: cancelling a create throws its title and
 *  description away. Never a Run. */
export function jobControl(row: StateRow): "cancel" | "stop" | undefined {
  if (!inFlight(row) || currentStep(row) === "create") return undefined;
  return row.state === "queued" && !row.landing ? "cancel" : "stop";
}
