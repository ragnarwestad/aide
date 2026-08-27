// The small pieces every other file in this split reaches for: the
// three marks a row can carry, the column count, and the hidden fields
// every form on this page repeats.

import { esc } from "../../ui/html.ts";
import { FILTER_FIELD_PREFIX, FILTER_KEYS, type QueueFilter } from "./data-model.ts";

/** What the date cell says when the spec carries no stamp and git
 *  cannot date its folder either — a folder copied in rather than
 *  committed. Spelled out here so the row and its test cannot word the
 *  same absence differently. */
export const NO_DATE = "date unknown";

/** The mark an archived row carries when its branch is still open.
 *  Drawn with the same `refused` badge a failed row gets — one archive
 *  is not a different kind of problem from the other. */
export const NOT_LANDED = "not landed";

/** The mark an archived row carries instead, when its branch is open
 *  BECAUSE THE PROJECT ASKED FOR THAT (spec 220): `codeLanding: pr` in
 *  its manifest, so the code waits on a pull request for as long as the
 *  review takes. Same fact from origin — the branch is there — and the
 *  opposite meaning, which is the whole reason it is worded apart:
 *  `NOT_LANDED` reads as an instruction to run archive again, and this
 *  one is an instruction to go and review something. */
export const PR_OPEN = "PR open";

/** How many columns the list has. Two rows span the whole table — the
 *  "no spec matches" line and a row's message panel — and a count
 *  written twice is a count that drifts the next time a column moves. */
export const LIST_COLUMNS = 5;

// --- what every form on this page needs ------------------------------------

/** The current view, sent along with the press. The redirect the server
 *  answers with can only carry forward what the POST itself received,
 *  so the fields have to leave the browser on the same request. */
export const filterFields = (f?: QueueFilter): string =>
  FILTER_KEYS.map((k) => {
    const v = f?.[k];
    return v ? `<input type="hidden" name="${FILTER_FIELD_PREFIX}${k}" value="${esc(v)}">` : "";
  }).join("");
