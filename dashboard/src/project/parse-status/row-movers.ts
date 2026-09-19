// The movers: each changes one row's Status cell and answers the whole file,
// or `null` when the row is not there to change. Split from `index.ts`, whose
// row reader they share (code-health line limit).
import { FAILED_MARK, NOT_VERIFIED_MARK, cleanFailNote, isFailedMark, isNotVerifiedMark, type CheckState } from "./not-verified.ts";
import { DONE_MARK, OPEN_MARK, dataRowIndices, isAcceptanceHeading, isDoneMark, phaseSections, tableCells } from "./index.ts";

/** `content` with one row's mark changed to `✅`, or `null` when that
 *  row is not there to change.
 *
 *  The row is named by its phase heading AND its whole line, verbatim —
 *  never by a line number, which shifts the moment a step rewrites the
 *  file around it. `null` covers every way the page can be out of date:
 *  no such phase, no such line inside it, a line that is not a row, and
 *  a row someone has already ticked. Refusing is the point — this is
 *  the row-level guard that sits on top of `saveSpecFile`'s file-level
 *  one, and it is what tells a duplicate press apart from a fresh one
 *  inside a single commit.
 *
 *  Exactly one character moves. The cell keeps its padding, so a tick
 *  never reflows the table. */
export function tickStatusLine(content: string, phase: string, line: string): string | null {
  return setStatusLineMark(content, phase, line, "done");
}

/** `content` with one row's mark changed to `Not verified`, or `null` when
 *  that row is not there or already is. */
export function markNotVerifiedStatusLine(content: string, phase: string, line: string): string | null {
  return setStatusLineMark(content, phase, line, "notVerified");
}

/** `content` with one row's mark put back to `⬜`, or `null` when that
 *  row is not there to change — the exact mirror of `tickStatusLine`,
 *  refusing a row that is not currently done the way that one refuses a
 *  row that already is.
 *
 *  A check can be made by mistake, and until this existed the only way
 *  back was to open `4-status.md` and edit the table by hand. */
export function untickStatusLine(content: string, phase: string, line: string): string | null {
  return setStatusLineMark(content, phase, line, "open");
}

/** `content` with one Not verified Acceptance row marked `Failed`, its Notes
 *  cell rebuilt whole as `Failed: <note>` (never spliced with `String.replace`:
 *  a note may hold `$&`), or `null` when the row is not there, is not Not
 *  verified, or the note is empty once cleaned. */
export function markFailedStatusLine(content: string, phase: string, line: string, note: string): string | null {
  const text = cleanFailNote(note);
  if (!text || !isAcceptanceHeading(phase.trim())) return null;
  return rewriteRow(content, phase, line, (parts, mark) => {
    if (!isNotVerifiedMark(mark)) return false;
    parts[2] = ` ${FAILED_MARK} `;
    parts[3] = ` Failed: ${text} `;
    return true;
  });
}

// A function, not a constant: `index.ts` and this file import each other, and
// `OPEN_MARK` is not initialised yet while this module loads.
const markOf = (target: Exclude<CheckState, "failed">): string =>
  ({ open: OPEN_MARK, notVerified: NOT_VERIFIED_MARK, done: DONE_MARK })[target];
const checkStateOfMark = (mark: string, phase: string): CheckState =>
  isAcceptanceHeading(phase) && isFailedMark(mark)
    ? "failed"
    : isNotVerifiedMark(mark)
      ? "notVerified"
      : isDoneMark(mark)
        ? "done"
        : "open";

/** The one row-finding walk every direction shares: `edit` gets the row's
 *  `|`-split parts and Status cell and says whether it changed the row. A row
 *  the page no longer shows, or one `edit` declines, answers `null`. */
function rewriteRow(
  content: string,
  phase: string,
  line: string,
  edit: (parts: string[], mark: string) => boolean,
): string | null {
  const lines = content.split("\n");
  const section = phaseSections(lines).find((s) => s.heading === phase.trim());
  if (!section) return null;
  for (const i of dataRowIndices(lines, section)) {
    if (lines[i] !== line) continue;
    const cells = tableCells(line);
    const parts = line.split("|");
    if (!cells || !edit(parts, cells[1])) return null;
    lines[i] = parts.join("|");
    return lines.join("\n");
  }
  return null;
}

/** `target` is the state the row is being moved TO; a row already in it is
 *  refused, which is what makes a stale page's press land on nothing rather
 *  than on the wrong row. A Failed row is refused too: it leaves that state
 *  through Reopen. */
function setStatusLineMark(content: string, phase: string, line: string, target: Exclude<CheckState, "failed">) {
  return rewriteRow(content, phase, line, (parts, mark) => {
    const now = checkStateOfMark(mark, phase.trim());
    if (now === target || now === "failed") return false;
    parts[2] = parts[2]!.replace(mark, markOf(target));
    return true;
  });
}
