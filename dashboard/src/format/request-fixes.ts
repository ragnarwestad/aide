// What resolves a refused request, worded once. Every refusal in
// `parse-request.ts` answers a request the ordinary Run/New-spec form does
// not normally post: most are reachable only from a hand-crafted request, the
// rest from a page left open long enough for its project, spec or model list
// to go stale before the post landed. What resolves either is the same.

import { errorSentence } from "./error-sentence.ts";

export const INVALID_REQUEST_FIX = "Reload the page and try again";
export const FIX_IN_FORM = "Fix it in the New spec form and submit again";

export interface RequestRefusal {
  error: string;
  solution?: string;
}

export const requestRefusal = (what: string, solution: string): RequestRefusal => {
  const sentence = errorSentence({ what, resolve: solution });
  return { error: sentence.problem, solution: sentence.solution };
};

export const invalidRequest = (what: string): RequestRefusal => requestRefusal(what, INVALID_REQUEST_FIX);

// A field a person actually types into the New-spec form: its resolution
// names the form, not the raw-request wording `invalidRequest()` gives the
// rest — a title over `TITLE_MAX` is a real reader who typed too much.
export const fixInTheForm = (what: string): RequestRefusal => requestRefusal(what, FIX_IN_FORM);
