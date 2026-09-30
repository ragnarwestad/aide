// A schedule entry's controls: the Enabled switch, Run now and Delete.
// A project's own Schedule tab draws them on the entry's row, and the
// entry's Settings tab draws the same three. The Schedule list only
// shows and links.
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import { askButton, buttonForm, confirmDialog } from "../../ui/components";
import { esc } from "../../ui/html.ts";

/** The Schedule tab's refusal line, which Delete's OK names: the dialog
 *  it is posted from is closed before the refusal is written. */
export const SCHEDULE_REFUSED_LINE = "schedule-refused";

const entryApi = (project: string, name: string): string =>
  `/api/queue/schedule/${encodeURIComponent(project)}/${encodeURIComponent(name)}`;

/** The three cells, in order: Enabled, Run now, Delete. */
export function scheduleControlCells(project: string, entry: ScheduleEntry): string {
  return (
    `<td>${enabledBox(project, entry)}</td>` +
    `<td>${runNowForm(project, entry.name)}</td>` +
    `<td>${deleteControl(project, entry.name)}</td>`
  );
}

// A standalone checkbox with no surrounding form, the same shape
// `postTailStep`'s own tail-step chip has and for the same reason: it
// does nothing without script, and flips the flag immediately — no
// confirm — the instant it does (`schedule-actions.ts`).
export function enabledBox(project: string, entry: ScheduleEntry): string {
  return (
    `<input type="checkbox" class="scheduleenabled"${entry.enabled ? " checked" : ""} ` +
    `aria-label="Enabled: ${esc(entry.name)}" data-post-to="${esc(`${entryApi(project, entry.name)}/enabled`)}">`
  );
}

/** The page's ordinary button: this is the entry's action, and it
 *  stands beside Delete. */
export function runNowForm(project: string, name: string): string {
  return buttonForm({
    action: `${entryApi(project, name)}/run`,
    hook: "actionform schedulerun",
    button: { label: "Run now", pending: "running…" },
  });
}

// Delete, at the far right of the row it deletes (asked for
// 2026-08-31). It was on the entry's own Edit page, which is the one
// place a reader goes to CHANGE an entry — reaching it meant opening
// the thing you had decided to be rid of.
//
// The control is a plain button, script-only (spec 528: no confirm page
// behind it any more). Its click opens the board's one confirmation
// dialog beside it — Escape and Cancel close it, and nothing is deleted
// by a stray click on a table row. The page script posts its OK and
// loads the page again, or goes to `o.done` when the page it is on is
// the entry's own, which is gone once the entry is.
//
// What it asks is the question itself, in the heading, with the two
// answers under it. It asked for the entry's exact name, typed back,
// until 2026-09-08.
export function deleteControl(project: string, name: string, o: { done?: string } = {}): string {
  const id = `deleteask-${project}/${name}`;
  return (
    askButton({ label: "Delete", dialogId: id, variant: "danger", ariaLabel: `Delete ${name}` }) +
    // The dialog's own heading asks the question: the press is the
    // whole of "yes". This page has no catalogue, so the box keeps to
    // English.
    confirmDialog("en", {
      id,
      title: `Delete ${project}:${name}?`,
      sentence: "The entry is removed and stops firing. Its own run history stays in the queue.",
      ok: { variant: "danger", pending: "deleting…" },
      post: {
        action: `${entryApi(project, name)}/delete`,
        hook: "reloadform",
        data: { line: SCHEDULE_REFUSED_LINE, ...(o.done ? { done: o.done } : {}) },
      },
    })
  );
}
