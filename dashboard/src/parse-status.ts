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
  /** Which workflow steps this spec has HAD (spec 139), in workflow
   *  order. Empty when the file says nothing — never a guess. */
  workflowSteps: string[];
}

const PROGRESS_RE =
  /(?:progress|fremgang|framdrift):\*\*\s*`?\s*(\d+)\s*%\s*\((\d+)\s+(?:of|av)\s+(\d+)/i;

const OPEN_MARKS = ["⬜", "🔄"];

// --- spec 139: the one record of how far a spec has got ---------------------

// The dashboard used to GUESS which workflow steps a spec had had, from
// three unrelated things: the SIZE of 2-analysis.md, a `## Plan review`
// heading in 3-solution.md, and the percentage in 4-status.md. Each is
// a proxy for the question rather than an answer to it, and on
// 2026-08-20 the first one broke — spec 138's untouched analysis
// template is 693 bytes, so the row read `analyze ✓` before any analyze
// had run and offered review-plan instead. Review-plan then ran three
// times against an empty template.
//
// The steps say so themselves now, on one line of Tracking info:
//
//     - **Workflow steps completed:** create, analyze, review-plan
//
// Written by the step that completed, read here, and nowhere else. The
// percentage on the line below it keeps its own job: it says how far
// the TDD phases INSIDE implement have got, which is a different
// question from whether implement ran.
const WORKFLOW_STEPS = ["create", "analyze", "review-plan", "implement", "archive"];

const WORKFLOW_RE = /workflow steps completed:\*\*\s*(.*)/i;

export function parseStatus(content: string): StatusInfo {
  const m = content.match(PROGRESS_RE);
  const progress: Progress | null = m
    ? { percent: Number(m[1]), done: Number(m[2]), total: Number(m[3]) }
    : null;

  let phase: string | null = null;
  let sawPhaseSection = false;
  for (const section of content.split(/^## /m).slice(1)) {
    const heading = section.split("\n", 1)[0].trim();
    if (!/^(phase|fase)\b/i.test(heading)) continue;
    sawPhaseSection = true;
    if (OPEN_MARKS.some((mark) => section.includes(mark))) {
      phase = heading;
      break;
    }
  }
  if (sawPhaseSection && phase === null) phase = "done";

  return { progress, phase, workflowSteps: parseWorkflowSteps(content) };
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

export function archiveHeldBackReason(content: string): string | null {
  const matches = [...content.matchAll(ARCHIVE_HELD_BACK_RE)];
  const m = matches[matches.length - 1];
  if (!m || m.index === undefined) return null;
  const body = content.slice(m.index + m[0].length);
  const end = body.search(/^#{1,6}\s|^---\s*$/m);
  const section = (end === -1 ? body : body.slice(0, end)).trim();
  return section.split("\n")[0]?.replace(/^[-*]\s*/, "").trim() || null;
}

// --- spec 182: the rows a person can tick off from the page -------------------

/** One `| Task | Status | Notes |` row of a `## Phase`/`## Fase`
 *  section, which is what a "checkbox" is in a `4-status.md`. No spec
 *  has ever held a `- [ ]` line: the table is what the template has
 *  written since it was written, and the Status cell's mark is the one
 *  character that says whether the row is done. */
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

/** A well-formed three-column row's cells, or `null`.
 *
 *  Conservative on purpose (spec 182's risk analysis): anything that is
 *  not plainly one row of one three-column table is skipped rather than
 *  guessed at, so a hand-formatted file loses a row from the list
 *  instead of offering a tick that would land on the wrong line. The
 *  Status cell has to look like a MARK — one short token, no spaces —
 *  which is what keeps a header row (`| Task | Status | Notes |`) and a
 *  separator out without naming either. The marks themselves are never
 *  enumerated: "done" is `✅` and everything else is open, so a symbol
 *  added to the file's own Notation legend needs no change here. */
function tableCells(line: string): [string, string, string] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const parts = trimmed.split("|");
  if (parts.length !== 5) return null;
  const [task, mark, notes] = [parts[1]!.trim(), parts[2]!.trim(), parts[3]!.trim()];
  if (!task || /^-+$/.test(task)) return null;
  if (!mark || /\s/.test(mark) || mark.length > 4) return null;
  return [task, mark, notes];
}

/** Every phase section, as line-index ranges over `lines`. The heading
 *  test is `parseStatus`'s own, so the two agree about what a phase is. */
function phaseSections(lines: string[]): { heading: string; from: number; to: number }[] {
  const sections: { heading: string; from: number; to: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("## ")) continue;
    const last = sections[sections.length - 1];
    if (last && last.to === -1) last.to = i;
    const heading = line.slice(3).trim();
    if (/^(phase|fase)\b/i.test(heading)) sections.push({ heading, from: i + 1, to: -1 });
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
    for (let i = section.from; i < section.to; i++) {
      const cells = tableCells(lines[i]!);
      if (!cells) continue;
      checks.push({ phase: section.heading, line: lines[i]!, task: cells[0], done: cells[1] === DONE_MARK });
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
  for (let i = section.from; i < section.to; i++) {
    if (lines[i] !== line) continue;
    const cells = tableCells(line);
    if (!cells || cells[1] === DONE_MARK) return null;
    const parts = line.split("|");
    parts[2] = parts[2]!.replace(cells[1], DONE_MARK);
    lines[i] = parts.join("|");
    return lines.join("\n");
  }
  return null;
}
