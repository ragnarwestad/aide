// The Wiki tab's pages: the list, or the one page the address opens. A page is
// drawn the way a locked spec document is — the viewer's mount over the raw
// text — so a reader without script still gets the text.

import { badge, rowMessage, type BadgeVariant } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import type { WikiOpenPage, WikiView } from "../../../project/wiki/types.ts";
import type { WikiPageState } from "../../../project/wiki/state.ts";
import { wikiPagePath } from "../../../project/wiki/parse.ts";
import { viewerPair } from "../spec-page/panels.ts";

type Key = Parameters<typeof t>[1];
const STATE: Record<WikiPageState, { variant: BadgeVariant; key: Key }> = {
  current: { variant: "done", key: "project.wikiStateCurrent" },
  changed: { variant: "waiting", key: "project.wikiStateChanged" },
  unknown: { variant: "idle", key: "project.wikiStateUnknown" },
  "hand-written": { variant: "idle", key: "project.wikiStateHand" },
};

const chip = (state: WikiPageState, lang: Language): string =>
  badge(STATE[state].variant, t(lang, STATE[state].key));

function list(name: string, wiki: WikiView, lang: Language): string {
  const items = wiki.pages
    .map(
      (p) =>
        `<li><a href="${esc(wikiPagePath(name, p.page))}">${esc(p.title)}</a> ${chip(p.state, lang)}` +
        (p.summary ? `<span class="muted">${esc(p.summary)}</span>` : "") +
        `</li>`,
    )
    .join("");
  return `<ul class="wikipages">${items}</ul>`;
}

function openPage(name: string, open: WikiOpenPage, lang: Language): string {
  if ("missing" in open) return rowMessage("failed", t(lang, "project.wikiPageMissing"));
  return (
    `<p><a href="${esc(wikiPagePath(name))}">${esc(t(lang, "project.wikiAllPages"))}</a> ${chip(open.state, lang)}</p>` +
    `<div class="wikidoc">${viewerPair(open.text)}</div>`
  );
}

/** The pages block: an open page in place of the list, or the list. A page the
 *  branch does not have says so above the list. */
export function wikiPages(name: string, wiki: WikiView, lang: Language): string {
  const heading = `<h3>${esc(t(lang, "project.wikiPagesHeading"))}</h3>`;
  if (wiki.open && !("missing" in wiki.open)) return heading + openPage(name, wiki.open, lang);
  return heading + (wiki.open ? openPage(name, wiki.open, lang) : "") + list(name, wiki, lang);
}
