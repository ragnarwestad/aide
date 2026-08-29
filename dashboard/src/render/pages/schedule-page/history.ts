// The detail page's History tab (spec 276): every past run for this
// entry, newest first. `scheduleOutputDir` is keyed on the tracking key
// alone, so each new run overwrites the previous run's output — only
// the newest row can link to it (Behavior delta, `3-solution.md`).
import type { Job } from "../../../queue/types.ts";
import { durationLabel } from "../../ui/job-state/format.ts";
import { rowMessage } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";

export interface ScheduleHistoryRow {
  job: Job;
  /** Present only on the newest row — see the module comment above. */
  outputHref?: string;
}

function row(r: ScheduleHistoryRow): string {
  const started = r.job.startedAt ?? r.job.createdAt;
  const duration = r.job.finishedAt
    ? durationLabel(Date.parse(r.job.finishedAt) - Date.parse(started))
    : `<span class="muted">–</span>`;
  const output = r.outputHref ? `<a href="${esc(r.outputHref)}">output</a>` : `<span class="muted">–</span>`;
  return (
    `<tr><td>${esc(started)}</td><td>${esc(r.job.state)}</td>` +
    `<td>${duration}</td><td>${output}</td></tr>`
  );
}

export function renderScheduleHistory(rows: readonly ScheduleHistoryRow[]): string {
  if (rows.length === 0) return rowMessage("info", "This entry has not run yet.");
  return (
    `<div class="tablewrap"><table class="list"><thead><tr>` +
    `<th>Started</th><th>State</th><th>Duration</th><th>Output</th>` +
    `</tr></thead><tbody>${rows.map(row).join("")}</tbody></table></div>`
  );
}
