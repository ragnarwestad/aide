// The loading element the spec page is sent with before its body is ready
// (spec 515), and the one rule that hides it. The stylesheet is
// css/loading.css. No script is involved: the rule is plain CSS delivered
// after the page's last visible content.

import { MARK } from "./brand.ts";
import { LOADING_CSS } from "./css";
import { esc } from "./html.ts";
import { t, type Language } from "../../i18n";

export { LOADING_CSS };

/** Sent right after `</main>` and before the script tags that follow it: a
 *  `<script src>` blocks the parser until it has downloaded, and the editor
 *  bundle is large, so a rule placed after it would keep the element up
 *  until the bundle had arrived. */
export const LOADING_HIDE_RULE = "<style>.pageloading{display:none}</style>";

/** The element and its stylesheet, as the last thing in the first chunk. */
export function loadingBlock(lang: Language): string {
  return (
    `<style>${LOADING_CSS}</style>\n` +
    `<div class="pageloading" role="status">${MARK}<span>${esc(t(lang, "shell.loadingPage"))}</span></div>`
  );
}
