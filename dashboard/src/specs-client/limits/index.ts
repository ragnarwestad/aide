// A count under every bounded text field, and a line of its own when a paste
// or a drop was cut down to the bound.
//
// A bounded field is a text input or a textarea carrying `maxlength`, or
// `data-maxlength` where the server holds the bound and the browser is not to
// (a Close reason, refused by the server when script is off). A textarea
// carrying `data-bound` is counted and never cut: past its bound it is marked
// over, says how many characters too many it holds, and holds its form back
// from submitting. The count and the line are drawn here, not by the server,
// so a page with script off is exactly what it was.

import { countText, discarded, discardedText, ended, limitState, overText } from "./measure.ts";

type Field = HTMLInputElement | HTMLTextAreaElement;
interface Drawn {
  bound: number;
  count: HTMLElement;
  note: HTMLElement;
}

const BOUNDED =
  'input[type="text"][maxlength], textarea[maxlength], input[type="text"][data-maxlength], textarea[data-maxlength], textarea[data-bound]';

const drawn = new WeakMap<Field, Drawn>();

/** A field that is counted against its bound and never cut. */
const isUncut = (field: Field): boolean => field.hasAttribute("data-bound");

function draw(doc: Document, field: Field): void {
  const bound = Number(field.getAttribute("maxlength") ?? field.dataset.maxlength ?? field.dataset.bound);
  if (!Number.isFinite(bound) || bound <= 0) return;
  if (!field.hasAttribute("maxlength") && !isUncut(field)) field.maxLength = bound;
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
  if (isUncut(field)) return markOver(field, d, length);
  if (length < d.bound) d.note.textContent = "";
}

/** Mark a field that is never cut as over, or clear the mark. An invalid field
 *  is what makes the browser refuse to submit its form. */
function markOver(field: Field, d: Drawn, length: number): void {
  if (length > d.bound) {
    const sentence = overText(length - d.bound, d.bound);
    field.setAttribute("aria-invalid", "true");
    field.setCustomValidity(sentence);
    d.note.textContent = sentence;
    d.note.setAttribute("data-over", "");
  } else {
    field.removeAttribute("aria-invalid");
    field.setCustomValidity("");
    d.note.textContent = "";
    d.note.removeAttribute("data-over");
  }
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

/** Draw the count and the note under every bounded field below `root` that has none yet.
 *  For rows the server redraws after the page has loaded. */
export function drawLimits(root: ParentNode): void {
  for (const field of root.querySelectorAll(BOUNDED)) {
    if (!drawn.has(field as Field)) draw(field.ownerDocument, field as Field);
  }
}

export function bindLimits(doc: Document): void {
  drawLimits(doc);
  let dragged: Field | null = null;
  doc.addEventListener("input", (e) => {
    const field = fieldOf(e);
    if (field) refreshLimit(field);
  });
  doc.addEventListener("paste", (e) => {
    const field = fieldOf(e);
    if (!field || isUncut(field)) return;
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
    if (field && !isUncut(field) && field !== dragged) {
      const text = (e as DragEvent).dataTransfer?.getData("text") ?? "";
      watch(field, fold(field, text), 0);
    }
    dragged = null;
  });
}
