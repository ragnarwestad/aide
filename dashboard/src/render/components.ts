// The six things this dashboard is built from: a button, a status
// badge, a phase chip, a row-level message, a field and a filter pill.
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

// --- the step's name is not the reader's word --------------------------------

/** What a phase is CALLED on the page. The queue step, the skill and
 *  every `data-` attribute keep `review-plan`; a reader is shown
 *  `review`, because the `-plan` half is an implementation detail of
 *  which skill runs. Written once so the row, the phase line, the pips
 *  and the job page cannot drift on it. */
export const STEP_LABELS: Record<string, string> = { "review-plan": "review" };

export const stepLabel = (step: string): string => STEP_LABELS[step] ?? step;

/** The same, for a sentence built from several steps. */

// --- button -------------------------------------------------------------------

/** Bare is secondary — the default, and the one most rows get. */
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

/** A phase, as a control. Five states: the plain box, the ticked box,
 *  a finished phase (checkmark, text dimmed), the phase running right
 *  now (spinner), and one that will not take a click (lock, and the
 *  reason in `title` — the only place the reason fits on a row).
 *
 *  The checkbox is a REAL one, kept visible rather than replaced by a
 *  drawn square: the row is a plain form, and it has to work with
 *  script off and from a keyboard. */
export function phaseChip(o: {
  /** The technical name — the form value and the `data-` attribute. */
  value: string;
  /** What the reader sees. */
  label: string;
  /** The checkbox's field name: `steps` for a phase, `extraProjects`
   *  for a repo the job should also watch. */
  name: string;
  /** `data-phase` for a phase, `data-project` for a repo. */
  dataAttr: string;
  /** The name assistive tech reads, for a box drawn with no visible
   *  label of its own — a phase line's box, whose name is the next
   *  thing on the line rather than inside the label (spec 124). */
  ariaLabel?: string;
  checked?: boolean;
  done?: boolean;
  busy?: boolean;
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
}): string {
  const locked = !!o.disabled && !o.plain;
  const state = o.busy ? "busy" : locked ? "off" : o.done ? "done" : o.checked ? "checked" : "default";
  // `done` is a FACT about the phase, not one of the five looks: a step
  // the spec has already had can also be the step a job is running
  // right now, and a chip that showed only the second lost the first.
  const cls = ["phase", state, o.done && state !== "done" ? "done" : ""].filter(Boolean).join(" ");
  const mark = o.busy ? SPINNER : locked ? `<span class="box">${ICON_LOCK}</span>` : "";
  const tick = o.done ? ` <span class="box" title="already done">${ICON_CHECK}</span>` : "";
  return (
    `<label class="${cls}" ${o.dataAttr}="${esc(o.value)}"` +
    `${o.title ? ` title="${esc(o.title)}"` : ""}>` +
    // `checked` directly after `value`, before the two attributes that
    // are about plumbing rather than state: what a box SAYS is read
    // together, in markup as on the page.
    `<input type="checkbox" name="${o.name}" value="${esc(o.value)}"` +
    `${o.checked ? " checked" : ""}${o.busy || o.disabled ? " disabled" : ""}` +
    `${o.form ? ` form="${esc(o.form)}"` : ""}` +
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

// --- filter pill -------------------------------------------------------------------

export interface FilterPill {
  label: string;
  /** Omitted where a count would say nothing — a tab that is simply
   *  there does not need "· 0" after it. */
  count?: number;
  on: boolean;
  href: string;
}

/** "Label · count", because the count is part of the sentence rather
 *  than a badge sitting on it. The chosen one is marked with
 *  `aria-current` and styled off that — a class saying the same thing
 *  twice is a class that can disagree with itself. */
export function filterPills(
  name: string,
  label: string,
  entries: FilterPill[],
  /** What `aria-current` says for the chosen one. `true` for a filter,
   *  `page` for the job page's tabs, which really are pages. */
  current: "true" | "page" = "true",
): string {
  // A page-level tab bar needs no group caption the way "Job" does for
  // the job page's own tabs — and an empty caption is a real element
  // with real padding, not nothing.
  const caption = label ? `<span class="lbl">${esc(label)}</span>` : "";
  return (
    `<span class="filters" data-filter="${esc(name)}">${caption}` +
    entries
      .map(
        (e) =>
          `<a data-nav href="${e.href}"${e.on ? ` aria-current="${current}"` : ""}>` +
          `${esc(e.label)}${e.count === undefined ? "" : ` · ${e.count}`}</a>`,
      )
      .join("") +
    `</span>`
  );
}

// --- progress pips -------------------------------------------------------------------

/** The whole workflow in six millimetres, on the line you are already
 *  reading. Shared by the list and the job page, which computed the
 *  same three-way answer independently until this existed. */
export type PipKind = "past" | "now" | "todo";

export const pips = (items: { kind: PipKind; title: string }[]): string =>
  `<div class="pips">` +
  items.map((p) => `<span class="pip ${p.kind}" title="${esc(p.title)}"></span>`).join("") +
  `</div>`;
