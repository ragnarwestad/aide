// A card of rows: a short heading, then one bordered card holding a row per
// item, the item's name and one line of explanation on the left and its
// value or control on the right. The Projects list and every tab of a
// project's page are drawn with it, so they read as one layout.
//
// A row that opens a page carries its link on its name, stretched over the
// whole row, with a chevron at its end; the controls on such a row rise
// above the stretched link, so a press on one does what the control does.

import { esc } from "../../html.ts";
import { ICON_CHEVRON } from "../icons.ts";

export { initialsHue, projectIcon, projectInitials } from "./project-icon.ts";

export interface CardSectionParts {
  /** The heading over the card, as text. Absent draws no heading line
   *  unless `headTrailing` is given. */
  heading?: string;
  /** Trusted markup at the far end of the heading's line: New. */
  headTrailing?: string;
  /** Trusted markup inside the card: rows, or a section's own content. */
  body: string;
  /** Trusted markup under the card: Save and Cancel. */
  foot?: string;
}

/** A heading and the card under it, and what stands at its foot. */
export function cardSection(o: CardSectionParts): string {
  const head =
    o.heading !== undefined || o.headTrailing
      ? `<div class="cardhead">${o.heading !== undefined ? `<h3>${esc(o.heading)}</h3>` : ""}${o.headTrailing ?? ""}</div>`
      : "";
  return (
    `<section class="cardsection">${head}<div class="card">${o.body}</div>` +
    (o.foot ? `<div class="cardfoot">${o.foot}</div>` : "") +
    `</section>`
  );
}

export interface CardRowParts {
  /** Trusted markup before the text: a project's icon. */
  lead?: string;
  /** The page the row opens, with the name that links to it. The whole row
   *  opens it, and a chevron at the row's end says so. */
  link?: { href: string; text: string };
  /** Trusted markup on the name's line, after the link: the name itself
   *  when the row opens nothing, or what stands beside it (counts). */
  title?: string;
  /** The muted line under the name, as text: a setting's key. */
  sub?: string;
  /** Trusted markup under the name: the explanation, and any message. */
  explain?: string;
  /** Trusted markup on the right: the row's value or its control. */
  control?: string;
  /** Trusted markup at the row's end, before the chevron: a warning mark,
   *  Remove. Each rises above the row's link. */
  trailing?: string;
  /** The row draws as one that went wrong. */
  error?: boolean;
  /** Each key written as `data-<key>="<value>"`. */
  data?: Record<string, string>;
}

/** One row of a card. */
export function cardRow(o: CardRowParts): string {
  const data = Object.entries(o.data ?? {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("");
  const link = o.link ? `<a class="cardrowlink" href="${esc(o.link.href)}">${esc(o.link.text)}</a>` : "";
  return (
    `<div class="${o.error ? "cardrow error" : "cardrow"}"${data}>` +
    (o.lead ?? "") +
    `<div class="cardrowtext"><span class="cardrowtitle">${link}${o.title ?? ""}</span>` +
    (o.sub ? `<span class="muted">${esc(o.sub)}</span>` : "") +
    (o.explain ? `<div class="cardrowexplain">${o.explain}</div>` : "") +
    `</div>` +
    (o.control ? `<div class="cardrowcontrol">${o.control}</div>` : "") +
    (o.trailing ?? "") +
    (o.link ? `<span class="cardchevron">${ICON_CHEVRON}</span>` : "") +
    `</div>`
  );
}
