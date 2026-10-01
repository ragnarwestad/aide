// /schedule (spec 272, extended spec 276, reworked spec 278): the list
// of every allowed project's entries at once, and an entry's own detail
// page (Report and Settings tabs) — composed from
// schedule-page/*. An entry is changed on its Settings tab; making one
// is a page of its own (`new-page.ts`), reached from the project's own
// Schedule tab.

import type { ScheduleEntry } from "../../../queue/schedule.ts";
import type { Job } from "../../../queue/types.ts";
import type { Language } from "../../../i18n";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { renderScheduleRuns } from "./runs.ts";
import { renderScheduleList, type ScheduleFilter, type SchedulePageRow } from "./list.ts";
import { renderScheduleSettings, type ScheduleSettingsOptions } from "./settings.ts";
import {
  schedulePagePath, scheduleRunPath, scheduleSettingsPath, SCHEDULE_TABS, scheduleTabPath, type ScheduleTab,
} from "./tabs.ts";
import { pickTab, tabBar, tabbedBody } from "../job-page";

export { renderReportPanel } from "./report.ts";
export { buildReportDocument } from "./report-document.ts";
export { renderProposalsPanel } from "./proposals.ts";
export { NEW_SCHEDULE_DEFAULTS, renderScheduleNewPage, scheduleNewPath } from "./new-page.ts";
export type { ScheduleNewPageOptions } from "./new-page.ts";
export { SCHEDULE_TABS, schedulePagePath, scheduleRunPath, scheduleSettingsPath, scheduleTabPath };
export type { SchedulePageRow, ScheduleFilter, ScheduleTab };

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
  /** The model names the queue offers; absent draws no flag. */
  modelNames?: readonly string[];
}

export function renderSchedulePage(nav: NavEntry[], generatedAt: string, opts: SchedulePageOptions): string {
  // `pageShell` wraps the body in `<main>`: a second one inside it takes
  // the frame's padding twice.
  const body = renderScheduleList(opts);
  // "Jobs", not "Schedule" — the nav tab beside this page already says
  // "Schedule"; repeating it as a visible page heading read as the same
  // word twice in a row, so the heading is hidden and "Jobs" survives
  // only as the browser tab's title.
  return pageShell("Jobs", nav, SCHEDULE_ROUTE, body, generatedAt, {
    script: opts.script,
    hideHeading: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}

export interface ScheduleDetailPageOptions {
  project: string;
  entry: ScheduleEntry;
  tab?: string;
  /** The entry's runs, newest first, listed under the report. */
  runs: readonly Job[];
  /** The `?run=` the address named, when it is one of `runs`: the run
   *  whose report `reportPanel` shows. */
  shownRun?: string;
  /** The runs list's `?sort=` and `?dir=`, as the address gave them. */
  runSort?: { sort?: string; dir?: string };
  /** The report panel's markup (`renderReportPanel`), the Report tab. */
  reportPanel?: string;
  script?: string;
  backHref?: string;
  /** Spec 408. Absent means English — the same default `pageShell`'s
   *  own `opts.lang` falls back to. */
  lang?: Language;
  /** Spec 435. The request's own address, threaded to `pageShell` so its
   *  language links keep the reader on this same page. */
  currentUrl?: string;
  /** The Settings tab's fields drawn as inputs (`?edit=1`). */
  editing?: boolean;
  modelChoices?: ScheduleSettingsOptions["modelChoices"];
  defaultModels?: ScheduleSettingsOptions["defaultModels"];
  /** Where Settings' Delete goes once it has gone through. */
  deleteDone?: string;
}

export function renderScheduleDetailPage(
  nav: NavEntry[],
  generatedAt: string,
  opts: ScheduleDetailPageOptions,
): string {
  const tab = pickTab(SCHEDULE_TABS, opts.tab, "report");
  const base = schedulePagePath(opts.project, opts.entry.name);
  const bar = tabBar(SCHEDULE_TABS, base, tab, {});
  // The entry's runs — a run's report, and every run below it — and what
  // the entry IS, on Settings, where it is also changed.
  const panel =
    tab === "settings"
      ? renderScheduleSettings({
          project: opts.project, entry: opts.entry, editing: opts.editing, modelChoices: opts.modelChoices,
          defaultModels: opts.defaultModels, deleteDone: opts.deleteDone, lang: opts.lang ?? "en",
        })
      : (opts.reportPanel ?? "") +
        renderScheduleRuns({
          lang: opts.lang ?? "en", project: opts.project, name: opts.entry.name, runs: opts.runs,
          shown: opts.shownRun, sort: opts.runSort?.sort, dir: opts.runSort?.dir,
        });
  const body = tabbedBody("", bar, panel, opts.backHref ?? SCHEDULE_ROUTE, opts.entry.name);
  return pageShell(opts.entry.name, nav, base, body, generatedAt, {
    script: opts.script,
    hideHeading: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}
