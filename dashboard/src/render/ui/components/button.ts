// The button, the link drawn as one, and the Save/Cancel row every
// document form carries. A confirm box's answers are `confirm-dialog.ts`'s.
// `index.ts` re-exports every name here; the pages import it from there.

import { esc } from "../html.ts";
import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { ICON_CLOSE, SPINNER } from "./icons.ts";

// --- button -------------------------------------------------------------------

/** Bare is secondary — the default for a control that is NOT the one
 *  thing a page wants pressed: the escape-hatch Cancel link beside a
 *  primary Create or Save. A spec row's own action is never bare, and
 *  since spec 161 never `danger` either — `danger` means one thing on
 *  this dashboard now, an action a mistake cannot undo. */
export type BtnVariant = "" | "primary" | "ok" | "danger" | "busy";

export interface BtnOptions {
  label: string;
  variant?: BtnVariant;
  /** `submit` unless said otherwise: every control on this page is a
   *  real form, which is what makes it work with script off. */
  type?: "submit" | "button";
  /** What the button says while its request is out. `specs-client.ts`
   *  reads it, so it belongs beside the label it replaces. */
  pending?: string;
  title?: string;
  disabled?: boolean;
  /** The override next to a disabled Merge: deliberately not a second
   *  button of the same size. */
  small?: boolean;
  /** A stable id for a script to find this exact button directly
   *  (`spec-form-actions.ts`'s Save/Cancel pair) rather than by
   *  position — most buttons need none, since a form-level submit
   *  listener finds them by `closest()`/`querySelector` instead. */
  id?: string;
  /** The id of the form this button submits, for a button drawn OUTSIDE
   *  that form — a spec row's Run, written after the Run form's closing
   *  tag, beside the fields that also name it. */
  form?: string;
  /** What the button hands its form when it is the one pressed — the
   *  leave dialog's OK closes it with `returnValue` "leave". */
  value?: string;
  /** Each key written as `data-<key>="<value>"`: the hook a script finds
   *  this button by (`data-ask`). */
  data?: Record<string, string>;
  /** The name a screen reader reads, for a button whose label alone does
   *  not say what it acts on — one Delete per schedule entry. */
  ariaLabel?: string;
}

export function btn(o: BtnOptions): string {
  const cls = ["btn", o.variant || "", o.small ? "small" : ""].filter(Boolean).join(" ");
  const attrs =
    (o.id ? `id="${esc(o.id)}" ` : "") +
    `type="${o.type ?? "submit"}" class="${cls}"` +
    (o.form ? ` form="${esc(o.form)}"` : "") +
    (o.value !== undefined ? ` value="${esc(o.value)}"` : "") +
    dataAttrs(o.data) +
    (o.pending ? ` data-pending="${esc(capitalizeFirst(o.pending))}"` : "") +
    (o.title ? ` title="${esc(o.title)}"` : "") +
    (o.ariaLabel ? ` aria-label="${esc(o.ariaLabel)}"` : "") +
    (o.disabled ? " disabled" : "");
  // The spinner sits INSIDE the button, before the label, so a busy
  // control reads as busy without a second element beside it.
  const spin = o.variant === "busy" ? SPINNER : "";
  return `<button ${attrs}>${spin}${esc(o.label)}</button>`;
}

/** Each key written as ` data-<key>="<value>"`, the value escaped. */
export const dataAttrs = (data: Record<string, string> = {}): string =>
  Object.entries(data)
    .map(([key, value]) => ` data-${key}="${esc(value)}"`)
    .join("");

/** The class a script or the stylesheet selects a one-button form by:
 *  `actionform` is posted by script (`press.ts`), `schedulerun`,
 *  `deployform` and `removeform` have their own listeners, and
 *  `configactions` lines the button up at the row's end. */
export type FormHook = "actionform" | "actionform schedulerun" | "deployform" | "removeform" | "configactions";

/** A form whose only control is one button: hidden fields, a message line
 *  or a dialog inside it are not controls. Every value is raw and escaped
 *  here once. Its attributes come in one order: `id`, `method`, `action`,
 *  `class`, `data-*`, `target`. */
export function buttonForm(o: {
  /** A `btn()`, or the close cross in a dialog's corner, which is its icon
   *  alone and says what it does in `aria-label` (the About box's). */
  button: BtnOptions | { cross: string };
  /** Where it posts, unescaped; absent for `method: "dialog"`. */
  action?: string;
  /** The platform's own close of the dialog the form is in; a post otherwise. */
  method?: "dialog";
  hook?: FormHook;
  id?: string;
  /** Fields posted with the press. */
  hidden?: Record<string, string>;
  data?: Record<string, string>;
  /** A new tab for what the post answers with — and so never a script hook,
   *  which would post it in the page instead. */
  target?: "_blank";
  /** Trusted markup after the button, inside the form: a message line, a dialog. */
  after?: string;
}): string {
  const attrs =
    (o.id ? `id="${esc(o.id)}" ` : "") +
    `method="${o.method ?? "post"}"` +
    (o.action !== undefined ? ` action="${esc(o.action)}"` : "") +
    (o.hook ? ` class="${o.hook}"` : "") +
    dataAttrs(o.data) +
    (o.target ? ` target="${o.target}"` : "");
  const hidden = Object.entries(o.hidden ?? {})
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("");
  const button =
    "cross" in o.button
      ? `<button class="aboutclose" aria-label="${esc(o.button.cross)}">${ICON_CLOSE}</button>`
      : btn(o.button);
  return `<form ${attrs}>${hidden}${button}${o.after ?? ""}</form>`;
}

/** A link drawn as a button: somewhere to GO, where a button does
 *  something — New spec, Edit, Try again. A link that cannot be followed
 *  right now is not drawn as one: it is a disabled `btn()`, since a link
 *  has no disabled state of its own. */
export function btnLink(o: {
  href: string;
  label: string;
  /** Every button variant but `busy`: a clicked link is marked by
   *  `nav-busy.ts`, not by the link. */
  variant?: Exclude<BtnVariant, "busy">;
  small?: boolean;
  /** A class a script or a layout rule selects on. */
  hook?: string;
  data?: Record<string, string>;
}): string {
  const cls = ["btn", o.variant || "", o.small ? "small" : "", o.hook ?? ""].filter(Boolean).join(" ");
  return `<a class="${cls}" href="${esc(o.href)}"${dataAttrs(o.data)}>${esc(o.label)}</a>`;
}

/** The Save/Cancel pair every `.specform` carries (spec 391), on the
 *  same line as the tab's own help mark rather than below the field it
 *  saves. Save renders enabled — REQ-7 needs it to keep working with
 *  scripting off — and `spec-form-actions.ts` disables both the instant
 *  it runs, only re-enabling them once the form has seen an edit.
 *  Cancel renders `disabled` from the start: nothing asks it to work
 *  without that script, so there is nothing wrong with it needing one.
 *
 *  `o.variant` is for the one form whose submit cannot be undone — Close
 *  deletes the spec's code branch without merging it — so it carries
 *  `danger` the way every other irreversible control does. */
export function saveCancelActions(prefix = "specform", o: { variant?: BtnVariant } = {}): string {
  return (
    `<span class="factions">` +
    btn({ id: `${prefix}-save`, label: "Save", variant: o.variant ?? "primary", pending: "saving…" }) +
    btn({ id: `${prefix}-cancel`, label: "Cancel", type: "button", disabled: true }) +
    `</span>`
  );
}
