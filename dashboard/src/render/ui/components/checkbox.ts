// A checkbox, or a radio button, with its words beside it.
// `index.ts` re-exports every name here; the pages import it from there.

import { esc } from "../html.ts";

/** Open, the box and its words sit in one `<label class="row">`, so a click
 *  on the words ticks it. Disabled, in a `<span class="row"
 *  aria-disabled="true">`, with room for a help popover after the words —
 *  a popover is never put inside a label. Never `.checkbox`: that is the
 *  acceptance row's fixed 18px square, and it squeezes words into it. */
export function labelledCheckbox(o: {
  /** The words beside the box, escaped here. */
  label: string;
  name?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  /** The id of the form the box belongs to, for a box drawn outside it. */
  form?: string;
  /** A `helpPopover()` after the words, on a disabled box's line only. */
  help?: string;
}): string {
  const box =
    `<input type="checkbox"` +
    (o.name ? ` name="${esc(o.name)}"` : "") +
    (o.value !== undefined ? ` value="${esc(o.value)}"` : "") +
    (o.form ? ` form="${esc(o.form)}"` : "") +
    (o.disabled ? " disabled" : "") +
    (o.checked ? " checked" : "") +
    `>`;
  const words = `<span>${esc(o.label)}</span>`;
  return o.disabled
    ? `<span class="row" aria-disabled="true">${box}${words}${o.help ?? ""}</span>`
    : `<label class="row">${box}${words}</label>`;
}

/** A radio button and its words in one `<label class="row">`, so a click
 *  on the words picks it — `labelledCheckbox`'s shape for a choice of one.
 *  With `href` the words are a link, which a click follows instead. */
export function labelledRadio(o: {
  /** The words beside the button, escaped here. */
  label: string;
  name: string;
  value: string;
  checked?: boolean;
  disabled?: boolean;
  /** The id of the form the button belongs to. */
  form?: string;
  href?: string;
}): string {
  const radio =
    `<input type="radio" name="${esc(o.name)}" value="${esc(o.value)}"` +
    (o.form ? ` form="${esc(o.form)}"` : "") +
    (o.disabled ? " disabled" : "") +
    (o.checked ? " checked" : "") +
    `>`;
  const words = o.href ? `<a href="${esc(o.href)}">${esc(o.label)}</a>` : `<span>${esc(o.label)}</span>`;
  return `<label class="row">${radio}${words}</label>`;
}
