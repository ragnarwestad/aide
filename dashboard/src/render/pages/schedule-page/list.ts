// The /schedule list body (spec 276): the project selector, the New
// job button scoped to whichever project is selected, and one row per
// entry — monitoring only, per the description: no cron expression, no
// Edit action and no History link here, all three live on the detail
// page instead.
import type { ScheduleEntry } from "../../../project/parse-manifest.ts";
import { nextFireTime } from "../../../queue/schedule.ts";
import { btn, rowMessage, tokenField } from "../../ui/components.ts";
import { esc } from "../../ui/html.ts";
import { newSchedulePath, schedulePagePath } from "./tabs.ts";

export interface SchedulePageRow {
  project: string;
  entry: ScheduleEntry;
  lastState?: string;
  outputHref?: string;
}

export interface ScheduleListOptions {
  /** Every allowed project, for the selector — regardless of whether it
   *  has a schedule entry yet, the same way the New-spec form's own
   *  Project select offers every allowed project. */
  projects: readonly string[];
  selectedProject?: string;
  /** Already scoped to `selectedProject` by the caller. */
  rows: readonly SchedulePageRow[];
  token?: string;
}

function row(r: SchedulePageRow, now: Date, token?: string): string {
  const next = nextFireTime(r.entry.cron, now);
  const state = r.lastState ?? "never run";
  const output = r.outputHref ? ` — <a href="${esc(r.outputHref)}">output</a>` : "";
  const detailHref = schedulePagePath(r.project, r.entry.name);
  const toggleUrl = `/api/queue/schedule/${encodeURIComponent(r.project)}/${encodeURIComponent(r.entry.name)}/enabled`;
  const runUrl = `/api/queue/schedule/${encodeURIComponent(r.project)}/${encodeURIComponent(r.entry.name)}/run`;
  return (
    `<tr>` +
    `<td><a href="${esc(detailHref)}">${esc(r.entry.name)}</a></td>` +
    `<td>${next ? esc(next.toISOString()) : `<span class="muted">–</span>`}</td>` +
    `<td><span data-schedule-state>${esc(state)}</span>${output}</td>` +
    // A standalone checkbox with no surrounding form, the same shape
    // `postTailStep`'s own tail-step chip has and for the same reason:
    // it does nothing without script, and flips the flag immediately —
    // no confirm — the instant it does (`schedule-actions.ts`).
    `<td><input type="checkbox" class="scheduleenabled"${r.entry.enabled ? " checked" : ""} ` +
    `aria-label="Enabled: ${esc(r.entry.name)}" data-post-to="${esc(toggleUrl)}"></td>` +
    `<td><form method="post" action="${esc(runUrl)}" class="actionform schedulerun">${tokenField(token)}` +
    btn({ label: "Run now", pending: "running…", small: true }) +
    `</form></td>` +
    `</tr>`
  );
}

export function renderScheduleList(opts: ScheduleListOptions): string {
  const now = new Date();
  const selector =
    `<form method="get" class="scheduleprojects">` +
    `<label>Project ` +
    `<select name="project" onchange="this.form.submit()">` +
    opts.projects
      .map((p) => `<option value="${esc(p)}"${p === opts.selectedProject ? " selected" : ""}>${esc(p)}</option>`)
      .join("") +
    `</select></label>` +
    `<noscript><button type="submit" class="btn small">Go</button></noscript>` +
    `</form>`;
  const newJobBtn = opts.selectedProject
    ? `<a class="btn primary" href="${esc(newSchedulePath(opts.selectedProject))}">New job</a>`
    : "";
  const table =
    opts.rows.length === 0
      ? rowMessage(
          "info",
          opts.selectedProject ? "This project has no schedule entry yet." : "No project has a schedule entry yet.",
        )
      : `<div class="tablewrap"><table class="list"><thead><tr>` +
        `<th>Name</th><th>Next run</th><th>Last run</th><th>Enabled</th><th></th>` +
        `</tr></thead><tbody>${opts.rows.map((r) => row(r, now, opts.token)).join("")}</tbody></table></div>`;
  return `<div class="schedulehead">${selector}${newJobBtn}</div>${table}`;
}
