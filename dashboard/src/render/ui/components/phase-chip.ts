// A phase, as a control: the chip every phase line and repo line draws,
// with its own lock and tick beside the box.

import { esc } from "../html.ts";
import { ICON_CHECK, ICON_LOCK } from "./icons.ts";

/** A phase, as a control. Four states: the plain box, the ticked box,
 *  a finished phase (checkmark, text dimmed), and one that will not
 *  take a click (lock, and the reason in `title` — the only place the
 *  reason fits on a row). There was a fifth, the phase running right
 *  now, drawn with a spinner in the checkbox's place; spec 168 took it
 *  away. A box is a CONTROL, so a spinner on it read as "this box is
 *  working" rather than "this phase is running" — and it was only ever
 *  visible on an open row, while the fact it reported belongs on the
 *  closed one. The running phase is said by its Progress marker now.
 *
 *  The checkbox is a REAL one, kept visible rather than replaced by a
 *  drawn square: the row is a plain form, and it has to work with
 *  script off and from a keyboard. One box is outside that promise and
 *  says so: a `postTo` box (spec 160) belongs to no form at all and
 *  needs the page's script to do anything. */
export function phaseChip(o: {
  /** The technical name — the form value and the `data-` attribute. */
  value: string;
  /** What the reader sees. */
  label: string;
  /** The checkbox's field name: `steps` for a phase. EMPTY for a box
   *  that must
   *  never be posted at all — the `create` line's, which is ticked and
   *  disabled because the spec exists and cannot be created again. The
   *  attribute is then left out rather than written empty: a field with
   *  no name is not submitted, whatever a browser does with `disabled`. */
  name: string;
  /** `data-phase` for a phase, `data-project` for a repo. */
  dataAttr: string;
  /** The name assistive tech reads, for a box drawn with no visible
   *  label of its own — a phase line's box, whose name is the next
   *  thing on the line rather than inside the label (spec 124). */
  ariaLabel?: string;
  checked?: boolean;
  done?: boolean;
  disabled?: boolean;
  /** `disabled` because the row is busy running a job that already
   *  decided this box's tick, not because the box itself is off
   *  limits. The box keeps whatever look `checked` gives it, dropping
   *  only the interactivity — the padlock is for a control with
   *  nothing else on it to say why it will not take a click, and a
   *  phase queued behind the running one has its tick to say it with
   *  (spec 145). */
  plain?: boolean;
  title?: string;
  /** The id of the form this box belongs to, for a box drawn OUTSIDE
   *  that form — the spec row's rarely-set fields are written after the
   *  Run form's closing tag, beside it on the same line rather than
   *  inside it. Without this the browser posts the form without them. */
  form?: string;
  /** Where this ONE box posts itself, for a box that is not part of any
   *  submission (spec 160): a phase a running job has not reached, whose
   *  tick is the press. The page's own script reads it off the input and
   *  posts there on `change`. Such a box carries no `name` — it names
   *  the row's form only so a press can find the row to lock — and it is
   *  the one kind of chip that does nothing with script off, which is
   *  what the invariant above stops short of. */
  postTo?: string;
}): string {
  const locked = !!o.disabled && !o.plain;
  const state = locked ? "off" : o.done ? "done" : o.checked ? "checked" : "default";
  // `done` is a FACT about the phase, not one of the four looks: a step
  // the spec has already had can also be the step a job is running
  // right now, and a chip that showed only the second lost the first.
  const cls = ["phase", state, o.done && state !== "done" ? "done" : ""].filter(Boolean).join(" ");
  const mark = locked ? `<span class="box">${ICON_LOCK}</span>` : "";
  const tick = o.done ? ` <span class="box" title="already done">${ICON_CHECK}</span>` : "";
  return (
    `<label class="${cls}" ${o.dataAttr}="${esc(o.value)}"` +
    `${o.title ? ` title="${esc(o.title)}"` : ""}>` +
    // `checked` directly after `value`, before the two attributes that
    // are about plumbing rather than state: what a box SAYS is read
    // together, in markup as on the page.
    `<input type="checkbox"${o.name ? ` name="${esc(o.name)}"` : ""} value="${esc(o.value)}"` +
    `${o.checked ? " checked" : ""}${o.disabled ? " disabled" : ""}` +
    `${o.form ? ` form="${esc(o.form)}"` : ""}` +
    `${o.postTo ? ` data-post-to="${esc(o.postTo)}"` : ""}` +
    `${o.ariaLabel ? ` aria-label="${esc(o.ariaLabel)}"` : ""}>` +
    `${mark} <span>${esc(o.label)}</span>${tick}</label>`
  );
}
