// Why a press on the Specs list was refused, kept by the page itself: the
// rows are redrawn from the server on every change, and the server knows
// nothing about a refusal it answered a moment ago. The sentence is
// written under the spec it was pressed for, put back after every redraw,
// and gone once another press starts. One naming no spec on the list goes
// into the list's own line above the rows, which no redraw replaces.

import { writeLine } from "../press.ts";

/** Hand-paired with `render/pages/specs-list/notice-row.ts`, which draws
 *  the row this copies and the list's own line; the bundle imports nothing
 *  from outside this folder. */
const TEMPLATE_ID = "refusal-row";
const LIST_LINE_ID = "list-refused";
const SPEC_HEAD = "spechead";
const SPEC_GAP = "specgap";

let held: { why: string; spec?: string } | null = null;

const hasClass = (el: Element, name: string): boolean => ` ${el.className} `.indexOf(` ${name} `) !== -1;

/** Where the spec's rows end: its gap row, or its last row when it has none. */
function groupEnd(head: Element): { before: Element } | { after: Element } {
  let last = head;
  for (let el = head.nextElementSibling; el && !hasClass(el, SPEC_HEAD); el = el.nextElementSibling) {
    if (hasClass(el, SPEC_GAP)) return { before: el };
    last = el;
  }
  return { after: last };
}

/** Writes the held refusal into the page as it now stands: the row a
 *  previous write put in is taken out first, so a redraw that left it
 *  and one that replaced it end the same way. */
export function applyRefusal(): void {
  for (const old of Array.from(document.querySelectorAll("tr[data-refusal]"))) old.remove();
  const listLine = document.getElementById(LIST_LINE_ID);
  writeLine(listLine, held && !held.spec ? held.why : "");
  if (!held?.spec) return;
  const head = document.getElementById(`spec-${held.spec}`);
  const template = document.getElementById(TEMPLATE_ID) as HTMLTemplateElement | null;
  const copy = template?.content?.querySelector("tr[data-refusal]")?.cloneNode(true) as Element | undefined;
  if (!head || !copy) return;
  const end = groupEnd(head);
  // In with its line empty, and the words written after: a line that
  // fills is what a screen reader announces.
  if ("before" in end) end.before.insertAdjacentElement("beforebegin", copy);
  else end.after.insertAdjacentElement("afterend", copy);
  writeLine(copy.querySelector(".refused"), held.why);
}

/** Keeps a refusal and writes it at once: a redraw that never comes (a
 *  failed fetch, a newer press) must not leave the reader without it. */
export function holdRefusal(why: string, spec: string | undefined): void {
  held = { why, spec };
  applyRefusal();
}

/** A new press: whatever the last one was refused for is over. */
export function clearRefusal(): void {
  if (!held) return;
  held = null;
  applyRefusal();
}
