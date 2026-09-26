// A schedule entry's most recent run, as both pages that list entries
// show it: the Schedule list and a project's own Schedule tab.
import { DEFAULT_SCHEDULE_OUTPUT_ROOT, readScheduleRunReport, scheduleTrackingKey } from "../../../queue/schedule.ts";
import { schedulePagePath } from "../../../render";
import type { RoutesContext } from "..";

export interface ScheduleLastRun {
  lastState?: string;
  lastRunAt?: string;
  /** The report, on the entry's own page, when the run wrote one. */
  outputHref?: string;
}

export function scheduleLastRun(ctx: RoutesContext, project: string, entryName: string): ScheduleLastRun {
  const outputRoot = ctx.opts.scheduleOutputRoot ?? DEFAULT_SCHEDULE_OUTPUT_ROOT;
  const key = scheduleTrackingKey(entryName);
  const jobs = ctx.queue.list().filter((j) => j.project === project && j.specFolder === key);
  const last = jobs.sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt))[0];
  const wroteReport = last ? readScheduleRunReport(outputRoot, project, key, last.id) !== null : false;
  return {
    lastState: last?.state,
    lastRunAt: last?.startedAt ?? last?.createdAt,
    outputHref: wroteReport ? `${schedulePagePath(project, entryName)}#report` : undefined,
  };
}
