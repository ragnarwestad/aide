// The detail page's default tab (spec 276): the cron expression, the
// computed next run, the prompt file path, and an inline Edit section
// using the same form the New-job page does.
import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { esc } from "../../ui/html.ts";
import { renderScheduleForm, type ScheduleFormOptions } from "./form.ts";
import { deleteSchedulePath } from "./tabs.ts";

export function renderScheduleOverview(
  project: string,
  entry: ScheduleEntry,
  opts: {
    token?: string;
    error?: string;
    modelChoices?: ScheduleFormOptions["modelChoices"];
    defaultModels?: ScheduleFormOptions["defaultModels"];
  },
): string {
  const next = nextFireTime(entry.cron, new Date());
  return (
    `<dl class="kv">` +
    `<dt>Cron</dt><dd><code>${esc(entry.cron)}</code></dd>` +
    `<dt>Next run</dt><dd>${next ? esc(next.toISOString()) : `<span class="muted">–</span>`}</dd>` +
    `<dt>Prompt file</dt><dd><code>${esc(entry.prompt)}</code></dd>` +
    // Only when the entry NAMES one. An entry left on the configured
    // default has no model of its own to state, and printing whatever
    // the configuration says today would read as a saved pick.
    (entry.model ? `<dt>Model</dt><dd><code>${esc(entry.model)}</code></dd>` : "") +
    `<dt>Enabled</dt><dd>${entry.enabled ? "yes" : "no"}</dd>` +
    `</dl>` +
    `<h2>Edit</h2>` +
    renderScheduleForm({
      entryName: entry.name,
      entry,
      action: `/api/queue/schedule/${encodeURIComponent(project)}/${encodeURIComponent(entry.name)}`,
      token: opts.token,
      error: opts.error,
      modelChoices: opts.modelChoices,
      defaultModels: opts.defaultModels,
    }) +
    `<p><a class="btn small" href="${esc(deleteSchedulePath(project, entry.name))}">Delete</a></p>`
  );
}
