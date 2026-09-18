// Cron due-ness for a project's own recurring jobs (spec 259). No
// backfill by design: "due" is computed from the most recent fire time
// alone, never a backlog of missed ones — a dashboard down across a
// whole scheduled window simply skips that occurrence, the same
// behaviour `driftPollMs`/`specCachePollMs` already have when a restart
// leaves an answer stale until the next tick.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CronExpressionParser } from "cron-parser";
import type { ScheduleEntry } from "../project/parse-manifest.ts";

/** The job-store tracking key a schedule entry's runs are filed under —
 *  never a spec folder, and never resolved under the specs root
 *  (`parseJobRequest`'s own exemption for it). Obviously not a spec
 *  folder, on purpose, the same way `create`'s provisional key is. */
export const scheduleTrackingKey = (name: string): string => `schedule-${name}`;

/** The most recent time `cron` was due at or before `now`, or `null` for
 *  a `cron` string that does not parse — which, since `parseManifest`
 *  already rejects one at the source, only happens for a value dueness
 *  is asked to check some other way (a test, a future caller). */
export function mostRecentFireTime(cron: string, now: Date): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: now }).prev().toDate();
  } catch {
    return null;
  }
}

/** The next time `cron` will be due after `now`, or `null` on the same
 *  terms as `mostRecentFireTime`. What a Schedule section shows as an
 *  entry's next run. */
export function nextFireTime(cron: string, now: Date): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: now }).next().toDate();
  } catch {
    return null;
  }
}

/** The one fact `isDue` needs out of a job — never the whole `Job`, so a
 *  caller can hand it the queue's own jobs without this module knowing
 *  their shape. */
export interface ScheduleJobRef {
  specFolder: string;
  createdAt: string;
  startedAt?: string;
}

/** Whether `entry` should fire a new job right now, given every job the
 *  queue has ever tracked under its key.
 *
 *  Due when the cron's most recent fire time is AFTER the newest such
 *  job's `startedAt ?? createdAt` — the same recency fallback `queue.ts`
 *  already uses elsewhere, needed because `startedAt` is unset for a job
 *  that is merely queued. A job in ANY state counts, done or not: the
 *  question is only "has this window already been attempted", and a
 *  failed attempt still attempted it — there is no catch-up run for a
 *  window already spent. That single comparison is also what keeps a
 *  duplicate from being enqueued while one is still queued or running:
 *  such a job's own `startedAt ?? createdAt` already sits after the
 *  fire time that started it.
 *
 *  `entry.since` (spec 461) is folded in as the floor's starting value
 *  rather than `-Infinity`: a brand-new entry has no tracked job yet,
 *  so without it a cron whose most recent fire already lies in the past
 *  reads as due the instant the entry is saved. An entry with no
 *  `since` — every hand-written one — computes exactly as before. */
export function isDue(entry: ScheduleEntry, now: Date, jobs: readonly ScheduleJobRef[]): boolean {
  if (!entry.enabled) return false;
  const fire = mostRecentFireTime(entry.cron, now);
  if (!fire) return false;
  const key = scheduleTrackingKey(entry.name);
  const since = Date.parse(entry.since ?? "") || -Infinity;
  const newest = jobs
    .filter((j) => j.specFolder === key)
    .reduce((latest, j) => Math.max(latest, Date.parse(j.startedAt ?? j.createdAt) || 0), since);
  return fire.getTime() > newest;
}

/** Where a schedule step's own output lives, outside any worktree so it
 *  survives past the run — keyed on the same (project, tracking key)
 *  identity `scheduleTrackingKey` already uses, so the URL a reader
 *  bookmarks never moves between runs (spec 272). */
export const DEFAULT_SCHEDULE_OUTPUT_ROOT = join(homedir(), ".aide", "dashboard", "schedule-output");

/** The one function both the write side (`runner-setup.ts`'s spawn) and
 *  the read side (the serving route, the Schedule page) import — never a
 *  second implementation of the join, the exact hand-paired-pair failure
 *  mode `dashboard/CLAUDE.md` already names six instances of. */
export function scheduleOutputDir(root: string, project: string, specFolder: string): string {
  return join(root, project, specFolder);
}

/** Where ONE run writes its output: a directory of its own under the
 *  entry's, named by the job id. An earlier run's report survives the
 *  next run, and a directory that starts empty means "no `index.html`"
 *  is "this run wrote none". */
export function scheduleRunOutputDir(root: string, project: string, specFolder: string, jobId: string): string {
  return join(scheduleOutputDir(root, project, specFolder), "runs", jobId);
}

/** Whether a report has anything to read: some text, or an image, once
 *  its tags are removed. An empty file, whitespace and a document of
 *  empty tags all say nothing. */
function hasContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim() !== "";
}

/** The one function that says a run "wrote a report": the run's own
 *  `index.html`, or `null` when it is missing or blank. */
export function readScheduleRunReport(root: string, project: string, specFolder: string, jobId: string): string | null {
  const file = join(scheduleRunOutputDir(root, project, specFolder, jobId), "index.html");
  if (!existsSync(file)) return null;
  try {
    const html = readFileSync(file, "utf-8");
    return hasContent(html) ? html : null;
  } catch {
    return null;
  }
}
