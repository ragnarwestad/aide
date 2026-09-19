// An archive run that declined, and the acceptance rows that hold one
// back: the note such a run leaves, whether it still means anything,
// and taking it off again once the rows are ticked.
//
// Split out of parse-status.ts 2026-09-04, where it had reached 525
// lines; every function is unchanged and keeps its name. Parsing a
// status file stays there — this is what a caller ASKS about an
// archive, and it needs none of that.

import type { GitRunner } from "../../git/branch-status.ts";
import { acRowsAt, acRowsFromText, criteriaMovedOn } from "../../git/round-boundary.ts";
import { parseStatusChecks, type StatusCheck } from "./";

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

/** The `## Acceptance criteria` rows and nothing else: the rows a person
 *  ticks, drawn by the Specs list's unfold. Each keeps its verbatim line,
 *  which is how the tick route finds it again. */
export function acceptanceRowsOf(content: string): StatusCheck[] {
  return parseStatusChecks(content).filter((c) => /^acceptance\b/i.test(c.phase));
}

/** The one string this reason is always reported as. Shared so
 *  `restingChip()` (job-state/resting.ts) can tell this ordinary,
 *  expected wait apart from the dependency-gated `archiveHeldBack`
 *  case sharing its field — a comparison, not a duplicate literal.
 *  Its words are never shown: every display goes through
 *  `heldBackReasonText`, and old spec files carry this exact text. */
export const ACCEPTANCE_CRITERIA_UNTICKED_NOTE =
  "the Acceptance criteria are not all ticked yet — tick them on the Checks tab";

/** Whether an acceptance row is still open, read across BOTH copies
 *  that can answer: the open branch's (`FileStepsAnswer.acceptanceOpen`,
 *  where the Status tab's tick lands) and the disk's own rows.
 *
 *  The branch answers for both when it has one: it is where the Status
 *  tab's write lands while a branch is open, so it is the newer of the
 *  two by construction, and the disk copy stays as archive last left it
 *  until this branch lands. Disk answers only when the branch has
 *  nothing to say — no open branch, or no answer read yet.
 *
 *  This used to demand that EVERY copy say open, on the reasoning that a
 *  tick only ever ADDS ticks and so a copy reading "all ticked" could
 *  never be the stale one. A check can be taken back off now, and that
 *  reasoning went with it: an untick on the branch, against a disk copy
 *  ticked before the branch existed, read as "all ticked" and let
 *  archive start on a spec the reader had just reopened the question on.
 *
 *  What made the old rule necessary was a stale branch answer outliving
 *  a tick that landed on the default branch (337, 2026-09-04). That is
 *  the tick route's own `forgetBranchFileSteps` now: the cached answer
 *  is dropped in the same request that writes the file, so preferring
 *  the branch cannot serve one from before the write. */
export function acceptanceStillOpen(
  branchOpen: boolean | undefined,
  diskRows: { done: boolean }[] | undefined,
): boolean {
  if (branchOpen !== undefined) return branchOpen;
  // A copy with NO acceptance rows answers nothing rather than "all
  // ticked": a spec whose rows exist only on an unlanded analyze's
  // branch must not have the disk's silence read as agreement.
  return diskRows?.length ? diskRows.some((row) => !row.done) : false;
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
 *  (`heldBackFor` in specs-list/data-model/phases.ts) ask instead of
 *  re-deriving the comparison themselves. */
export function archiveHeldBackApplies(reason: string, doneSteps: string[]): boolean {
  return reason !== ACCEPTANCE_CRITERIA_UNTICKED_NOTE || doneSteps.includes("implement");
}

// --- spec 471: another round on a held-back spec's open checks --------------

/** The commit the LATEST `**Round boundary:**` stamp names — the moment
 *  `aide-archive-spec` most recently declined on unticked acceptance
 *  criteria (`core/scripts/lib/spec-transitions.sh`'s
 *  `write_round_boundary_stamp`) — or `null` when the spec has never
 *  been held back this way. The LAST mark wins, same rule
 *  `archiveHeldBackReason`/`parseReopenedAfter` already keep for a mark
 *  written more than once. */
const ROUND_BOUNDARY_RE = /round boundary:\*\*[^\n]*?history before\s*`([0-9a-fA-F]{7,40})`/gi;

export function latestRoundBoundary(content: string): string | null {
  const matches = [...content.matchAll(ROUND_BOUNDARY_RE)];
  return matches[matches.length - 1]?.[1] ?? null;
}

/** Whether the spec is a reopened one with a round open: the last of its
 *  `**Archived:**`, `**Closed:**`, `**Reopened:**` and `**Reset:**` lines is
 *  an Archived or Closed one, and a `**Round boundary:**` line follows it.
 *  A stamp with a later mark after it is history. */
export function reopenedRound(content: string): boolean {
  let lastStamp = -1;
  let lastMark = -1;
  let boundary = -1;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*[-*]?\s*\*\*(archived|closed):\*\*/i.test(line)) { lastStamp = i; lastMark = i; }
    else if (/^\s*[-*]?\s*\*\*(reopened|reset):\*\*/i.test(line)) lastMark = i;
    else if (/^\s*[-*]?\s*\*\*round boundary:\*\*/i.test(line)) boundary = i;
  }
  return lastStamp >= 0 && lastMark === lastStamp && boundary > lastStamp;
}

const AC_ID_RE = /^(AC-\d+):/;

/** Every `AC-n` id whose own `## Acceptance criteria` row is still
 *  open — read the same way `acceptanceCriteriaUnticked` above reads
 *  the section, narrowed to the ids rather than only whether any exist. */
function openAcceptanceIds(statusText: string): Set<string> {
  const ids = new Set<string>();
  for (const check of parseStatusChecks(statusText)) {
    if (!/^acceptance\b/i.test(check.phase) || check.done) continue;
    const m = check.task.match(AC_ID_RE);
    if (m) ids.add(m[1]!);
  }
  return ids;
}

/** Whether a held-back spec's next Analyze/Implement round may start:
 *  once at least one open criterion is new or reworded since the round
 *  that held it back (`criteriaMovedOn`).
 *
 *  `{ notHeldBack: true }` covers both "not held back on acceptance at
 *  all" and "held back, but never actually declined yet" (no boundary
 *  stamp exists) — in both cases the ordinary already-implemented
 *  refusal (or none, if not yet implemented) applies unchanged, exactly
 *  as it did before this spec existed. An open section with every row
 *  already satisfied (no open ids at all — a transient state between a
 *  tick and the next disk read) never blocks a round either: there is
 *  nothing left to have gone stale. */
export async function roundGate(
  gitRun: GitRunner,
  dir: string,
  statusText: string,
  descriptionText: string,
): Promise<{ ok: true } | { ok: false } | { notHeldBack: true }> {
  const reopened = reopenedRound(statusText);
  if (!acceptanceCriteriaUnticked(statusText) && !reopened) return { notHeldBack: true };
  const boundarySha = latestRoundBoundary(statusText);
  if (!boundarySha) return { notHeldBack: true };
  const openIds = openAcceptanceIds(statusText);
  // A held-back spec with nothing open has nothing left to go stale. A reopened
  // one has nothing open by construction, and must still show a new or
  // changed criterion.
  if (openIds.size === 0 && !reopened) return { ok: true };
  const currentRows = acRowsFromText(descriptionText);
  const boundaryRows = await acRowsAt(gitRun, dir, boundarySha);
  return criteriaMovedOn(currentRows, openIds, boundaryRows) ? { ok: true } : { ok: false };
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
