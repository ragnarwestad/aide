// /schedule (spec 272, extended spec 276, reworked spec 278): the list
// of every allowed project's entries at once, an entry's own detail
// page (Overview/History tabs) and the New-job page — composed from
// schedule-page/*. Configuring, monitoring and editing all live here,
// never on a project's own page.

import type { ScheduleEntry } from "../../project/parse-manifest.ts";
import { backLink, rowMessage, tokenField, typedConfirm } from "../ui/components.ts";
import { pageShell, type NavEntry } from "../ui/shell.ts";
import { renderScheduleForm, type ScheduleFormOptions } from "./schedule-page/form.ts";
import { renderScheduleHistory, type ScheduleHistoryRow } from "./schedule-page/history.ts";
import { renderScheduleList, type ScheduleFilter, type SchedulePageRow } from "./schedule-page/list.ts";
import { renderScheduleOverview } from "./schedule-page/overview.ts";
import { deleteSchedulePath, newSchedulePath, schedulePagePath, SCHEDULE_TABS, scheduleTabPath, type ScheduleTab } from "./schedule-page/tabs.ts";
import { pickTab, tabBar, tabbedBody } from "./job-page.ts";

export { SCHEDULE_TABS, deleteSchedulePath, newSchedulePath, schedulePagePath, scheduleTabPath };
export type { SchedulePageRow, ScheduleFilter, ScheduleHistoryRow, ScheduleTab };

export const SCHEDULE_ROUTE = "/schedule";

export interface SchedulePageOptions {
  /** Every allowed project — decides only whether the New-job link is
   *  offered. */
  projects: readonly string[];
  /** Every allowed project's entries, flattened together. */
  rows: readonly SchedulePageRow[];
  filter?: ScheduleFilter;
  token?: string;
  script?: string;
}

export function renderSchedulePage(nav: NavEntry[], generatedAt: string, opts: SchedulePageOptions): string {
  const body = `<main>${renderScheduleList(opts)}</main>`;
  // "Jobs", not "Schedule" — the nav tab beside this page already says
  // "Schedule"; repeating it as a visible page heading read as the same
  // word twice in a row, so the heading is hidden and "Jobs" survives
  // only as the browser tab's title.
  return pageShell("Jobs", nav, SCHEDULE_ROUTE, body, generatedAt, undefined, {
    script: opts.script,
    hideHeading: true,
  });
}

export interface ScheduleDetailPageOptions {
  project: string;
  entry: ScheduleEntry;
  /** The Edit form's own model picker — same two views the New-job form
   *  below is given, and the same ones `new-spec-page.ts` takes. */
  modelChoices?: ScheduleFormOptions["modelChoices"];
  defaultModels?: ScheduleFormOptions["defaultModels"];
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
      : renderScheduleOverview(opts.project, opts.entry, {
          token: opts.token,
          error: opts.error,
          modelChoices: opts.modelChoices,
          defaultModels: opts.defaultModels,
        });
  const body = tabbedBody("", bar, panel, opts.backHref ?? SCHEDULE_ROUTE, opts.entry.name);
  return pageShell(opts.entry.name, nav, base, body, generatedAt, undefined, {
    script: opts.script,
    hideHeading: true,
  });
}

export interface DeleteSchedulePageOptions {
  project: string;
  entryName: string;
  token?: string;
  script?: string;
  error?: string;
}

export function renderDeleteSchedulePage(
  nav: NavEntry[],
  generatedAt: string,
  opts: DeleteSchedulePageOptions,
): string {
  const back = schedulePagePath(opts.project, opts.entryName);
  const title = `Delete ${opts.entryName}`;
  const body =
    backLink(back, title) +
    (opts.error ? rowMessage("failed", opts.error, { tag: "p" }) : "") +
    rowMessage(
      "info",
      `Deleting ${opts.entryName} removes it from ${opts.project}'s schedule for good. ` +
        `Its run history stays in the queue and ages out on its own.`,
      { tag: "p" },
    ) +
    `<form method="post" action="/api/queue${deleteSchedulePath(opts.project, opts.entryName)}" class="scheduledeleteform">` +
    tokenField(opts.token) +
    `<span class="frow">` +
    typedConfirm({ target: opts.entryName, label: "Type the exact name to delete it", button: "Delete", pending: "deleting…" }) +
    `</span></form>`;
  return pageShell(title, nav, back, body, generatedAt, undefined, { script: opts.script, hideHeading: true });
}

export interface NewSchedulePageOptions {
  /** Every allowed project, offered on the form's own Project select.
   *  Empty renders a fallback message instead of the form, the same
   *  way `renderNewSpecPage`'s own `projects.length === 0` branch
   *  does. */
  projects: readonly string[];
  token?: string;
  script?: string;
  error?: string;
  /** The form's own model picker — the same two views `new-spec-page.ts`
   *  takes, from the same helper in `serve.ts`. */
  modelChoices?: ScheduleFormOptions["modelChoices"];
  defaultModels?: ScheduleFormOptions["defaultModels"];
}

export function renderNewSchedulePage(nav: NavEntry[], generatedAt: string, opts: NewSchedulePageOptions): string {
  const body =
    `<main>${backLink(SCHEDULE_ROUTE, "New job")}` +
    (opts.projects.length
      ? renderScheduleForm({
          action: "/api/queue/schedule",
          token: opts.token,
          error: opts.error,
          projects: opts.projects,
          modelChoices: opts.modelChoices,
          defaultModels: opts.defaultModels,
        })
      : `<p class="muted">No project on this machine may have a schedule entry made in it yet. ` +
        `Add one on the Projects page first.</p>`) +
    `</main>`;
  return pageShell("New job", nav, newSchedulePath(), body, generatedAt, undefined, {
    script: opts.script, hideHeading: true,
  });
}
