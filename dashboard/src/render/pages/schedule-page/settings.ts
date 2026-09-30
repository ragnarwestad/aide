// A schedule entry's Settings tab: what the entry is set to, with its
// Enabled switch, Run now and Delete — and, on Edit, the same fields as
// New as inputs on the tab, with Save and Cancel, the way a project's
// Config tab edits its settings. The edit state is the address
// (`?edit=1`), never stored.
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import { scheduleNotifyOf } from "../../../queue/schedule.ts";
import { t, type Language } from "../../../i18n";
import { btnLink, facts, messageSlot } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { deleteControl, enabledBox, runNowForm, SCHEDULE_REFUSED_LINE } from "./controls.ts";
import { NOTIFY_WORDS, renderScheduleForm, type ScheduleFormOptions } from "./form.ts";
import { scheduleSettingsPath } from "./tabs.ts";

export interface ScheduleSettingsOptions {
  project: string;
  entry: ScheduleEntry;
  /** Draws the fields as inputs. */
  editing?: boolean;
  modelChoices?: ScheduleFormOptions["modelChoices"];
  defaultModels?: ScheduleFormOptions["defaultModels"];
  /** Where Delete goes once it has gone through: this page is gone with
   *  the entry. Handed in by the route, which knows the project's page. */
  deleteDone?: string;
  lang: Language;
}

export function renderScheduleSettings(opts: ScheduleSettingsOptions): string {
  const { project, entry, lang } = opts;
  const here = scheduleSettingsPath(project, entry.name);
  if (opts.editing) {
    // The form alone: Enabled, Run now and Delete come back with Save or
    // Cancel, as a Config table being edited shows only its Save and Cancel.
    return renderScheduleForm(
      {
        entryName: entry.name,
        entry,
        action: `/api/queue/schedule/${encodeURIComponent(project)}/${encodeURIComponent(entry.name)}`,
        back: here,
        cancelHref: here,
        modelChoices: opts.modelChoices,
        defaultModels: opts.defaultModels,
      },
      lang,
    );
  }
  // What the entry runs on: its own pick, else what the configuration
  // gives the `schedule` step — the model the form would pre-select.
  const model = entry.model ?? opts.defaultModels?.schedule ?? opts.defaultModels?.default;
  const notify = NOTIFY_WORDS.find(([value]) => value === scheduleNotifyOf(entry))![1];
  const table = facts([
    { label: esc(t(lang, "schedule.colName")), value: esc(entry.name) },
    { label: esc(t(lang, "schedule.cron")), value: `<code>${esc(entry.cron)}</code>` },
    { label: esc(t(lang, "schedule.promptFile")), value: esc(entry.prompt) },
    { label: esc(t(lang, "schedule.model")), value: model ? esc(model) : `<span class="muted">–</span>` },
    { label: esc(t(lang, "schedule.notify")), value: esc(t(lang, notify)) },
    { label: esc(t(lang, "schedule.enabled")), value: enabledBox(project, entry) },
  ]);
  const actions =
    `<div class="row">` +
    btnLink({ href: scheduleSettingsPath(project, entry.name, true), label: t(lang, "schedule.edit"), variant: "primary" }) +
    runNowForm(project, entry.name) +
    deleteControl(project, entry.name, { done: opts.deleteDone }) +
    `</div>`;
  // The refusal line first: Run now writes into the first `.refused` on
  // the page (`schedule-actions.ts`), and Delete's OK names this one.
  return messageSlot("refused", "failed", { id: SCHEDULE_REFUSED_LINE }) + table + actions;
}
