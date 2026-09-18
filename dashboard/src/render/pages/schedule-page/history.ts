// The detail page's History tab (spec 276): every past run for this
// entry, newest first. Each run writes into a directory of its own, so
// every row links to its own run's report on the entry's page.
import type { Job } from "../../../queue/types.ts";
import { durationLabel } from "../../ui/job-state";
import { rowMessage } from "../../ui/components";
import { esc } from "../../ui/html.ts";

export interface ScheduleHistoryRow {
  job: Job;
  /** The entry's page showing this run's report (`?run=<id>#report`). */
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
