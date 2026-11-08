import type { BoardMessage } from "../i18n/message.ts";

// The one shape every error sentence the board shows is built from
// what happened, and what resolves it — a board control
// or an off-board location — with raw tool output, if
// any, carried as hover detail rather than the sentence itself.
// The convention is written out in full at `dashboard/docs/error-sentences.md`.

export interface ErrorSentence {
  /** What happened — plain language, never raw tool output. */
  what: string;
  /** What resolves it — a control already on the board, or a location
   *  off it (the checkout on the serving host, a terminal). Required
   *  unless `exempt` is given: a sentence carries one or the other,
   *  never neither. */
  resolve?: string;
  /** Set only when there is genuinely nothing to resolve — the sentence
   *  states a fact with no action attached to it (for
   *  example: an archived spec's edit refusal). Names the reason, so a
   *  reader — and the registry test — can tell "no resolution needed"
   *  apart from "resolution missing" instead of guessing. */
  exempt?: string;
  /** Raw git/tool output: detail, never the sentence itself. */
  detail?: string;
}

/** Composes `what` and `resolve` into one sentence, joined by an em
 *  dash, and hands the two parts back apart as `problem` and `solution`
 *  for a caller that stores or sends them as two lines. `detail` becomes
 *  the returned `title` — a hover attribute, never inline text. */
export function errorSentence({
  what,
  resolve,
  exempt,
  detail,
}: ErrorSentence): {
  problem: string;
  solution?: string;
  text: string;
  title?: string;
} {
  if (!resolve && !exempt)
    throw new Error(`errorSentence: "${what}" has neither resolve nor exempt`);
  return {
    problem: what,
    solution: resolve,
    text: resolve ? `${what} — ${resolve}` : what,
    title: detail,
  };
}

/** A problem and its fix, as the message the board stores and renders as
 *  a Problem line and a Solution line. The blank is always filled: an
 *  empty fix draws the Problem line alone. */
export function writtenMessage(
  problem: string,
  solution?: string,
): BoardMessage {
  return {
    key: "message.written",
    values: { problem, solution: solution ?? "" },
  };
}

/** The finished sentence's own first letter, capitalized — never the
 *  message catalog's (`docs/error-sentences.md`): a catalog entry is
 *  reused both on its own and glued behind a phase name, so only the
 *  fully composed row text is safe to touch here. */
export const capitalizeFirst = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);
