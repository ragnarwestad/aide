// /schedule (spec 272): the single aggregate page listing every allowed
// project's `schedule:` entries — never one tab per project, the same
// shape `/projects` already took after the 2026-08-22 tab-per-project
// removal (`site/routes.ts`'s own comment). Read-only, like
// `scheduleSection()` on a project's own page; this is the cross-project
// view that one lacks.

import type { ScheduleEntry } from "../../project/parse-manifest.ts";
import { nextFireTime } from "../../queue/schedule.ts";
import { rowMessage } from "../ui/components.ts";
import { esc } from "../ui/html.ts";
import { pageShell, type NavEntry } from "../ui/shell.ts";

export const SCHEDULE_ROUTE = "/schedule";

export interface SchedulePageRow {
  project: string;
  entry: ScheduleEntry;
  lastState?: string;
  outputHref?: string;
}

export interface SchedulePageOptions {
  rows: readonly SchedulePageRow[];
}

function row(r: SchedulePageRow, now: Date): string {
  const next = nextFireTime(r.entry.cron, now);
  const state = r.lastState ?? "never run";
  const output = r.outputHref
    ? `<a href="${esc(r.outputHref)}">output</a>`
    : `<span class="muted">no output yet</span>`;
  return (
    `<tr><td>${esc(r.project)}</td><td>${esc(r.entry.name)}</td>` +
    `<td><code>${esc(r.entry.cron)}</code></td>` +
    `<td>${next ? esc(next.toISOString()) : `<span class="muted">–</span>`}</td>` +
    `<td>${esc(state)}</td><td>${output}</td></tr>`
  );
}

export function renderSchedulePage(nav: NavEntry[], generatedAt: string, opts: SchedulePageOptions): string {
  const now = new Date();
  const body =
    opts.rows.length === 0
      ? rowMessage("info", "No project has a schedule entry yet.")
      : `<div class="tablewrap"><table class="list"><thead><tr>` +
        `<th>Project</th><th>Name</th><th>Cron</th><th>Next run</th><th>Last state</th><th>Output</th>` +
        `</tr></thead><tbody>${opts.rows.map((r) => row(r, now)).join("")}</tbody></table></div>`;
  return pageShell("Schedule", nav, SCHEDULE_ROUTE, body, generatedAt);
}
