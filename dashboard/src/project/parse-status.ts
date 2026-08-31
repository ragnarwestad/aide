// 4-status.md parsing only. The progress line exists in the wild in
// several variants (measured in spec 79's analysis): progress /
// fremgang / framdrift, optional leading "- ", optional backticks,
// optional space before %, of / av, on any line. The phase is the
// first phase section whose task table has unchecked rows; all
// checked means "done".

export interface Progress {
  percent: number;
  done: number;
  total: number;
}

export interface StatusInfo {
  progress: Progress | null;
  phase: string | null;
  /** The `## Acceptance criteria` heading, when it has an open row (spec
   *  299's follow-up). Computed separately from `phase`: those rows are
   *  the spec's own person to judge, never `aide-implement`'s to tick,
   *  so they must not sit behind every ordinary Phase section being
   *  finished first — a run that reports "completed" while leaving one
   *  of its own task rows unticked (a model compliance slip, not
   *  something code can rule out) must not also lock the person out of
   *  the one section that is genuinely theirs. `null` when there is no
   *  such section, or it has nothing open. */
  acceptancePhase: string | null;
  /** Which workflow steps this spec has HAD (spec 139), in workflow
   *  order. Empty when the file says nothing — never a guess. */
  workflowSteps: string[];
  /** The commit the current work round starts AFTER, or absent when no
   *  Reset/Reopened mark exists. A SHA, not a date — the name says what
   *  it is FOR, which
   *  is the boundary every reader of the commit grammar excludes with
   *  `--not`. */
  reopenedAfter?: string;
  /** What each phase actually ran on, from its own `- **Model (<step>):**`
   *  line (spec 217's write side, spec 244's read side) — keyed by step,
   *  absent for a step the file names nothing for. Never a guess: an
   *  archived spec from before spec 217 wrote nothing, and this returns
   *  `{}` for it exactly as `parseWorkflowSteps` returns `[]`. */
  stepModels: Record<string, string>;
  /** Every Tasks-table row `parseStatusChecks` would return for this same
   *  content — exposed so a caller needing both the rows and the phase
   *  (spec 302: `specPageView`'s Checks section) can get both from one
   *  call instead of walking the file's phase sections twice. */
  checks: StatusCheck[];
}

const PROGRESS_RE =
  /(?:progress|fremgang|framdrift):\*\*\s*`?\s*(\d+)\s*%\s*\((\d+)\s+(?:of|av)\s+(\d+)/i;

// --- spec 139: the one record of how far a spec has got ---------------------

// The dashboard used to GUESS which workflow steps a spec had had, from
// three unrelated things: the SIZE of 2-analysis.md, a `## Plan review`
// heading in 3-solution.md, and the percentage in 4-status.md. Each is
// a proxy for the question rather than an answer to it, and on
// 2026-08-20 the first one broke — spec 138's untouched analysis
// template is 693 bytes, so the row read `analyze ✓` before any analyze
// had run and offered a second pass at the plan instead, which then ran
// three times against an empty template.
//
// The steps say so themselves now, on one line of Tracking info:
//
//     - **Workflow steps completed:** create, analyze
//
// Written by the step that completed, read here, and nowhere else. The
// percentage on the line below it keeps its own job: it says how far
// the TDD phases INSIDE implement have got, which is a different
// question from whether implement ran.
const WORKFLOW_STEPS = ["create", "analyze", "implement", "archive"];

const WORKFLOW_RE = /workflow steps completed:\*\*\s*(.*)/i;

// --- where the current work round starts ------------------------------------

// An archived spec whose work has to be done again keeps every commit
// from the earlier round — they happened, and the archive is a record —
// so what changes is not the repository but what counts. The mark is one
// line of Tracking info, beside the `**Archived:**` stamp the spec
// keeps:
//
//     - **Reopened:** 2026-08-23 (history before `1d0fe79` does not count)
//
// It lives in the FILES rather than in the queue for the reason
// `1-description.md` gives: the queue holds two hundred jobs on one
// machine and forgets older ones, while the files travel with the
// repository and are what a reader opens.
//
// The SHA is what is captured, and a line without one is not a boundary.
// An unreadable mark says nothing, which is the pre-reopen behaviour; a
// guessed one would hide a round that really did run — the same
// direction every other unknown in this codebase takes.
//
// Reset uses the same durable grammar without moving an active folder.
// `core/scripts/aide-run-spec` keeps the bash twin of this rule in
// `work_round_boundary_in`.
const WORK_ROUND_RE = /(?:reopened|reset):\*\*[^\n]*?history before\s*`([0-9a-fA-F]{7,40})`/gi;

export function parseStatus(content: string): StatusInfo {
  const m = content.match(PROGRESS_RE);
  const progress: Progress | null = m
    ? { percent: Number(m[1]), done: Number(m[2]), total: Number(m[3]) }
    : null;

  // Spec 190: the open rows come from `parseStatusChecks`, not from a
  // substring search for `⬜`/`🔄` in the section's raw text. Two
  // implementations of "is this row done" is how a step that wrote
  // `Waiting` into a Status cell made a whole file read as `done` — the
  // row parser saw nothing it recognised, the symbol search found no
  // symbol, and the Edit page rendered without a single box. One
  // question, one answer, one place.
  const checks = parseStatusChecks(content);
  let phase: string | null = null;
  let sawPhaseSection = false;
  for (const section of content.split(/^## /m).slice(1)) {
    const heading = section.split("\n", 1)[0].trim();
    if (!PHASE_HEADING_RE.test(heading)) continue;
    sawPhaseSection = true;
    if (checks.some((check) => check.phase === heading && !check.done)) {
      phase = heading;
      break;
    }
  }
  if (sawPhaseSection && phase === null) phase = "done";

  // Independent of `phase` above (spec 299's follow-up): these rows are
  // never `phase`'s own to gate behind — see the field's own doc comment.
  const acceptanceCheck = checks.find((check) => /^acceptance\b/i.test(check.phase) && !check.done);
  const acceptancePhase = acceptanceCheck?.phase ?? null;

  return {
    progress,
    phase,
    acceptancePhase,
    checks,
    workflowSteps: parseWorkflowSteps(content),
    reopenedAfter: parseReopenedAfter(content) ?? undefined,
    stepModels: parseStepModels(content),
  };
}

const MODEL_LINE_RE = /^- \*\*Model \(([a-z][a-z-]*)\):\*\*[ \t]*(.*)$/gm;

/** The model each recorded step actually ran on (spec 244) — the same
 *  informal reading `parseWorkflowSteps` already gives the sibling line
 *  beside this one. Unknown step names (a retired step such as
 *  `review-plan`) are dropped, matching that function's own rule: "a
 *  typo must not become a phase." An empty value after the colon is
 *  dropped too, the same care `parsePhaseOutcome`'s own cost/time
 *  regexes take with an empty bullet. The LAST line for a given step
 *  wins, though the writer never emits more than one. */
function parseStepModels(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of content.matchAll(MODEL_LINE_RE)) {
    const step = m[1]!;
    const value = m[2]!.trim();
    if (!WORKFLOW_STEPS.includes(step) || !value) continue;
    result[step] = value;
  }
  return result;
}

/** The commit the current work round starts after, or null.
 *
 *  The LAST mark wins: a spec reopened twice counts from its current
 *  round, not from the first one — the same rule
 *  `archiveHeldBackReason` keeps for a spec declined twice. */
function parseReopenedAfter(content: string): string | null {
  const matches = [...content.matchAll(WORK_ROUND_RE)];
  return matches[matches.length - 1]?.[1] ?? null;
}

/** The recorded steps, in WORKFLOW order rather than the order the line
 *  happens to list them: the readers ask "what is next", and a list
 *  sorted by the workflow answers that whatever a writer did to the
 *  line. Anything not a known step is dropped rather than passed on —
 *  a typo must not become a phase — and a repeat is one step, not two.
 *
 *  A missing line means an empty list, and that is the whole fallback.
 *  The heuristics it replaced are deliberately not kept as a backstop:
 *  a spec predating the field reads as unfinished, which is visible and
 *  fixed by running the step, where a silent guess is neither. */
function parseWorkflowSteps(content: string): string[] {
  const m = content.match(WORKFLOW_RE);
  if (!m) return [];
  const named = new Set(
    m[1]
      .split(",")
      .map((value) => value.trim().replace(/`/g, "").toLowerCase())
      .filter(Boolean),
  );
  return WORKFLOW_STEPS.filter((step) => named.has(step));
}

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

// --- spec 182: the rows a person can tick off from the page -------------------

/** One `| Task | Status | Notes |` row of a `## Phase`/`## Fase`/`##
 *  Checklist` section, which is what a "checkbox" is in a
 *  `4-status.md`. No spec has ever held a `- [ ]` line: the table is
 *  what the template has written since it was written, and the Status
 *  cell's mark is the one character that says whether the row is
 *  done. */
export interface StatusCheck {
  /** The phase section's heading, verbatim. Two phases can hold rows
   *  with identical text, so this is half of a row's identity. */
  phase: string;
  /** The row's whole line, verbatim. The other half of its identity,
   *  and the guard a tick posts back: a row that no longer reads as it
   *  did is a row the page was not looking at. */
  line: string;
  /** The Task cell, trimmed — what a reader is being asked about. */
  task: string;
  done: boolean;
}

const DONE_MARK = "✅";

/** A `## Phase`/`## Fase` heading, or the `## Checklist` heading a
 *  LOW-complexity spec's status file uses instead (spec 266) — matching
 *  core/scripts/aide-archive-spec's own `[Pp]hase*|[Ff]ase*|[Cc]hecklist*`
 *  heading test exactly, so the two agree about what a phase is. One
 *  constant, read by both `parseStatus` and `phaseSections` below, so
 *  the two call sites cannot drift from each other again. */
const PHASE_HEADING_RE = /^(phase|fase|checklist|acceptance)\b/i;

/** The longest meaning the template's own Notation table gives a symbol
 *  is `Awaiting clarification`, at 22 characters; 30 leaves room for a
 *  wording nobody has written yet. Past that a Status cell is not a
 *  status — it is commentary, and commentary is skipped. */
const MAX_MARK_LENGTH = 30;

/** Whether a Status cell says the row is done.
 *
 *  `✅` or the word the Notation table itself gives for it — not an
 *  invented synonym list, the file's own vocabulary. Everything else is
 *  open, which is the safe default: an unrecognised cell keeps the row
 *  on the list rather than quietly reporting a spec finished.
 *
 *  One predicate, asked by `parseStatusChecks`, `tickStatusLine` and
 *  (through the first of those) `parseStatus`. Spec 190: three separate
 *  string comparisons answering this same question is exactly how a fix
 *  in one of them stayed invisible to the other two.
 *
 *  A second implementation of this same rule exists in bash, in
 *  `core/scripts/aide-run-spec`'s `total_progress_for` — the bash
 *  implementation that used to live in `core/scripts/aide-archive-spec`
 *  (`is_done_mark`/`is_unstarted_mark`/`table_row`) was removed by spec
 *  268, which stopped that script reading a Phase table at all. No
 *  shared source between the two languages; change one and check the
 *  other.
 *
 *  Spec 283: an anchored `✅ completed` (symbol and the word combined
 *  in one cell) counts as done too, alongside the bare symbol and the
 *  bare word — a step wrote both into the same cell, and neither of
 *  the two original forms alone matched it. */
function isDoneMark(mark: string): boolean {
  const trimmed = mark.trim();
  return trimmed === DONE_MARK || /^(?:✅\s*)?completed$/i.test(trimmed);
}

function splitRowCells(line: string): [string, string, string] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const parts = trimmed.split("|");
  if (parts.length !== 5) return null;
  return [parts[1]!.trim(), parts[2]!.trim(), parts[3]!.trim()];
}

/** A well-formed three-column row's cells, or `null`.
 *
 *  Conservative on purpose (spec 182's risk analysis): anything that is
 *  not plainly one row of one three-column table is skipped rather than
 *  guessed at, so a hand-formatted file loses a row from the list
 *  instead of offering a tick that would land on the wrong line. The
 *  Status cell has to look like a MARK — short, no comma — which keeps
 *  a separator row and free commentary out. The marks themselves are
 *  never enumerated: `isDoneMark` says what done is and everything else
 *  is open, so a symbol added to the file's own Notation legend needs
 *  no change here.
 *
 *  The header row is NOT excluded here (spec 299): since spec 190 a
 *  mark can be a WORD, so a header using non-standard column names
 *  (e.g. `REQ | Criterion | Done`) reads no differently from a real
 *  row at this level. `dataRowIndices` below excludes it instead, by
 *  the structural fact both this function and `isSeparatorRow` already
 *  agree the separator row is exempt from: the header is whichever row
 *  sits directly above the separator. */
function tableCells(line: string): [string, string, string] | null {
  const cells = splitRowCells(line);
  if (!cells) return null;
  const [task, mark] = cells;
  if (!task || /^-+$/.test(task)) return null;
  if (!mark || mark.length > MAX_MARK_LENGTH || mark.includes(",")) return null;
  return cells;
}

/** Whether `line` is a table's `|---|---|---|` separator row. */
function isSeparatorRow(line: string): boolean {
  const cells = splitRowCells(line);
  return cells !== null && /^-+$/.test(cells[0]);
}

/** Every table-row-shaped line index in `section`, with the section's
 *  own header row — the one immediately followed by the separator row —
 *  already excluded. Shared by `parseStatusChecks` and `tickStatusLine`
 *  so neither can drift from what "a task row" means. */
function dataRowIndices(lines: string[], section: { from: number; to: number }): number[] {
  const result: number[] = [];
  for (let i = section.from; i < section.to; i++) {
    if (!tableCells(lines[i]!)) continue;
    if (i + 1 < section.to && isSeparatorRow(lines[i + 1]!)) continue;
    result.push(i);
  }
  return result;
}

/** Every phase section, as line-index ranges over `lines`. The heading
 *  test is `PHASE_HEADING_RE`, the same constant `parseStatus` reads,
 *  so the two agree about what a phase is. */
function phaseSections(lines: string[]): { heading: string; from: number; to: number }[] {
  const sections: { heading: string; from: number; to: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("## ")) continue;
    const last = sections[sections.length - 1];
    if (last && last.to === -1) last.to = i;
    const heading = line.slice(3).trim();
    if (PHASE_HEADING_RE.test(heading)) sections.push({ heading, from: i + 1, to: -1 });
  }
  const last = sections[sections.length - 1];
  if (last && last.to === -1) last.to = lines.length;
  return sections;
}

/** Every Tasks-table row of every phase section, in file order — done
 *  and not. The page shows both: the description asks for the whole
 *  list with the undone ones unmistakable, not for the undone ones
 *  alone. */
export function parseStatusChecks(content: string): StatusCheck[] {
  const lines = content.split("\n");
  const checks: StatusCheck[] = [];
  for (const section of phaseSections(lines)) {
    for (const i of dataRowIndices(lines, section)) {
      const cells = tableCells(lines[i]!)!;
      checks.push({ phase: section.heading, line: lines[i]!, task: cells[0], done: isDoneMark(cells[1]) });
    }
  }
  return checks;
}

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
  const lines = content.split("\n");
  const section = phaseSections(lines).find((s) => s.heading === phase.trim());
  if (!section) return null;
  for (const i of dataRowIndices(lines, section)) {
    if (lines[i] !== line) continue;
    const cells = tableCells(line);
    if (!cells || isDoneMark(cells[1])) return null;
    const parts = line.split("|");
    parts[2] = parts[2]!.replace(cells[1], DONE_MARK);
    lines[i] = parts.join("|");
    return lines.join("\n");
  }
  return null;
}
