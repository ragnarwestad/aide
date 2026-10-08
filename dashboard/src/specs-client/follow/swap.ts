// Replacing only what differs. A part the answer holds is compared with the
// page's part of the same name by the browser's own serialisation of both; a
// part with one table is compared row by row; and a row whose only change is
// a longer log is given the new end after what is drawn. Nothing is moved out
// of the answer, so a swap that had to wait can run again from it.

import { dialogOpenIn } from "./place.ts";

/** Whether the reader's selection reaches into a node: it is not replaced. */
export type Held = (node: Node) => boolean;

const LOG = ".logbox pre";

/** A row whose log has only grown: the new serialisation of its `pre` begins
 *  with the old one, and the rest of the row is equal. */
function grewLog(old: Element, next: Element): boolean {
  const before = old.querySelector(LOG);
  const after = next.querySelector(LOG);
  if (!before || !after) return false;
  const was = before.innerHTML;
  const now = after.innerHTML;
  if (now.length <= was.length || !now.startsWith(was)) return false;
  const a = old.cloneNode(true) as Element;
  const b = next.cloneNode(true) as Element;
  a.querySelector(LOG)!.innerHTML = "";
  b.querySelector(LOG)!.innerHTML = "";
  return a.outerHTML === b.outerHTML;
}

/** The rows of a part's one table, swapped by position; the table head, with
 *  the tab's help popover, is never touched. `unaccounted` when the part has
 *  no body to compare. Otherwise whether a row had to wait for the selection. */
function swapRows(mine: Element, next: Element, held: Held): "unaccounted" | boolean {
  const body = mine.querySelector("tbody");
  const nextBody = next.querySelector("tbody");
  if (!body || !nextBody) return "unaccounted";
  const rows = [...body.children];
  const nextRows = [...nextBody.children];
  let waiting = false;
  for (let i = 0; i < Math.max(rows.length, nextRows.length); i++) {
    const row = rows[i];
    const fresh = nextRows[i];
    if (row && fresh) {
      if (row.outerHTML === fresh.outerHTML) continue;
      if (grewLog(row, fresh)) {
        const log = row.querySelector(LOG)!;
        log.insertAdjacentHTML("beforeend", fresh.querySelector(LOG)!.innerHTML.slice(log.innerHTML.length));
      } else if (held(row)) waiting = true;
      else row.replaceWith(fresh.cloneNode(true));
    } else if (fresh) body.append(fresh.cloneNode(true));
    else if (row) {
      if (held(row)) waiting = true;
      else row.remove();
    }
  }
  return waiting;
}

/** Swap every `[data-follow-part]` of `answer` into `doc`. Returns whether
 *  anything had to wait for a selection to go. A part that holds an open
 *  dialog is left whole, since rows are swapped by position and holding one
 *  row would draw a row inserted above it twice; it catches up on the first
 *  answer after the question closes. */
export function swapParts(doc: Document, answer: ParentNode, held: Held): boolean {
  let waiting = false;
  for (const next of answer.querySelectorAll("[data-follow-part]")) {
    const name = next.getAttribute("data-follow-part");
    const mine = doc.querySelector(`[data-follow-part="${name}"]`);
    if (!mine || mine.innerHTML === next.innerHTML) continue;
    if (dialogOpenIn(mine)) {
      waiting = true;
      continue;
    }
    if (mine.querySelectorAll("table").length === 1 && next.querySelectorAll("table").length === 1) {
      const done = swapRows(mine, next, held);
      if (done !== "unaccounted") {
        if (done) waiting = true;
        continue;
      }
    }
    if (held(mine)) waiting = true;
    else mine.replaceChildren(...[...next.childNodes].map((n) => n.cloneNode(true)));
  }
  return waiting;
}
