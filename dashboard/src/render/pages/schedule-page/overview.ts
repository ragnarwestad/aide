// The detail page's default tab (spec 276): the cron expression, the
// computed next run, the prompt file path, and an Edit button to the
// entry's own edit page.
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { modelFlag } from "./model-flag.ts";
import type { ScheduleFormOptions } from "./form.ts";
import { scheduleEditPath } from "./edit-page.ts";

export function renderScheduleOverview(
  project: string,
  entry: ScheduleEntry,
  opts: {
    modelChoices?: ScheduleFormOptions["modelChoices"];
    lang?: Language;
    /** The report panel (`report.ts`), drawn first. */
    reportPanel?: string;
  },
): string {
  const lang = opts.lang ?? "en";
  const next = nextFireTime(entry.cron, new Date());
  const offered = opts.modelChoices?.map((c) => c.name);
  return (
    (opts.reportPanel ?? "") +
    modelFlag(lang, entry.model, offered) +
    `<dl class="kv">` +
    `<dt>${t(lang, "schedule.cron")}</dt><dd><code>${esc(entry.cron)}</code></dd>` +
    `<dt>${t(lang, "schedule.nextRun")}</dt><dd>${next ? esc(next.toISOString()) : `<span class="muted">–</span>`}</dd>` +
    `<dt>${t(lang, "schedule.promptFile")}</dt><dd><code>${esc(entry.prompt)}</code></dd>` +
    // Only when the entry NAMES one. An entry left on the configured
    // default has no model of its own to state, and printing whatever
    // the configuration says today would read as a saved pick.
    (entry.model ? `<dt>${t(lang, "schedule.model")}</dt><dd><code>${esc(entry.model)}</code></dd>` : "") +
    `<dt>${t(lang, "schedule.enabled")}</dt><dd>${entry.enabled ? t(lang, "schedule.yes") : t(lang, "schedule.no")}</dd>` +
    `</dl>` +
    `<p><a class="btn" href="${esc(scheduleEditPath(project, entry.name))}">${t(lang, "schedule.edit")}</a></p>`
    // Delete is on the project's Schedule tab, at the right-hand end of
    // the entry's own row.
  );
}
