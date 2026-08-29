// The detail page's default tab (spec 276): the cron expression, the
// computed next run, the prompt file path, and an inline Edit section
// using the same form the New-job page does.
import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { esc } from "../../ui/html.ts";
import { renderScheduleForm } from "./form.ts";
import { deleteSchedulePath } from "./tabs.ts";

export function renderScheduleOverview(
  project: string,
  entry: ScheduleEntry,
  opts: { token?: string; error?: string },
): string {
  const next = nextFireTime(entry.cron, new Date());
  return (
    `<dl class="kv">` +
    `<dt>Cron</dt><dd><code>${esc(entry.cron)}</code></dd>` +
    `<dt>Next run</dt><dd>${next ? esc(next.toISOString()) : `<span class="muted">–</span>`}</dd>` +
    `<dt>Prompt file</dt><dd><code>${esc(entry.prompt)}</code></dd>` +
    `<dt>Enabled</dt><dd>${entry.enabled ? "yes" : "no"}</dd>` +
    `</dl>` +
    `<h2>Edit</h2>` +
    renderScheduleForm({
      entryName: entry.name,
      entry,
      action: `/api/queue/schedule/${encodeURIComponent(project)}/${encodeURIComponent(entry.name)}`,
      token: opts.token,
      error: opts.error,
    }) +
    `<p><a class="btn small" href="${esc(deleteSchedulePath(project, entry.name))}">Delete</a></p>`
  );
}
