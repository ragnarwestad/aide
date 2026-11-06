// What resolves a refused request, worded once. Every refusal in
// `parse-request.ts` answers a request the ordinary Run/New-spec form does
// not normally post: most are reachable only from a hand-crafted request, the
// rest from a page left open long enough for its project, spec or model list
// to go stale before the post landed. What resolves either is the same.

import { errorSentence } from "./error-sentence.ts";

export const INVALID_REQUEST_FIX = "Reload the page and try again";
export const FIX_IN_FORM = "Fix it in the New spec form and submit again";

export const invalidRequest = (what: string): string => errorSentence({ what, resolve: INVALID_REQUEST_FIX }).text;

// A field a person actually types into the New-spec form: its resolution
// names the form, not the raw-request wording `invalidRequest()` gives the
// rest — a title over `TITLE_MAX` is a real reader who typed too much.
export const fixInTheForm = (what: string): string => errorSentence({ what, resolve: FIX_IN_FORM }).text;

/** A refusal's text taken apart into the problem and the fix it was built
 *  with. Only the two fixes built here are known; any other text is a
 *  problem alone. */
export function splitFix(text: string): { error: string; solution?: string } {
  for (const fix of [INVALID_REQUEST_FIX, FIX_IN_FORM]) {
    const tail = ` — ${fix}`;
    const at = text.endsWith(tail) ? tail.length : text.endsWith(`${tail}.`) ? tail.length + 1 : 0;
    if (at) return { error: text.slice(0, -at), solution: fix };
  }
  return { error: text };
}
