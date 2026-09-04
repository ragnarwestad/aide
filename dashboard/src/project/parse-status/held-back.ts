// An archive run that declined, and the acceptance rows that hold one
// back: the note such a run leaves, whether it still means anything,
// and taking it off again once the rows are ticked.
//
// Split out of parse-status.ts 2026-09-04, where it had reached 525
// lines; every function is unchanged and keeps its name. Parsing a
// status file stays there — this is what a caller ASKS about an
// archive, and it needs none of that.

import { parseStatusChecks } from "../parse-status.ts";

// --- spec 108: an archive run that declined -----------------------------------

/** Why the last headless archive run did NOT move the folder, or `null`
 *  when nothing is holding it back.
 *
 *  A finished archive JOB says nothing about whether anything was
 *  archived: the runner's `ok` flag is the claude session's own exit
 *  status, and a skill that reads an unfinished `4-status.md` and
 *  declines exits just as successfully as one that moved the folder.
 *  So the skill writes the reason where it can be re-read — a
 *  `## Archive held back` section in the spec's own status file — and
 *  this reads it back. Same technique as `discover.ts`'s
 *  `specDescription` (find the heading, slice to the next heading or
 *  `---`), with `parseStatus`'s calling convention: the content, not a
 *  directory, because the caller already has the file in hand.
 *
 *  The LAST such section wins. A spec declined twice carries its
 *  current reason, not the one an earlier attempt gave. */
const ARCHIVE_HELD_BACK_RE = /^##\s+Archive held back\s*$/gm;
/** The same heading, without `g`, for testing one line at a time. */
const ARCHIVE_HELD_BACK_LINE_RE = /^##\s+Archive held back\s*$/;

/** Where a `## Archive held back` section stops: the next heading, the
 *  next `---`, or the end of the file. One definition, because
 *  `archiveHeldBackReason` and `clearArchiveHeldBack` reading a section
 *  as two different lengths is how a removal would leave half a reason
 *  behind. */
const SECTION_END_RE = /^#{1,6}\s|^---\s*$/m;

export function archiveHeldBackReason(content: string): string | null {
  const matches = [...content.matchAll(ARCHIVE_HELD_BACK_RE)];
  const m = matches[matches.length - 1];
  if (!m || m.index === undefined) return null;
  const body = content.slice(m.index + m[0].length);
  const end = body.search(SECTION_END_RE);
  const section = (end === -1 ? body : body.slice(0, end)).trim();
  return section.split("\n")[0]?.replace(/^[-*]\s*/, "").trim() || null;
}

/** The reason archive keeps refusing while a person has not yet judged
 *  the spec's own `## Acceptance criteria` rows (spec 285's gate).
 *
 *  `aide-run-spec`'s mechanical precheck already refuses cleanly here
 *  (no AI spent, `terminalReason: "acceptance-criteria-unticked"`), but
 *  that reason reaches nothing this page reads — the run emits no
 *  `note` field for it, only a stderr line nobody but a log file sees.
 *  Read from the same file the checklist itself renders from, the way
 *  `archiveHeldBackReason` above already does for the (now largely
 *  retired) dependency case, so a fresh archive attempt refusing again
 *  says why instead of reading as an unexplained no-op. `undefined`,
 *  not `null`, to match `archiveHeldBackReason`'s own call sites, which
 *  already treat that field as "a reason, or nothing to say". */
export function acceptanceCriteriaUnticked(content: string): boolean {
  return parseStatusChecks(content).some((c) => /^acceptance\b/i.test(c.phase) && !c.done);
}

/** The one string this reason is always reported as. Shared so
 *  `restingChip()` (job-state/resting.ts) can tell this ordinary,
 *  expected wait apart from the dependency-gated `archiveHeldBack`
 *  case sharing its field — a comparison, not a duplicate literal. */
export const ACCEPTANCE_CRITERIA_UNTICKED_NOTE =
  "the Acceptance criteria are not all ticked yet — tick them on the Checks tab";

/** Whether an acceptance row is still open, read across BOTH copies
 *  that can answer: the open branch's (`FileStepsAnswer.acceptanceOpen`,
 *  where the Checks tab's tick lands) and the disk's own rows.
 *
 *  A tick only ever ADDS ticks, so a copy that says "all ticked" is
 *  never the stale one — the row is open only while every copy that has
 *  an answer still has an open row. Reading the branch alone said "held
 *  back" over a spec whose rows were ticked on disk moments earlier,
 *  because the branch answer is TTL-cached and the tick had landed on
 *  the default branch (337, 2026-09-04); reading disk alone was the same
 *  bug the other way round (364).
 *
 *  A copy with NO acceptance rows answers nothing rather than "all
 *  ticked": a spec whose rows exist only on an unlanded analyze's
 *  branch must not have the disk's silence read as agreement. */
export function acceptanceStillOpen(
  branchOpen: boolean | undefined,
  diskRows: { done: boolean }[] | undefined,
): boolean {
  const diskOpen = diskRows?.length ? diskRows.some((row) => !row.done) : undefined;
  const answers = [branchOpen, diskOpen].filter((v): v is boolean => v !== undefined);
  return answers.length > 0 && answers.every((open) => open);
}

/** Whether a held-back reason still means anything, given which workflow
 *  steps are actually done.
 *
 *  The acceptance-criteria note above is the one reason that reads
 *  straight off the file's own content, true or false whether archive
 *  was ever attempted — so while implement is still running, the
 *  Acceptance criteria are of course not all ticked yet, and that must
 *  not read as archive being "held back" for something well before
 *  archive is even next (reported live on spec 298, 2026-08-31). Every
 *  other reason comes out of an ACTUAL declined archive run and needs
 *  no such gate: archive cannot have been attempted, let alone
 *  declined, before implement is done.
 *
 *  Owned here, next to the constant it compares against, so callers
 *  (`heldBackFor` in queue-list/data-model/phases.ts) ask instead of
 *  re-deriving the comparison themselves. */
export function archiveHeldBackApplies(reason: string, doneSteps: string[]): boolean {
  return reason !== ACCEPTANCE_CRITERIA_UNTICKED_NOTE || doneSteps.includes("implement");
}

/** Spec 190 — `content` with every `## Archive held back` section
 *  removed, or `null` when there is none to remove.
 *
 *  A hold-back note names one open check and where to close it out.
 *  Ticking that check is what closes it out, so the note has to go in
 *  the same write — a page that goes on saying "held back" after the
 *  reason is gone is worse than one that is merely out of date.
 *
 *  EVERY instance, not the last one: `archiveHeldBackReason` reads the
 *  last section a twice-declined spec carries, so leaving an earlier
 *  one would simply hand the reader a staler reason. The section's own
 *  closing `---` goes with it, or the file collects a divider per
 *  archive run that ever declined. */
export function clearArchiveHeldBack(content: string): string | null {
  const lines = content.split("\n");
  if (!lines.some((line) => ARCHIVE_HELD_BACK_LINE_RE.test(line))) return null;
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!ARCHIVE_HELD_BACK_LINE_RE.test(lines[i]!)) {
      kept.push(lines[i]!);
      continue;
    }
    let end = i + 1;
    while (end < lines.length && !SECTION_END_RE.test(lines[end]!)) end++;
    // The divider that closed the section is the section's, not the
    // next thing's — take it, and the blank line after it, so what
    // follows keeps exactly one separator above it.
    if (end < lines.length && /^---\s*$/.test(lines[end]!)) {
      end++;
      while (end < lines.length && lines[end]!.trim() === "") end++;
    }
    i = end - 1;
  }
  return kept.join("\n");
}
