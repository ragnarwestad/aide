// The row-level message, and the slot the page's script writes one into.
// `index.ts` re-exports every name here; the pages import it from there.

import { esc } from "../html.ts";
import { capitalizeFirst } from "../../../format/error-sentence.ts";
import { ICON_WARN } from "./icons.ts";

// --- row-level message ----------------------------------------------------------

/** The three kinds a row, job-page or project-page message can be — and
 *  the only three. A call site picks the KIND; the colour and the icon
 *  are decided here, once, from it — never guessed from the text. */
export type MessageVariant = "info" | "waiting" | "failed";

/** The mark on an info message — a fact, nothing to do. Distinct from
 *  the warning triangle: a reader who cannot tell red from amber must
 *  still be able to tell "nothing to do" from "something waits". */
export const ICON_INFO =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" aria-hidden="true">` +
  `<circle cx="8" cy="8" r="6.5"></circle><path d="M8 7v4M8 5h.01"></path></svg>`;

/** The mark on a failed message — a step, a landing or a request
 *  failed and a person has to act. Distinct from the warning triangle
 *  `waiting` keeps: a filled cross in a circle, not a triangle, so the
 *  two never rely on colour alone to tell apart. */
export const ICON_FAILED =
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" aria-hidden="true">` +
  `<circle cx="8" cy="8" r="6.5"></circle><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"></path></svg>`;

const MESSAGE_ICON: Record<MessageVariant, string> = {
  info: ICON_INFO,
  waiting: ICON_WARN,
  failed: ICON_FAILED,
};

/** Why the button you just pressed did nothing, on the row you pressed
 *  it on. `hook` is the class `specs-client.ts` selects on — it carries
 *  no styling of its own, and renaming one silently breaks the browser
 *  code with no type error to catch it. */
export function rowMessage(
  variant: MessageVariant,
  text: string,
  o: { hook?: string; tag?: "div" | "p"; actions?: string; html?: string } = {},
): string {
  const tag = o.tag ?? "div";
  const cls = [o.hook, "rowmsg", variant].filter(Boolean).join(" ");
  // `actions` is markup drawn inside the box after the text: controls
  // the message offers (a link to try again, a form that dismisses it).
  return `<${tag} class="${cls}">${MESSAGE_ICON[variant]}<span>${o.html ?? esc(capitalizeFirst(text))}</span>${o.actions ?? ""}</${tag}>`;
}

/** One sentence of a row's message, and how it is drawn. `own` stands it
 *  on a box of its own; `lead` is a control drawn inside that box before
 *  its icon, and `after` is content drawn directly under it. */
export interface MessagePart {
  text: string;
  href?: string;
  variant?: MessageVariant;
  own?: boolean;
  lead?: string;
  after?: string;
}

/** `rowMessage()` for more than one ranked part, each keeping its own
 *  link (REQ-2, spec 403) rather than flattening to one string first —
 *  a link lives inside a part's own sentence, so it survives being
 *  joined with another part's sentence on the same line, unlike `title`
 *  (notice.ts), which cannot be attributed once more than one part
 *  joins and is dropped instead.
 *
 *  Every link opens in a new tab (spec 411): what it points to — a pull
 *  request, a board this row's own link just started — is somewhere
 *  else, and a reader who follows one wants the row still open behind
 *  it. */
export function rowMessageParts(
  variant: MessageVariant,
  parts: MessagePart[],
  o: { hook?: string; tag?: "div" | "p" } = {},
): string {
  const tag = o.tag ?? "div";
  const link = (p: MessagePart): string =>
    p.href
      ? `<a href="${esc(p.href)}" target="_blank" rel="noopener">${esc(capitalizeFirst(p.text))}</a>`
      : esc(capitalizeFirst(p.text));
  // What a part unfolds (`after`) goes INSIDE its own box, under the
  // words: the message grows to hold it, rather than the unfolded list
  // hanging below a box it belongs to (2026-09-25).
  const box = (v: MessageVariant, body: string, lead = "", hook = o.hook, after = ""): string =>
    `<${tag} class="${[hook, "rowmsg", v].filter(Boolean).join(" ")}">${lead}${MESSAGE_ICON[v]}<span>${body}</span>${after}</${tag}>`;
  if (!parts.some((p) => p.own)) return box(variant, parts.map(link).join(" · "));
  // A part that asks for a line of its own is its own box; the parts
  // between two of them still join with " · " into one, as they always did.
  const boxes: string[] = [];
  let joined: MessagePart[] = [];
  const flush = (): void => {
    if (joined.length) boxes.push(box(joined[0]!.variant ?? variant, joined.map(link).join(" · "), "", boxes.length ? undefined : o.hook));
    joined = [];
  };
  for (const p of parts) {
    if (!p.own) {
      joined.push(p);
      continue;
    }
    flush();
    boxes.push(box(p.variant ?? variant, link(p), p.lead, boxes.length ? undefined : o.hook, p.after ?? ""));
  }
  flush();
  return `<div class="msgstack">${boxes.join("")}</div>`;
}

/** The line a refusal or a notice is WRITTEN into by the page's script,
 *  drawn whether or not it has words yet: the kind's icon and a `<span>`
 *  for the words, which is all the script writes (`writeLine()`,
 *  `specs-client/press.ts`), so a line it fills carries the same icon as
 *  one the server filled. `text` is what it starts with — a refusal the
 *  server redirected back with, for a page with no script. A line with
 *  no words takes no room and shows nothing (`row-message.css`), but
 *  stays where a screen reader hears it fill. */
export const messageSlot = (hook: string, variant: MessageVariant = "failed", o: { text?: string } = {}): string =>
  `<p class="${hook} rowmsg ${variant}" aria-live="polite">` +
  `${MESSAGE_ICON[variant]}<span>${o.text ? esc(capitalizeFirst(o.text)) : ""}</span></p>`;
