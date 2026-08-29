// /schedule (spec 272, extended spec 276): the project-scoped list, an
// entry's own detail page (Overview/History tabs) and the New-job
// page — composed from schedule-page/*. A project selector controls
// what the list shows, and "New job" is scoped to it: configuring,
// monitoring and editing all live here, never on a project's own page.

import type { ScheduleEntry } from "../../project/parse-manifest.ts";
import { backLink } from "../ui/components.ts";
import { esc } from "../ui/html.ts";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import { renderScheduleForm } from "./schedule-page/form.ts";
import { renderScheduleHistory, type ScheduleHistoryRow } from "./schedule-page/history.ts";
import { renderScheduleList, type SchedulePageRow } from "./schedule-page/list.ts";
import { renderScheduleOverview } from "./schedule-page/overview.ts";
import { newSchedulePath, schedulePagePath, SCHEDULE_TABS, scheduleTabPath, type ScheduleTab } from "./schedule-page/tabs.ts";
import { pickTab, tabBar, tabbedBody } from "./job-page.ts";

export { SCHEDULE_TABS, newSchedulePath, schedulePagePath, scheduleTabPath };
export type { SchedulePageRow, ScheduleHistoryRow, ScheduleTab };

export const SCHEDULE_ROUTE = "/schedule";

export interface SchedulePageOptions {
  /** Every allowed project, for the selector. */
  projects: readonly string[];
  selectedProject?: string;
  /** Already scoped to `selectedProject`. */
  rows: readonly SchedulePageRow[];
  token?: string;
  script?: string;
}

export function renderSchedulePage(nav: NavEntry[], generatedAt: string, opts: SchedulePageOptions): string {
  const body = `<main>${renderScheduleList(opts)}</main>`;
  return pageShell("Schedule", nav, SCHEDULE_ROUTE, body, generatedAt, undefined, { script: opts.script });
}

export interface ScheduleDetailPageOptions {
  project: string;
  entry: ScheduleEntry;
  tab?: string;
  history: readonly ScheduleHistoryRow[];
  token?: string;
  script?: string;
  error?: string;
  backHref?: string;
}

export function renderScheduleDetailPage(
  nav: NavEntry[],
  generatedAt: string,
  opts: ScheduleDetailPageOptions,
): string {
  const tab = pickTab(SCHEDULE_TABS, opts.tab, "overview");
  const base = schedulePagePath(opts.project, opts.entry.name);
  const bar = tabBar(SCHEDULE_TABS, base, tab, {});
  const panel =
    tab === "history"
      ? renderScheduleHistory(opts.history)
      : renderScheduleOverview(opts.project, opts.entry, { token: opts.token, error: opts.error });
  const banner = `<h1>${esc(opts.entry.name)}</h1>`;
  const body = tabbedBody(banner, bar, panel, opts.backHref ?? SCHEDULE_ROUTE);
  return pageShell(opts.entry.name, nav, base, body, generatedAt, undefined, { script: opts.script });
}

export interface NewSchedulePageOptions {
  project: string;
  token?: string;
  script?: string;
  error?: string;
}

export function renderNewSchedulePage(nav: NavEntry[], generatedAt: string, opts: NewSchedulePageOptions): string {
  const body =
    `<main>${backLink(SCHEDULE_ROUTE)}<h1>New job — ${esc(opts.project)}</h1>` +
    renderScheduleForm({
      action: `/api/queue/schedule/${encodeURIComponent(opts.project)}`,
      token: opts.token,
      error: opts.error,
    }) +
    `</main>`;
  return pageShell("New job", nav, newSchedulePath(opts.project), body, generatedAt, undefined, { script: opts.script });
}
