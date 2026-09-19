// Cron due-ness for a project's own recurring jobs (spec 259). No
// backfill by design: "due" is computed from the most recent fire time
// alone, never a backlog of missed ones — a dashboard down across a
// whole scheduled window simply skips that occurrence, the same
// behaviour `driftPollMs`/`specCachePollMs` already have when a restart
// leaves an answer stale until the next tick.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize as normalizePath } from "node:path";
import { CronExpressionParser } from "cron-parser";

/** The same character class `queue.ts`'s `NAME_RE` checks a job's own
 *  names against — a schedule entry's name becomes half of a job's
 *  `schedule-<name>` tracking key, which has to survive as a git branch
 *  name and a directory-shaped string wherever the queue writes it. */
export const SCHEDULE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** One recurring job: a cron expression and the prompt file its run
 *  sends verbatim, relative to the project root. Stored in the serving
 *  host's `queue-config.json` under `schedules.<project>`. */
export interface ScheduleEntry {
  name: string;
  cron: string;
  prompt: string;
  /** Absent or anything but the literal boolean `false` means enabled —
   *  an existing entry with no such field keeps firing exactly as it
   *  always has. */
  enabled: boolean;
  /** Which model every fire of this entry runs on — a NAME out of the
   *  queue config's own `modelChoices` table, exactly like the name a
   *  spec's phase line posts. Absent means the entry never picked one
   *  and the configuration's own `schedule` default decides, which is
   *  what every entry written before this field did. */
  model?: string;
  /** When the entry was created or last edited from the dashboard's own
   *  Schedule forms (spec 461) — an ISO timestamp `isDue` treats as
   *  already-used ground, the same way it treats a tracked job's own
   *  `startedAt ?? createdAt`. Absent means an entry written by hand,
   *  which keeps firing on its very first eligible window exactly as
   *  every entry did before this field existed. */
  since?: string;
}

/** Whether `path`, read relative to the project root, could resolve
 *  outside it — an absolute path, or one whose `..` segments climb past
 *  the root. Purely a shape check on the string: it never touches the
 *  filesystem, so it works the same for a `prompt:` value that is never
 *  going to exist as for one that does (the entry is dropped when the
 *  store reads it, before anything else looks at it). */
export function escapesRoot(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)) return true;
  const normalized = normalizePath(path).replace(/\\/g, "/");
  return normalized === ".." || normalized.startsWith("../");
}

/** The job-store tracking key a schedule entry's runs are filed under —
 *  never a spec folder, and never resolved under the specs root
 *  (`parseJobRequest`'s own exemption for it). Obviously not a spec
 *  folder, on purpose, the same way `create`'s provisional key is. */
export const scheduleTrackingKey = (name: string): string => `schedule-${name}`;

/** The most recent time `cron` was due at or before `now`, or `null` for
 *  a `cron` string that does not parse — which, since the store
 *  already rejects one when it reads, only happens for a value dueness
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
