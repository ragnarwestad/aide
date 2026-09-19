// /schedule (spec 272, extended spec 276, reworked spec 278): the list
// of every allowed project's entries at once, and an entry's own detail
// page (Overview/History tabs) — composed from schedule-page/*.
// Monitoring and editing live here; creating a job moved to the
// project's own Schedule tab (spec 468).

import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import type { Language } from "../../../i18n";
import { backLink, btn, rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import type { ScheduleFormOptions } from "./form.ts";
import { renderScheduleHistory, type ScheduleHistoryRow } from "./history.ts";
import { renderScheduleList, type ScheduleFilter, type SchedulePageRow } from "./list.ts";
import { renderScheduleOverview } from "./overview.ts";
import { deleteSchedulePath, schedulePagePath, SCHEDULE_TABS, scheduleTabPath, type ScheduleTab } from "./tabs.ts";
import { pickTab, tabBar, tabbedBody } from "../job-page";

export { renderReportPanel } from "./report.ts";
export { buildReportDocument } from "./report-document.ts";
export { SCHEDULE_TABS, deleteSchedulePath, schedulePagePath, scheduleTabPath };
export type { SchedulePageRow, ScheduleFilter, ScheduleHistoryRow, ScheduleTab };

export const SCHEDULE_ROUTE = "/schedule";

export interface SchedulePageOptions {
  /** Every allowed project's entries, flattened together. */
  rows: readonly SchedulePageRow[];
  filter?: ScheduleFilter;
  script?: string;
  /** Spec 408. Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
  /** A refusal for the slot above the list (spec 494). */
  error?: string;
  /** The model names the queue offers; absent draws no flag. */
  modelNames?: readonly string[];
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
    lang: opts.lang,
    currentUrl: opts.currentUrl,
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
  /** The report panel's markup (`renderReportPanel`), shown on top of Overview. */
  reportPanel?: string;
  script?: string;
  error?: string;
  backHref?: string;
  /** Spec 408. Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
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
          error: opts.error,
          modelChoices: opts.modelChoices,
          defaultModels: opts.defaultModels,
          lang: opts.lang,
          reportPanel: opts.reportPanel,
        });
  const body = tabbedBody("", bar, panel, opts.backHref ?? SCHEDULE_ROUTE, opts.entry.name);
  return pageShell(opts.entry.name, nav, base, body, generatedAt, undefined, {
    script: opts.script,
    hideHeading: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}

export interface DeleteSchedulePageOptions {
  project: string;
  entryName: string;
  script?: string;
  error?: string;
  /** Spec 408. Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
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
    // The question in a sentence and the two answers (2026-09-08); it
    // was a field the reader had to type the name back into, on a page
    // whose own heading is that name. Cancel is a LINK wearing the
    // button's look — it submits nothing, and where it goes is the page
    // the reader came from.
    rowMessage("waiting", `Are you sure you want to delete ${opts.entryName}? This cannot be undone.`, {
      tag: "p",
    }) +
    `<span class="factions">` +
    btn({ label: "Delete", variant: "danger", pending: "deleting…" }) +
    `<a class="btn" href="${esc(back)}">Cancel</a>` +
    `</span></form>`;
  return pageShell(title, nav, back, body, generatedAt, undefined, {
    script: opts.script, hideHeading: true, lang: opts.lang, currentUrl: opts.currentUrl,
  });
}
