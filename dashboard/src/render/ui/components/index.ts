// The things this dashboard is built from: a button, a link drawn as a
// button, a switch, a status badge, a phase chip, a row-level message, a
// field, a filter pill and a back link.
//
// They live in this folder, every one reached through this file, because
// the problem they solve was not that the stylesheet was ugly — it was that every
// spec added a class for its own control. `.stepbox`, `.chip`,
// `.state`, `.pip`, `.tick`, `.branch`, `.refusal`,
// `.rowrun`, and a button in three versions depending on which
// form it sat in. Shared CSS classes alone would not have stopped that:
// nothing prevents the next spec writing its own markup with its own
// class. A function does, and no render file emits a class that is not
// one of these.
//
// Every variant here has a counterpart in the design sheet
// (`specs/102-design-foundation/assets/Components.dc.html`); nothing is
// invented at this layer.

import { esc } from "../html.ts";
import { STEP_LABELS, STEP_LABELS_NB, STEP_LABELS_ES, STEP_LABELS_DE, STEP_LABELS_FR, stepLabel } from "../../../format/step-label.ts";

export { STEP_LABELS, STEP_LABELS_NB, STEP_LABELS_ES, STEP_LABELS_DE, STEP_LABELS_FR, stepLabel };

// --- button ----------------------------------------------------------------

export {
  btn, btnLink, buttonForm, saveCancelActions, dialogAnswers, type BtnOptions, type BtnVariant, type FormHook,
} from "./button.ts";

// --- fold arrow ------------------------------------------------------------------

export { foldArrow, type FoldTitle } from "./fold-arrow.ts";

// --- table of facts ----------------------------------------------------------------

export { facts } from "./facts.ts";

// --- labelled checkbox -------------------------------------------------------------

export { labelledCheckbox } from "./checkbox.ts";

// --- status badge --------------------------------------------------------------

export { badge, type BadgeVariant } from "./badge.ts";

// --- phase chip ----------------------------------------------------------------

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

/** A group of them. One class, so the row does not need a spacing rule
 *  of its own — `cls` adds a second, for the one caller (spec 404's
 *  "picked" block) that needs a variant of the same wrapper. */
export const phases = (chips: string, cls?: string): string =>
  `<span class="${["phases", cls].filter(Boolean).join(" ")}">${chips}</span>`;

// --- row-level message --------------------------------------------------------

export {
  ICON_INFO, ICON_FAILED, rowMessage, rowMessageParts, messageSlot, type MessageVariant, type MessagePart,
} from "./message.ts";

// --- field -----------------------------------------------------------------------

/** A label above its control, at one height and one radius whichever
 *  control it is. A real `<label>` element, so clicking the word
 *  focuses the field. */
export function field(
  label: string,
  control: string,
  // A `<label>` around a GROUP of checkboxes would nest labels, which
  // is invalid and makes the click target ambiguous — so a group asks
  // for a plain wrapper and keeps the same look.
  // `help` is a `helpPopover()` — the "(?)" disclosure — placed at the
  // far end of the label's own line, where a field's explanation goes
  // rather than as a paragraph under the control it explains.
  // `actions` is a form's own Save/Cancel pair, put on that same line
  // after the "(?)" when the field IS the form's only control, so the
  // buttons sit where the eye already is instead of below a tall list.
  // `for`: the control's own `id`. The word alone is then the <label>, and
  // the wrapper a span that can hold buttons and other labels beside it.
  o: { wide?: boolean; group?: boolean; help?: string; actions?: string; for?: string } = {},
): string {
  const tag = o.group || o.for ? "span" : "label";
  const trail = `${o.help ?? ""}${o.actions ?? ""}`;
  const word = o.for ? `<label for="${esc(o.for)}">${esc(label)}</label>` : esc(label);
  const head = trail
    ? `<span class="fieldhead"><span>${word}</span>` +
      `<span class="fieldend">${trail}</span></span>`
    : `<span>${word}</span>`;
  return `<${tag} class="field${o.wide ? " wide" : ""}">${head}${control}</${tag}>`;
}

// --- switch ----------------------------------------------------------------------

/** An on/off control whose position IS the state: a button with the
 *  switch role, drawn from `aria-checked` alone (`switch.css`). Both words
 *  ride on it so `setSwitch` (`specs-client/press.ts`) can move it without
 *  the page repeating them; its accessible name stays one label in every
 *  state, and the word beside it is for the eye only. */
export function switchControl(o: {
  id?: string;
  label: string;
  onWord: string;
  offWord: string;
  checked?: boolean;
  disabled?: boolean;
}): string {
  return (
    `<button type="button" role="switch" class="switch"${o.id ? ` id="${esc(o.id)}"` : ""} ` +
    `aria-checked="${o.checked ? "true" : "false"}" aria-label="${esc(o.label)}" ` +
    `data-on="${esc(o.onWord)}" data-off="${esc(o.offWord)}"${o.disabled ? " disabled" : ""}>` +
    `<span class="switchtrack" aria-hidden="true"><span class="switchknob"></span></span>` +
    `<span class="switchword" aria-hidden="true">${esc(o.checked ? o.onWord : o.offWord)}</span></button>`
  );
}

// --- help popover ----------------------------------------------------------------

/** A "(?)" disclosure that answers one question about the control or panel
 *  beside it — the search field's own "What the search reads" (spec 261),
 *  and, since spec 311, each spec tab's own explanation of what it shows.
 *  `<details>`/`<summary>`, so it opens and closes with no script and is
 *  identical markup with JavaScript off (REQ-7); `menu-script.ts` already
 *  queries every `details.intro` document-wide to close it like any other
 *  disclosure, which is why this reuses that class rather than a new one.
 *  `body` is trusted, developer-authored HTML, the same convention every
 *  other component here follows (`rowMessage`, `field`) — never reader
 *  input. */
export function helpPopover(what: string, body: string): string {
  return (
    `<details class="intro"><summary title="${esc(what)}" aria-label="${esc(what)}">?</summary>` +
    `<p>${body}</p></details>`
  );
}

// --- back link -------------------------------------------------------------------

/** The one back-navigation control every subpage carries, top-left,
 *  labelled "← Back" (spec 252) — replacing the three different
 *  treatments this dashboard drew for it (a bare `<a>` inside `.intro`,
 *  a `.btn` anchor with no wrapper, a `.btn` "Cancel" beside the primary
 *  action) with one. `.intro` is reused rather than invented: it is
 *  already the spacing rule `tabbedBody()` relies on for exactly this
 *  line.
 *
 *  `.backlink`, not `.btn`: it shared the boxed button look until
 *  2026-08-27, which made a real navigation link indistinguishable from
 *  the buttons beside it that submit a form.
 *
 *  A given `title` (spec 296) draws the page's own `<h1>` beside the
 *  link instead of below it, in a `.backhead` flex row — replacing
 *  `pageShell()`'s separate `<div class="pagehead">` or a page's own
 *  hand-written `<h1>` after `backLink()`, either of which left the
 *  title on a line of its own. Omitted, the markup is exactly what it
 *  was before `title` existed. */
export function backLink(href: string, title?: string | { html: string }, trailing = ""): string {
  // No Referer: the page Back leads to works out its own Back from the
  // Referer, and this page as its Referer would point it straight back
  // here — two pages sending each other round in a circle.
  const link = `<a class="backlink" rel="noreferrer" href="${esc(href)}">← Back</a>`;
  // `trailing` rides at the far end of the title's own line: on the spec
  // page, where the spec STANDS — its four pips and, while a phase is
  // running, what it is doing. The Logs tab said it, one click away,
  // and the line naming the spec said nothing.
  const end = trailing ? `<span class="headend">${trailing}</span>` : "";
  return title
    ? `<div class="backhead">${link}<h1>${typeof title === "string" ? esc(title) : title.html}</h1>${end}</div>`
    : `<p class="intro">${link}</p>`;
}

/** Where "← Back" actually goes, from the standard `Referer` request
 *  header (spec 252) — never from a query parameter a reader could put
 *  in a shared link, which is why `serve.ts` is the only caller. A
 *  string ultimately sourced from the client, reflected into a link the
 *  reader's own browser will follow, is a standard open-redirect
 *  surface; same-origin is the guard.
 *
 *  HOST AND PORT, never the scheme — the same comparison the admission
 *  check makes (`serve-helpers/request-guard.ts`). The board is reached
 *  through a proxy that ends TLS and forwards to `127.0.0.1:8788`, so
 *  the browser's `Referer` says https while the request the server sees
 *  says http. Comparing the whole origin threw every "← Back" on that
 *  address onto the fallback. */
export function resolveBackHref(
  referer: string | null,
  requestOrigin: string,
  fallback: string,
  /** The page's own path. A Referer on that same path is one of the
   *  page's own tabs, not somewhere to go back to, so it gets the
   *  fallback too. */
  here?: string,
): string {
  if (!referer) return fallback;
  let refUrl: URL;
  let ownUrl: URL;
  try {
    refUrl = new URL(referer);
    ownUrl = new URL(requestOrigin);
  } catch {
    return fallback;
  }
  if (refUrl.host !== ownUrl.host) return fallback;
  if (here !== undefined && refUrl.pathname === here) return fallback;
  return refUrl.pathname + refUrl.search;
}

// --- typed confirmation ----------------------------------------------------------


// --- progress pips -------------------------------------------------------------------

/** The whole workflow in six millimetres, on the line you are already
 *  reading. Shared by the list and the job page, which computed the
 *  same three-way answer independently until this existed. */
// `waiting` and `refused` (2026-09-11): the pip on a phase line takes
// the colour of the badge beside it, so the two never say a phase's
// state in two colours — amber for held back/stopped, red for failed.
export type PipKind = "past" | "now" | "todo" | "waiting" | "refused";

/** `third` (spec 210): how many of a running implement's three parts
 *  are behind it — 1 or 2, never 0 (zero thirds complete is what an
 *  unmarked pip already says) and never 3 (a step that finished is
 *  `past`). The pip's own box does not change: the mark drives a fill
 *  drawn INSIDE it, so nothing on the line beside it moves.
 *
 *  Only ever on the pip that is running. A `past` or `todo` pip handed
 *  one is the mark answering a question nobody asked of it, so it is
 *  dropped here rather than trusted from each call site. */
// A letter over each pip, in its pip's own state class so the two take
// one colour and one skim (list.css). The row already carries the full
// name in `title`, so the letter is its first character and nothing more.
// `aria-hidden`: `title` already gives the same word to assistive
// tech per pip, and a screen reader spelling out four bare letters
// beside four `title`s reading "Create"/"Analyze"/... would say the
// same thing twice, worse the second time.
export const pips = (items: { kind: PipKind; title: string; third?: 1 | 2 }[]): string =>
  `<div class="pipwrap">` +
  `<div class="pipletters" aria-hidden="true">` +
  items.map((p) => `<span class="${p.kind}">${esc(p.title.slice(0, 1))}</span>`).join("") +
  `</div>` +
  `<div class="pips">` +
  items
    .map(
      (p) =>
        `<span class="pip ${p.kind}"${p.kind === "now" && p.third ? ` data-third="${p.third}"` : ""}` +
        ` title="${esc(p.title)}"></span>`,
    )
    .join("") +
  `</div>` +
  `</div>`;

import { ICON_CHECK, ICON_LOCK } from "./icons.ts";

// What used to live here too, in a part beside this file.
export { ICON_CHECK, ICON_LOCK, ICON_WARN, SPINNER, ICON_PDF, ICON_CHEVRON, ICON_SEARCH, ICON_THEME_DARK, ICON_THEME_LIGHT, ICON_THEME_AUTO, CHECKING } from "./icons.ts";

