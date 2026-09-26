// One page for both making a schedule entry and changing one: the same
// form, under "← Back". Create starts on sensible defaults; Edit starts
// on the entry as it is saved. A save that works goes back to where the
// reader came from; a refused one stays here with the reason and every
// field as it was typed.
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import { t, type Language } from "../../../i18n";
import { backLink } from "../../ui/components";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { PROJECTS_ROUTE } from "../projects-page/routes.ts";
import { renderScheduleForm, type ScheduleFormOptions } from "./form.ts";
import { schedulePagePath } from "./tabs.ts";

/** Where New goes: the project rides as a query, since the page's path
 *  would otherwise read as an entry named "new". */
export function scheduleNewPath(project: string): string {
  return `/schedule/new?project=${encodeURIComponent(project)}`;
}

/** Where an entry's Edit goes. */
export function scheduleEditPath(project: string, name: string): string {
  return `${schedulePagePath(project, name)}/edit`;
}

/** What a new entry starts on: every morning at seven, so the Cron
 *  field shows a next run from the start. */
export const NEW_SCHEDULE_DEFAULTS = { name: "", cron: "0 7 * * *", prompt: "" } as const;

export interface ScheduleEditPageOptions {
  project: string;
  /** The entry being changed, under the name it is saved as. Absent
   *  when making a new one. */
  editing?: string;
  /** What the fields hold: the saved entry, the defaults, or what a
   *  refused save sent. */
  values: Pick<ScheduleEntry, "name" | "cron" | "prompt" | "model" | "notify">;
  backHref: string;
  error?: string;
  modelChoices?: ScheduleFormOptions["modelChoices"];
  defaultModels?: ScheduleFormOptions["defaultModels"];
  script?: string;
  lang?: Language;
  currentUrl?: string;
}

export function renderScheduleEditPage(nav: NavEntry[], generatedAt: string, opts: ScheduleEditPageOptions): string {
  const lang = opts.lang ?? "en";
  const title = opts.editing ? t(lang, "schedule.editTitle", { name: opts.editing }) : t(lang, "schedule.newJob");
  const action = opts.editing
    ? `/api/queue/schedule/${encodeURIComponent(opts.project)}/${encodeURIComponent(opts.editing)}`
    : "/api/queue/schedule";
  const body =
    backLink(opts.backHref, title) +
    renderScheduleForm(
      {
        ...(opts.editing ? { entryName: opts.editing } : { fixedProject: opts.project }),
        entry: opts.values,
        action,
        back: opts.backHref,
        error: opts.error,
        modelChoices: opts.modelChoices,
        defaultModels: opts.defaultModels,
      },
      lang,
    );
  // No meta refresh: this page is a form, and a refresh wipes what is typed.
  return pageShell(title, nav, PROJECTS_ROUTE, body, generatedAt, undefined, {
    script: opts.script,
    hideHeading: true,
    hideTabBar: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}
