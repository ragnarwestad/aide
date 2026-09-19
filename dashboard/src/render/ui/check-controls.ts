// The boxes for ONE acceptance row, drawn once for the Status tab and the
// Specs list's unfolded criteria. A row has two: the tick box (done) and a
// box labelled "Not verified" (a check that has to wait for something after
// the deploy). The server reads which of them were checked; with script on,
// `specs-client` clears the box beside the one just checked. An archived
// spec's Not verified row has a different set: the tick box, a Failed box and
// the note saying what did not hold.

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
}

const formAttr = (formId: string | undefined): string => (formId ? ` form="${esc(formId)}"` : "");

/** The hidden twin, the tick box and the Not verified box (an archived row:
 *  the Failed box and its note instead).
 *  The row's verbatim line is every value: the server finds the row by it and
 *  refuses one that has moved. The hidden twin says the row was on the page,
 *  so a box left clear reads as "taken off" and not as a row nobody mentioned.
 *  The tick box is checked for a ✅ row alone; a Not verified row is done too,
 *  and only its own box is checked. */
export function checkControls(row: CheckControlRow, lang: Language, options: Options = {}): string {
  const value = esc(row.line);
  const form = formAttr(options.formId);
  const tickChecked = row.done && !row.notVerified;
  const tick =
    `<input type="hidden" name="row" value="${value}"${form}>` +
    `<label class="checkbox"><input type="checkbox" name="tick" value="${value}"${form}` +
    `${tickChecked ? " checked" : ""}></label>`;
  if (options.archivedIndex !== undefined) {
    return (
      tick +
      `<label class="unverified"><input type="checkbox" name="failed" value="${value}"${form}> ${esc(t(lang, "checks.failed"))}</label>` +
      `<input type="text" class="failnote" name="failnote-${options.archivedIndex}"${form} autocomplete="off" ` +
      `placeholder="${esc(t(lang, "checks.failNote"))}" aria-label="${esc(t(lang, "checks.failNote"))}">`
    );
  }
  return (
    tick +
    `<label class="unverified"><input type="checkbox" name="unverified" value="${value}"${form}` +
    `${row.notVerified ? " checked" : ""}> ${esc(t(lang, "checks.notVerified"))}</label>`
  );
}

/** A row that is not a box: the mark it carries. A Not verified row is
 *  drawn "Not verified", never ✅. */
export function checkReadOnlyMark(row: CheckControlRow, lang: Language): string {
  if (row.failed) return `<span class="unverified readonly failed">${esc(t(lang, "checks.failed"))}</span>`;
  if (row.notVerified) return `<span class="unverified readonly">${esc(t(lang, "checks.notVerified"))}</span>`;
  return `<span class="checkbox" aria-hidden="true">${row.done ? "✅" : "☐"}</span>`;
}
