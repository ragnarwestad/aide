// The boxes for ONE acceptance row, drawn once for the Status tab and the
// Specs list's unfolded criteria. A row has two, side by side at the right of
// its text: the tick box (Yes) and a second box (Not yet: a check that has to
// wait for something after the deploy). The words are not beside the boxes but
// in one heading over the list (`checkColumns`), so each box carries them as
// its accessible name. The server reads which of them were checked; with
// script on, `specs-client` clears the box beside the one just checked. An
// archived spec's Not verified row has a different set: the tick box, a Failed
// box in the second column and the note saying what did not hold.

import { FAIL_NOTE_MAX } from "../../project/parse-status";
import { esc } from "./html.ts";
import { t, type Language } from "../../i18n";

/** What a control needs to know about a row. */
export interface CheckControlRow {
  line: string;
  done: boolean;
  notVerified?: boolean;
  /** Marked `Failed`: never a box, it leaves that state through Reopen. */
  failed?: boolean;
}

interface Options {
  /** The form the boxes belong to when they sit outside it (`form=`). */
  formId?: string;
  /** A Not verified row of an archived spec: it may only be completed or
   *  marked Failed, never moved back or marked again. Draws the tick box, the
   *  Failed box and the note field, named by this row's place among the rows
   *  the form draws (the route reads the note by that number). */
  archivedIndex?: number;
  /** Drawn but not to be changed: a job runs on the spec. The boxes show
   *  their marks, disabled, with no hidden twin and no note field, so
   *  nothing of them is ever posted. */
  disabled?: boolean;
}

const formAttr = (formId: string | undefined): string => (formId ? ` form="${esc(formId)}"` : "");

/** A box's accessible name: the heading's two lines, "Verified: Yes". */
const boxName = (lang: Language, column: string): string =>
  esc(t(lang, "checks.boxName", { heading: t(lang, "checks.verified"), column }));

/** The hidden twin, the tick box and the second box (an archived row: the
 *  Failed box, and its note field after them).
 *  The row's verbatim line is every value: the server finds the row by it and
 *  refuses one that has moved. The hidden twin says the row was on the page,
 *  so a box left clear reads as "taken off" and not as a row nobody mentioned.
 *  The tick box is checked for a ✅ row alone; a Not verified row is done too,
 *  and only its own box is checked. `aria-label` is the last attribute of a
 *  box, so a box ends `checked aria-label="…">`. */
export function checkControls(row: CheckControlRow, lang: Language, options: Options = {}): string {
  const value = esc(row.line);
  const form = formAttr(options.formId);
  const off = options.disabled ? " disabled" : "";
  const box = (extra: string, name: string, checked: boolean, column: string): string =>
    `<label class="checkbox${extra}"><input type="checkbox" name="${name}" value="${value}"${form}` +
    `${checked ? " checked" : ""}${off} aria-label="${boxName(lang, column)}"></label>`;
  const tick =
    (options.disabled ? "" : `<input type="hidden" name="row" value="${value}"${form}>`) +
    box("", "tick", row.done && !row.notVerified, t(lang, "checks.yes"));
  if (options.archivedIndex !== undefined && !options.disabled) {
    return (
      tick +
      box(" unverified", "failed", false, t(lang, "checks.failed")) +
      `<div class="failcontrol">` +
      `<textarea class="failnote" name="failnote-${options.archivedIndex}"${form} rows="5" maxlength="${FAIL_NOTE_MAX}" autocomplete="off" ` +
      `placeholder="${esc(t(lang, "checks.failNote"))}" aria-label="${esc(t(lang, "checks.failNote"))}"></textarea>` +
      `</div>`
    );
  }
  return tick + box(" unverified", "unverified", !!row.notVerified, t(lang, "checks.notYet"));
}

/** The heading over a list's two columns of boxes, a row of the list itself so
 *  the stylesheet gives it the rows' columns. Drawn once, where the list has a
 *  box. Its words are in each box's name, so it is hidden from a reader. */
export function checkColumns(lang: Language, archived: boolean): string {
  return (
    `<li class="checkcolumns" aria-hidden="true">` +
    `<div class="checkverified">${esc(t(lang, "checks.verified"))}</div>` +
    `<div class="checkyes">${esc(t(lang, "checks.yes"))}</div>` +
    `<div class="checkother">${esc(t(lang, archived ? "checks.failed" : "checks.notYet"))}</div>` +
    `</li>`
  );
}

/** A row that is not a box: the mark it carries. A Not verified row is
 *  drawn "Not verified", never ✅. */
export function checkReadOnlyMark(row: CheckControlRow, lang: Language): string {
  if (row.failed) return `<span class="unverified readonly failed">${esc(t(lang, "checks.failed"))}</span>`;
  if (row.notVerified) return `<span class="unverified readonly">${esc(t(lang, "checks.notVerified"))}</span>`;
  return `<span class="checkbox" aria-hidden="true">${row.done ? "✅" : "☐"}</span>`;
}
