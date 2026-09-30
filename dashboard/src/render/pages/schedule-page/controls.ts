// A schedule entry's controls, as a project's own Schedule tab draws
// them on the entry's row: the Enabled switch, Run now, Edit and Delete. The
// Schedule list only shows and links; changes are made here.
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import { btn, btnLink, buttonForm, dialogAnswers } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { scheduleEditPath } from "./edit-page.ts";

/** The four cells, in order: Enabled, Run now, Edit, Delete. */
export function scheduleControlCells(project: string, entry: ScheduleEntry, lang: Language = "en"): string {
  const base = `/api/queue/schedule/${encodeURIComponent(project)}/${encodeURIComponent(entry.name)}`;
  return (
    // A standalone checkbox with no surrounding form, the same shape
    // `postTailStep`'s own tail-step chip has and for the same reason:
    // it does nothing without script, and flips the flag immediately —
    // no confirm — the instant it does (`schedule-actions.ts`).
    `<td><input type="checkbox" class="scheduleenabled"${entry.enabled ? " checked" : ""} ` +
    `aria-label="Enabled: ${esc(entry.name)}" data-post-to="${esc(`${base}/enabled`)}"></td>` +
    // The page's ordinary button: this is the row's action, and it
    // stands beside Delete.
    `<td>${buttonForm({ action: `${base}/run`, hook: "actionform schedulerun", button: { label: "Run now", pending: "running…" } })}</td>` +
    // A link, not a form: Edit only opens the entry's own edit page.
    `<td>${btnLink({ href: scheduleEditPath(project, entry.name), label: t(lang, "schedule.edit") })}</td>` +
    deleteCell(project, entry.name, `${base}/delete`)
  );
}

// Delete, at the far right of the row it deletes (asked for
// 2026-08-31). It was on the entry's own Edit page, which is the one
// place a reader goes to CHANGE an entry — reaching it meant opening
// the thing you had decided to be rid of.
//
// The control is a plain button, script-only (spec 528: no confirm page
// behind it any more). Its click opens the confirmation beside it:
// `<dialog>`, the platform's own modal, the way the About box in the
// header is done — Escape and Cancel close it, and nothing is deleted
// by a stray click on a table row.
//
// What it asks is the question itself, in the heading, with the two
// answers under it. It asked for the entry's exact name, typed back,
// until 2026-09-08.
function deleteCell(project: string, name: string, deleteUrl: string): string {
  return (
    `<td>` +
    btn({ label: "Delete", type: "button", variant: "danger", data: { "delete-schedule": "" }, ariaLabel: `Delete ${name}` }) +
    `<dialog class="confirmdialog"><div class="confirmpanel">` +
    `<h2>Delete ${esc(project)}:${esc(name)}?</h2>` +
    `<p class="muted">The entry is removed and stops firing. ` +
    `Its own run history stays in the queue.</p>` +
    // The dialog's own heading asks the question: the press is the
    // whole of "yes". This page has no catalogue, so the box keeps to
    // English.
    dialogAnswers(
      "en",
      buttonForm({
        action: deleteUrl,
        hook: "scheduledeleteform",
        button: { label: t("en", "dialog.ok"), variant: "danger", pending: "deleting…" },
      }),
    ) +
    `</div></dialog></td>`
  );
}

