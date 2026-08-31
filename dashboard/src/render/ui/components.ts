// The seven things this dashboard is built from: a button, a status
// badge, a phase chip, a row-level message, a field, a filter pill and
// a back link.
//
// They live in ONE file with one call site each, because the problem
// they solve was not that the stylesheet was ugly — it was that every
// spec added a class for its own control. `.stepbox`, `.chip`,
// `.state`, `.pip`, `.tick`, `.branch`, `.refusal`, `.newspec`,
// `.rowrun`, `.extra`, and a button in three versions depending on which
// form it sat in. Shared CSS classes alone would not have stopped that:
// nothing prevents the next spec writing its own markup with its own
// class. A function does, and a guard test
// (`test/css-token-guard.test.ts`) refuses any class that is not one of
// these.
//
// Every variant here has a counterpart in the design sheet
// (`specs/102-design-foundation/assets/Components.dc.html`); nothing is
// invented at this layer.

import { esc } from "./html.ts";

// --- icons -------------------------------------------------------------------

// Inline, like everything else here: the generated site is published as
// plain files by rsync and has to work opened from a folder, so there
// is no second request to make.

/** A finished phase. */
export const ICON_CHECK =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M3 8.5l3 3 7-7"></path></svg>`;

/** A control that will not take a click, and says why in its `title`. */
export const ICON_LOCK =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" aria-hidden="true">` +
  `<rect x="3.5" y="7" width="9" height="6" rx="1"></rect>` +
  `<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"></path></svg>`;

/** The mark on a refusal or a warning. Colour is never the only signal:
 *  a reader who cannot tell red from amber still sees this. */
export const ICON_WARN =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M8 2.5l6 11H2z"></path><path d="M8 6.5v3.2M8 12h.01"></path></svg>`;

/** Something is happening. A span, not an SVG: it is one CSS rotation. */
export const SPINNER = `<span class="spin" aria-hidden="true"></span>`;

/** One chevron for every fold control on the site — the specs list's own
 *  row, a phase, and (since spec 240's Steps tab) a step's own log.
 *  Shared rather than redefined per file: the `.fold`/`.fold.shut`
 *  rotate-in-CSS pair in css.ts is already one shared pattern, and a
 *  second copy of the SVG that drew it would be the same shape of
 *  duplication one layer up. Stroke-based so it takes the text colour
 *  and scales with the flat. */
export const ICON_CHEVRON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 6l4 4 4-4"></path></svg>';

/** A magnifying glass, left-aligned inside the specs-search field
 *  (design handoff, 2026-08-25) — same inline-SVG, stroke-only pattern
 *  as `ICON_CHEVRON`. */
export const ICON_SEARCH =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6">' +
  '<circle cx="7" cy="7" r="4.5"></circle><path d="M10.5 10.5L14 14" stroke-linecap="round"></path></svg>';

/** The header's theme switch (spec 243, relocated out of the "…"
 *  menu): a sun, a crescent moon, and a half-filled circle for Auto. */
export const ICON_THEME_DARK =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.2 4.2 0 0 0 6.5 6.5z"></path></svg>';

export const ICON_THEME_LIGHT =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<circle cx="8" cy="8" r="3"></circle>' +
  '<path d="M8 1.5v1.5M8 13v1.5M2.5 8H1M15 8h-1.5M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1"></path></svg>';

export const ICON_THEME_AUTO =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6">' +
  '<circle cx="8" cy="8" r="5.5"></circle>' +
  '<path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"></path></svg>';

/** What a page says where an answer has not arrived yet (spec 208).
 *
 *  Every question a render used to block on is a peek now, and a peek
 *  can say three things, not two: the answer, "asked and unanswerable",
 *  and "nobody has asked yet". This is the third. It is spelled out in
 *  one place because five call sites across three pages say it, and a
 *  page wording the same absence differently in two cells is a page
 *  whose two cells look like two different states.
 *
 *  It is NOT what an unanswerable question says — a spec git cannot
 *  date still shows a dash, and a file git cannot date still shows no
 *  stamp, exactly as each did before any of this was cached.
 *
 *  A pulsing bar, not the word (asked for 2026-08-24): the text read
 *  as a fact the row was stating rather than work in progress. The
 *  word survives inside, visually hidden, for screen readers — and for
 *  every test that asks whether a cell is still checking. */
export const CHECKING =
  '<span class="checking" title="checking…"><span class="sr">checking…</span></span>';

// --- the step's name is not the reader's word --------------------------------

/** What a phase is CALLED on the page. Empty since spec 181: `review`
 *  was the reader-facing word for the standalone `review-plan` step,
 *  which folded into `analyze` and is no longer a step of its own. Kept
 *  as a table (not deleted) so the row, the phase line, the pips and the
 *  job page have one shared place to add a translation if a future step
 *  needs one — `stepLabel` below falls back to the step's own name for
 *  every entry not listed here. */
export const STEP_LABELS: Record<string, string> = {};

export const stepLabel = (step: string): string => STEP_LABELS[step] ?? step;

/** The same, for a sentence built from several steps. */

// --- button -------------------------------------------------------------------

/** Bare is secondary — the default for a control that is NOT the one
 *  thing a page wants pressed: the escape-hatch Cancel link beside a
 *  primary Create or Save. A spec row's own action is never bare, and
 *  since spec 161 never `danger` either — `danger` means one thing on
 *  this dashboard now, an action a mistake cannot undo. */
export type BtnVariant = "" | "primary" | "ok" | "danger" | "busy";

export function btn(o: {
  label: string;
  variant?: BtnVariant;
  /** `submit` unless said otherwise: every control on this page is a
   *  real form, which is what makes it work with script off. */
  type?: "submit" | "button";
  /** What the button says while its request is out. `queue-client.ts`
   *  reads it, so it belongs beside the label it replaces. */
  pending?: string;
  title?: string;
  disabled?: boolean;
  /** The override next to a disabled Merge: deliberately not a second
   *  button of the same size. */
  small?: boolean;
}): string {
  const cls = ["btn", o.variant || "", o.small ? "small" : ""].filter(Boolean).join(" ");
  const attrs =
    `type="${o.type ?? "submit"}" class="${cls}"` +
    (o.pending ? ` data-pending="${esc(o.pending)}"` : "") +
    (o.title ? ` title="${esc(o.title)}"` : "") +
    (o.disabled ? " disabled" : "");
  // The spinner sits INSIDE the button, before the label, so a busy
  // control reads as busy without a second element beside it.
  const spin = o.variant === "busy" ? SPINNER : "";
  return `<button ${attrs}>${spin}${esc(o.label)}</button>`;
}

// --- status badge --------------------------------------------------------------

/** The six the design sheet defines. Every job state maps onto one of
 *  them (`job-state.ts`, `BADGE_VARIANT`) — a seventh would be a state
 *  the page has no word for. */
export type BadgeVariant = "idle" | "running" | "waiting" | "ready" | "refused" | "done";

/** Which of them are LIVE. The dot is itself semantic: a state
 *  something is still happening to carries one, a settled state does
 *  not. */
const LIVE: BadgeVariant[] = ["running", "waiting", "ready", "refused"];

export function badge(variant: BadgeVariant, label: string, title?: string): string {
  const dot = LIVE.includes(variant) ? `<span class="dot" aria-hidden="true"></span>` : "";
  return (
    `<span class="badge b-${variant}"${title ? ` title="${esc(title)}"` : ""}>` +
    `${dot}${esc(label)}</span>`
  );
}

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
 *  of its own. */
export const phases = (chips: string): string => `<span class="phases">${chips}</span>`;

// --- row-level message ----------------------------------------------------------

export type MessageVariant = "err" | "warn" | "info";

/** Why the button you just pressed did nothing, on the row you pressed
 *  it on. `hook` is the class `queue-client.ts` selects on — it carries
 *  no styling of its own, and renaming one silently breaks the browser
 *  code with no type error to catch it. */
export function rowMessage(
  variant: MessageVariant,
  text: string,
  o: { hook?: string; tag?: "div" | "p" } = {},
): string {
  const tag = o.tag ?? "div";
  const cls = [o.hook, "rowmsg", variant].filter(Boolean).join(" ");
  // `info` has no icon by design: it is a note, not a thing gone wrong.
  const icon = variant === "info" ? "" : ICON_WARN;
  return `<${tag} class="${cls}">${icon}<span>${esc(text)}</span></${tag}>`;
}

/** The slot a refusal is WRITTEN into by the browser code, as opposed
 *  to one the server rendered. It must stay empty until then —
 *  `.rowmsg:empty` draws nothing — so it gets no icon: `textContent`
 *  would wipe one anyway. */
export const messageSlot = (hook: string, variant: MessageVariant = "err"): string =>
  `<p class="${hook} rowmsg ${variant}"></p>`;

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
  o: { wide?: boolean; group?: boolean } = {},
): string {
  const tag = o.group ? "span" : "label";
  return (
    `<${tag} class="field${o.wide ? " wide" : ""}">` +
    `<span>${esc(label)}</span>${control}</${tag}>`
  );
}

/** The token, when the page was given one, as the form's own hidden
 *  field. The server prefers the header, the query string and the
 *  cookie; this is what is left for a plain form POST from a browser
 *  that got the page some other way. Empty when there is no token —
 *  never an empty field, which would post a wrong one.
 *
 *  Shared since spec 115: the Projects panel moved to its own page and
 *  every form on it needs the same field the spec list's do. */
export const tokenField = (token?: string): string =>
  token ? `<input type="hidden" name="token" value="${esc(token)}">` : "";

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
export function backLink(href: string, title?: string): string {
  const link = `<a class="backlink" href="${esc(href)}">← Back</a>`;
  return title
    ? `<div class="backhead">${link}<h1>${esc(title)}</h1></div>`
    : `<p class="intro">${link}</p>`;
}

/** Where "← Back" actually goes, from the standard `Referer` request
 *  header (spec 252) — never from a query parameter a reader could put
 *  in a shared link, which is why `serve.ts` is the only caller. A
 *  string ultimately sourced from the client, reflected into a link the
 *  reader's own browser will follow, is a standard open-redirect
 *  surface; same-origin is the guard.
 *
 *  `token` is stripped from a kept referer: the server prefers the
 *  header, the query string and the cookie for it (`tokenField`'s own
 *  comment), and reflecting one page's query-string token into another
 *  page's link would put a credential-shaped value where it does not
 *  need to be, sent again on the next click. */
export function resolveBackHref(
  referer: string | null,
  requestOrigin: string,
  fallback: string,
): string {
  if (!referer) return fallback;
  let refUrl: URL;
  try {
    refUrl = new URL(referer);
  } catch {
    return fallback;
  }
  if (refUrl.origin !== requestOrigin) return fallback;
  refUrl.searchParams.delete("token");
  return refUrl.pathname + refUrl.search;
}

// --- typed confirmation ----------------------------------------------------------

/** The name typed back, before something leaves the dashboard.
 *
 *  There was no confirmation of any kind on this page before spec 112 —
 *  Cancel, the only destructive-looking control, fires on the click. A
 *  project leaving the allowlist is not a click's worth of deliberate,
 *  so the reader types the name.
 *
 *  The button is rendered ENABLED and the browser code turns it off
 *  until the input matches (`queue-client.ts`). That order is the whole
 *  point: every control on this page is a real form that works with
 *  script off, and a button rendered `disabled` could never be enabled
 *  again without script. What makes the confirmation a GATE rather than
 *  a hint is the server, which refuses anything but an exact match —
 *  with script on, the reader simply finds that out before pressing.
 *
 *  `data-confirm` rides on a bare `<span>`: a wrapper with a data
 *  attribute and no class leaves the closed component vocabulary
 *  (`css-token-guard.test.ts`) untouched. */
export function typedConfirm(o: {
  /** What has to be typed back — and what the browser compares against. */
  target: string;
  label: string;
  button: string;
  pending: string;
}): string {
  return (
    `<span data-confirm="${esc(o.target)}">` +
    field(
      o.label,
      `<input type="text" name="confirm" autocomplete="off" spellcheck="false" ` +
        `required placeholder="${esc(o.target)}">`,
    ) +
    btn({ label: o.button, variant: "danger", pending: o.pending }) +
    `</span>`
  );
}

// --- progress pips -------------------------------------------------------------------

/** The whole workflow in six millimetres, on the line you are already
 *  reading. Shared by the list and the job page, which computed the
 *  same three-way answer independently until this existed. */
export type PipKind = "past" | "now" | "todo";

/** `third` (spec 210): how many of a running implement's three parts
 *  are behind it — 1 or 2, never 0 (zero thirds complete is what an
 *  unmarked pip already says) and never 3 (a step that finished is
 *  `past`). The pip's own box does not change: the mark drives a fill
 *  drawn INSIDE it, so nothing on the line beside it moves.
 *
 *  Only ever on the pip that is running. A `past` or `todo` pip handed
 *  one is the mark answering a question nobody asked of it, so it is
 *  dropped here rather than trusted from each call site. */
// A letter over each pip (asked 2026-08-31): the row already carries
// the full name in `title` (a hover-only fact), so the letter is just
// its first character — no second source of truth to keep in sync.
// `aria-hidden`: `title` already gives the same word to assistive
// tech per pip, and a screen reader spelling out four bare letters
// beside four `title`s reading "Create"/"Analyze"/... would say the
// same thing twice, worse the second time.
export const pips = (items: { kind: PipKind; title: string; third?: 1 | 2 }[]): string =>
  `<div class="pipwrap">` +
  `<div class="pipletters" aria-hidden="true">` +
  items.map((p) => `<span>${esc(p.title.slice(0, 1))}</span>`).join("") +
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
