// The page that makes a schedule entry: the form an entry's Settings tab
// draws on Edit, under "← Back", starting on sensible defaults. A save
// that works goes back to where the reader came from; a refused one stays
// here with the reason and every field as it was typed.
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import { t, type Language } from "../../../i18n";
import { backLink } from "../../ui/components";
import { pageShell, type NavEntry } from "../../ui/shell.ts";
import { PROJECTS_ROUTE } from "../projects-page";
import { renderScheduleForm, type ScheduleFormOptions } from "./form.ts";

/** Where New goes: the project rides as a query, since the page's path
 *  would otherwise read as an entry named "new". */
export function scheduleNewPath(project: string): string {
  return `/schedule/new?project=${encodeURIComponent(project)}`;
}

/** What a new entry starts on: every morning at seven, so the Cron
 *  field shows a next run from the start. */
export const NEW_SCHEDULE_DEFAULTS = { name: "", cron: "0 7 * * *", prompt: "" } as const;

export interface ScheduleNewPageOptions {
  project: string;
  /** What the fields hold: the defaults. */
  values: Pick<ScheduleEntry, "name" | "cron" | "prompt" | "model" | "notify">;
  backHref: string;
  modelChoices?: ScheduleFormOptions["modelChoices"];
  defaultModels?: ScheduleFormOptions["defaultModels"];
  script?: string;
  lang?: Language;
  currentUrl?: string;
}

export function renderScheduleNewPage(nav: NavEntry[], generatedAt: string, opts: ScheduleNewPageOptions): string {
  const lang = opts.lang ?? "en";
  const title = t(lang, "schedule.newJob");
  const body =
    backLink(opts.backHref, title) +
    renderScheduleForm(
      {
        fixedProject: opts.project,
        entry: opts.values,
        action: "/api/queue/schedule",
        back: opts.backHref,
        modelChoices: opts.modelChoices,
        defaultModels: opts.defaultModels,
      },
      lang,
    );
  // No reload of its own: this page is a form, and a reload wipes what is typed.
  return pageShell(title, nav, PROJECTS_ROUTE, body, generatedAt, {
    script: opts.script,
    hideHeading: true,
    hideTabBar: true,
    lang: opts.lang,
    currentUrl: opts.currentUrl,
  });
}
