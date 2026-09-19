// The detail page's default tab (spec 276): the cron expression, the
// computed next run, the prompt file path, and an inline Edit section
// using the same form the New-job page does.
import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { modelFlag } from "./model-flag.ts";
import { renderScheduleForm, type ScheduleFormOptions } from "./form.ts";

export function renderScheduleOverview(
  project: string,
  entry: ScheduleEntry,
  opts: {
    error?: string;
    modelChoices?: ScheduleFormOptions["modelChoices"];
    defaultModels?: ScheduleFormOptions["defaultModels"];
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
    `<h2>Edit</h2>` +
    renderScheduleForm(
      {
        entryName: entry.name,
        entry,
        action: `/api/queue/schedule/${encodeURIComponent(project)}/${encodeURIComponent(entry.name)}`,
        error: opts.error,
        modelChoices: opts.modelChoices,
        defaultModels: opts.defaultModels,
      },
      lang,
    )
    // Delete is on the LIST since 2026-08-31, at the right-hand end of
    // the entry's own row. It stood here, under the Edit form, which
    // meant opening the entry you had decided to be rid of.
  );
}
