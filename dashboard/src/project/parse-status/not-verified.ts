// The third mark an Acceptance row can carry: `Not verified` — a check that
// has to wait for something that only exists after a deploy. It counts as
// DONE for every gate (`isDoneMark`), and a separate flag says the row is
// still unchecked, so what draws a row, ticks it or lists it can tell it
// from a row somebody ticked. The bash side keeps the same rule by hand in
// `core/scripts/lib/status-progress.sh` and `spec-state.sh`.

/** The Status cell's word for it. */
export const NOT_VERIFIED_MARK = "Not verified";

/** Whether a Status cell is the Not verified mark: the word alone, in any case. */
export function isNotVerifiedMark(mark: string): boolean {
  return mark.trim().toLowerCase() === NOT_VERIFIED_MARK.toLowerCase();
}

/** The Status cell's word for a check that was made after the deploy and did
 *  not hold. Not a done mark: the row stays open, and is flagged. */
export const FAILED_MARK = "❌ Failed";

/** Whether a Status cell is the Failed mark: the word, with or without the
 *  symbol before it, in any case. A bare `❌` is Blocked and is not this. */
export function isFailedMark(mark: string): boolean {
  return /^(?:\S+\s+)?failed$/i.test(mark.trim());
}

/** The states a row's Status cell can move between. */
export type CheckState = "open" | "notVerified" | "done" | "failed";

/** A row's state from what it carries: the flag wins over `done`, because a
 *  Not verified row is done AND flagged. */
export function checkStateOf(row: { done: boolean; notVerified?: boolean; failed?: boolean }): CheckState {
  return row.failed ? "failed" : row.notVerified ? "notVerified" : row.done ? "done" : "open";
}

/** How many of `rows` are flagged Failed. */
export function failedCount(rows: { failed?: boolean }[]): number {
  let n = 0;
  for (const row of rows) if (row.failed) n++;
  return n;
}

/** A typed note made fit for one Notes cell: newlines become spaces, `|`
 *  becomes `/`, the ends are trimmed. `""` when nothing is left. */
export function cleanFailNote(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").replace(/\|/g, "/").trim();
}

/** How many of `rows` are flagged Not verified. */
export function notVerifiedCount(rows: { notVerified?: boolean }[]): number {
  let n = 0;
  for (const row of rows) if (row.notVerified) n++;
  return n;
}
