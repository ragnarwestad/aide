// The small pieces every other file in this split reaches for: the
// three marks a row can carry, the column count, and the hidden fields
// every form on this page repeats.

import { esc } from "../../ui/html.ts";
import { t, type Language } from "../../../i18n";
import { specPagePath } from "../spec-page";
import { CLOSED_STATE, FILTER_FIELD_PREFIX, FILTER_KEYS, isArchivedRow, type SpecGroup, type SpecsFilter } from "./data-model";

/** What the date cell says when the spec carries no stamp and git
 *  cannot date its folder either — a folder copied in rather than
 *  committed. Spelled out here so the row and its test cannot word the
 *  same absence differently. */
export const NO_DATE = (lang: Language): string => t(lang, "list.dateUnknown");

/** The mark a row carries — live or archived — when its code is on a
 *  branch waiting on a pull request (spec 220, spec 335): the same word
 *  either way, since it is the same fact from a reader's chair — code is
 *  on a branch, and a request describes it. */
export const PULL_REQUEST = (lang: Language): string => t(lang, "list.pullRequest");

/** The mark a LIVE row carries when its archive step is held back
 *  specifically for unticked acceptance criteria (spec 411) — the same
 *  fact `resting.ts` already reads to draw the "ready" badge for this
 *  exact state, given the same sentence-plus-link shape `PULL_REQUEST`
 *  already has. */
export const TEST_SERVER = (lang: Language): string => t(lang, "list.testServer");

/** The mark a LIVE row carries when a landing failed and no later step
 *  of the same job has resolved it (spec 327) — independent of
 *  `state`, which a later step's own start already overwrites. */
export const LANDING_FAILED = (lang: Language): string => t(lang, "list.landingFailed");

/** The same mark when the landing's own test run is what refused it: the
 *  merge was built and the project's suite went red on it, so nothing
 *  was pushed and implement runs again. Amber, not red. */
export const TESTS_RED = (lang: Language): string => t(lang, "list.testsRed");

/** The mark a LIVE row carries when a step's push never reached origin
 *  (spec 328). */
export const NOT_PUSHED = (lang: Language): string => t(lang, "list.notPushed");

/** The mark a LIVE row carries when no pull request could be opened for
 *  its branch (spec 220). The more urgent half of the same answer
 *  `PULL_REQUEST` gives — a branch left open with nothing describing it,
 *  which no amount of waiting resolves. */
export const NO_PULL_REQUEST = (lang: Language): string => t(lang, "list.noPullRequest");

/** Whether the row draws the info line with its ›, which says the same
 *  counts `notVerifiedMark` does — so the count is said on one of the two,
 *  never both and never neither. */
export const drawsChecksLine = (g: SpecGroup): boolean =>
  isArchivedRow(g) &&
  g.state !== CLOSED_STATE &&
  (g.acceptance ?? []).length > 0 &&
  (g.notVerified ?? 0) + (g.failed ?? 0) > 0;

/** The small line under a row's name: how many of the spec's Acceptance
 *  rows wait for a check after deploy, linking to the Status tab where
 *  they are ticked or un-marked. Nothing for a count of 0, a closed
 *  spec, or a row whose info line says the count instead. */
export const notVerifiedMark = (g: SpecGroup, lang: Language): string => {
  const parts: string[] = [];
  if ((g.notVerified ?? 0) > 0) parts.push(t(lang, "list.notVerifiedMark", { n: g.notVerified! }));
  if ((g.failed ?? 0) > 0) parts.push(t(lang, "list.failedMark", { n: g.failed! }));
  return parts.length > 0 && g.state !== CLOSED_STATE && !drawsChecksLine(g)
    ? `<div class="spec-notverified"><a data-goto href="${esc(specPagePath(g.project, g.specFolder))}?tab=status">` +
        `${esc(parts.join(" · "))}</a></div>`
    : "";
};

/** How many columns the list has. Two rows span the whole table — the
 *  "no spec matches" line and a row's message panel — and a count
 *  written twice is a count that drifts the next time a column moves. */
export const LIST_COLUMNS = 6;

// --- what every form on this page needs ------------------------------------

/** The current view, sent along with the press. The redirect the server
 *  answers with can only carry forward what the POST itself received,
 *  so the fields have to leave the browser on the same request. */
export const filterFields = (f?: SpecsFilter): string =>
  FILTER_KEYS.map((k) => {
    const v = f?.[k];
    return v ? `<input type="hidden" name="${FILTER_FIELD_PREFIX}${k}" value="${esc(v)}">` : "";
  }).join("");
