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

/** The mark a row carries — live or archived — when its code is on a
 *  branch waiting on a pull request (spec 220, spec 335): the same word
 *  either way, since it is the same fact from a reader's chair — code is
 *  on a branch, and a request describes it. */
export const PULL_REQUEST = "pull request";

/** The mark a LIVE row carries when a landing failed and no later step
 *  of the same job has resolved it (spec 327) — independent of
 *  `state`, which a later step's own start already overwrites. */
export const LANDING_FAILED = "landing failed";

/** The mark a LIVE row carries when a step's push never reached origin
 *  (spec 328). */
export const NOT_PUSHED = "not pushed";

/** The mark a LIVE row carries when no pull request could be opened for
 *  its branch (spec 220). The more urgent half of the same answer
 *  `PULL_REQUEST` gives — a branch left open with nothing describing it,
 *  which no amount of waiting resolves. */
export const NO_PULL_REQUEST = "no pull request";

/** How many columns the list has. Two rows span the whole table — the
 *  "no spec matches" line and a row's message panel — and a count
 *  written twice is a count that drifts the next time a column moves. */
export const LIST_COLUMNS = 6;

// --- what every form on this page needs ------------------------------------

/** The current view, sent along with the press. The redirect the server
 *  answers with can only carry forward what the POST itself received,
 *  so the fields have to leave the browser on the same request. */
export const filterFields = (f?: QueueFilter): string =>
  FILTER_KEYS.map((k) => {
    const v = f?.[k];
    return v ? `<input type="hidden" name="${FILTER_FIELD_PREFIX}${k}" value="${esc(v)}">` : "";
  }).join("");
