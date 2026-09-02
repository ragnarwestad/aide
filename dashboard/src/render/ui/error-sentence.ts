// The one shape every error sentence the board shows is built from
// (spec 352): what happened, and what resolves it — a board control
// (REQ-2) or an off-board location (REQ-3) — with raw tool output, if
// any, carried as hover detail rather than the sentence itself (REQ-5).
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
   *  states a fact with no action attached to it (spec 352's own
   *  example: an archived spec's edit refusal). Names the reason, so a
   *  reader — and the registry test — can tell "no resolution needed"
   *  apart from "resolution missing" instead of guessing. */
  exempt?: string;
  /** Raw git/tool output (REQ-5): detail, never the sentence itself. */
  detail?: string;
}

/** Composes `what` and `resolve` into one sentence, joined by an em
 *  dash so a reader sees the two parts as one thought rather than two
 *  unrelated clauses. `detail` becomes the returned `title` — a hover
 *  attribute, never inline text. */
export function errorSentence({ what, resolve, exempt, detail }: ErrorSentence): { text: string; title?: string } {
  if (!resolve && !exempt) throw new Error(`errorSentence: "${what}" has neither resolve nor exempt`);
  return { text: resolve ? `${what} — ${resolve}` : what, title: detail };
}
