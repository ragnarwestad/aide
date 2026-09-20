// A count under every bounded text field, and a line of its own when a paste
// or a drop was cut down to the bound.
//
// A bounded field is a text input or a textarea carrying `maxlength`, or
// `data-maxlength` where the server holds the bound and the browser is not to
// (a Close reason, refused by the server when script is off). The count and
// the line are drawn here, not by the server, so a page with script off is
// exactly what it was.

import { countText, discarded, discardedText, ended, limitState } from "./measure.ts";

type Field = HTMLInputElement | HTMLTextAreaElement;
interface Drawn {
  bound: number;
  count: HTMLElement;
  note: HTMLElement;
}

const BOUNDED =
  'input[type="text"][maxlength], textarea[maxlength], input[type="text"][data-maxlength], textarea[data-maxlength]';

const drawn = new WeakMap<Field, Drawn>();

function draw(doc: Document, field: Field): void {
  const bound = Number(field.getAttribute("maxlength") ?? field.dataset.maxlength);
  if (!Number.isFinite(bound) || bound <= 0) return;
  if (!field.hasAttribute("maxlength")) field.maxLength = bound;
  const count = doc.createElement("span");
  const note = doc.createElement("span");
  note.setAttribute("data-limit-note", "");
  note.setAttribute("role", "status");
  field.after(count, note);
  drawn.set(field, { bound, count, note });
  refreshLimit(field);
}

/** Bring a field's count up to what it holds. For a value the script writes
 *  itself, which raises no `input` event. The line goes once the text is
 *  shorter than the bound: a discard always leaves the field at its bound. */
export function refreshLimit(field: Field): void {
  const d = drawn.get(field);
  if (!d) return;
  const length = field.value.length;
  d.count.textContent = countText(length, d.bound);
  d.count.setAttribute("data-limit", limitState(length, d.bound));
  if (length < d.bound) d.note.textContent = "";
}

const fieldOf = (e: Event): Field | null => {
  const t = e.target as Field | null;
  return t && drawn.has(t) ? t : null;
};

const fold = (field: Field, text: string): number =>
  (field.tagName === "TEXTAREA" ? text.replace(/\r\n?/g, "\n") : text).length;

/** Note the length now, and settle once the browser has made its own
 *  insertion: a paste into a full field inserts nothing and may raise no
 *  `input` at all, so the result is read from a timer, not an event. */
function watch(field: Field, inserted: number, replaced: number): void {
  const before = field.value.length;
  setTimeout(() => {
    const d = drawn.get(field);
    if (!d) return;
    // The count first: it clears the line under the bound, and a paste that
    // cut a surrogate pair ends one under it with a line to show.
    refreshLimit(field);
    const after = field.value.length;
    const lost = discarded(inserted, before, replaced, after);
    d.note.textContent = lost > 0 && ended(after, d.bound) ? discardedText(lost, d.bound) : "";
  }, 0);
}

export function bindLimits(doc: Document): void {
  for (const field of doc.querySelectorAll(BOUNDED)) draw(doc, field as Field);
  let dragged: Field | null = null;
  doc.addEventListener("input", (e) => {
    const field = fieldOf(e);
    if (field) refreshLimit(field);
  });
  doc.addEventListener("paste", (e) => {
    const field = fieldOf(e);
    if (!field) return;
    const text = (e as ClipboardEvent).clipboardData?.getData("text") ?? "";
    watch(field, fold(field, text), Math.abs((field.selectionEnd ?? 0) - (field.selectionStart ?? 0)));
  });
  // A move inside one field discards nothing, and a cancelled drag must not
  // hide a later drop from outside.
  doc.addEventListener("dragstart", (e) => {
    dragged = fieldOf(e);
  });
  doc.addEventListener("dragend", () => {
    dragged = null;
  });
  doc.addEventListener("drop", (e) => {
    const field = fieldOf(e);
    if (field && field !== dragged) {
      const text = (e as DragEvent).dataTransfer?.getData("text") ?? "";
      watch(field, fold(field, text), 0);
    }
    dragged = null;
  });
}
