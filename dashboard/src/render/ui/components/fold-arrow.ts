// The arrow that folds a row, a phase line or a step open and shut.
// `index.ts` re-exports every name here; the pages import it from there.

import { esc } from "../html.ts";
import { t, type Language, type TranslationKey } from "../../../i18n";
import { ICON_CHEVRON } from "./icons.ts";
import { dataAttrs } from "./button.ts";

/** The five sentences a fold arrow says, each with `{action}` for the
 *  show/hide word. A key, never a sentence: a caller cannot hand the arrow
 *  words in one language only. */
export type FoldTitle = Extract<
  TranslationKey,
  "list.foldTitle" | "list.checksFoldTitle" | "list.phaseFoldTitle" | "job.stepFoldTitle" | "jobs.foldTitle"
>;

// A LINK, not a button, with the state in the address: it works with script
// off, `navigation.ts` intercepts `a[data-nav]` so a click on the list
// neither reloads the page nor wipes a half-filled form, and the choice
// survives the page redrawing itself. The arrow is the whole content, so
// nothing in the address is ever shown as text.
export function foldArrow(o: {
  /** Where a click goes, unescaped: the same view with this fold flipped. */
  href: string;
  open: boolean;
  lang: Language;
  title: FoldTitle;
  /** The sentence's other placeholders, beside `{action}`. */
  params?: Record<string, string>;
  /** Each key written as `data-<key>`: the hooks the list's script reads
   *  (`data-fold`, `data-key`). */
  data?: Record<string, string>;
}): string {
  const action = t(o.lang, o.open ? "list.foldHide" : "list.foldShow");
  const title = t(o.lang, o.title, { ...o.params, action });
  return (
    `<a class="fold${o.open ? "" : " shut"}" data-nav${dataAttrs(o.data)} href="${esc(o.href)}" ` +
    `aria-expanded="${o.open ? "true" : "false"}" title="${esc(title)}">${ICON_CHEVRON}</a>`
  );
}

/** A fold that opens and shuts in the browser itself: a `<details>` whose
 *  `<summary>` is the chevron and `summary`, holding `body`. For a fold
 *  inside a row, where a click must not load the page or ask the server.
 *  `summary` and `body` are trusted markup; the caller escapes what it
 *  hands in. */
export function foldDisclosure(o: { summary: string; body: string; data?: Record<string, string> }): string {
  return `<details class="foldbox"${dataAttrs(o.data)}><summary>${ICON_CHEVRON}${o.summary}</summary>${o.body}</details>`;
}
