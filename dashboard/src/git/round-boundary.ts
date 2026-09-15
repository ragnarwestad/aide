// Spec 471: whether a held-back spec's open AC-n rows have moved on
// since the round that held it back — one line at a time, the same
// `git show <sha>:<path>` technique description-freshness.ts already
// uses for a whole-file diff, narrowed here to a single AC-n line.

import type { GitRunner } from "./branch-status.ts";

/** The same id-extraction shape `requirements-tracing.md`'s own Step 1
 *  and Step 8 already use on 1-description.md's `^- \*\*AC-\d+:\*\*`
 *  lines — kept here as the one place both `acRowsAt` and the current-
 *  description reader parse it, so the two never drift apart. */
const AC_LINE_RE = /^- \*\*(AC-\d+):\*\*\s*(.*)$/;

function parseAcRows(text: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.match(AC_LINE_RE);
    if (m) rows.set(m[1]!, m[2]!.trim());
  }
  return rows;
}

/** Every `AC-n` line's text as of `sha`, keyed by id. Absent entirely
 *  (the id did not exist yet at that sha) is a real outcome, not an
 *  error — it is what makes an id "new" (spec 471, AC-6). An
 *  unreadable revision (bad sha, unreachable checkout) answers with no
 *  rows at all, the same "cannot prove staleness" direction every
 *  other unknown in this codebase takes. */
export async function acRowsAt(run: GitRunner, dir: string, sha: string): Promise<Map<string, string>> {
  const out = await run(dir, ["show", `${sha}:1-description.md`]);
  return out.code === 0 ? parseAcRows(out.stdout) : new Map();
}

/** The current description's own AC-n rows — the other half of the
 *  comparison `firstUnchangedOpenCriterion` makes, read off content the
 *  caller already has in hand rather than a second git call. */
export function acRowsFromText(descriptionText: string): Map<string, string> {
  return parseAcRows(descriptionText);
}

/** The first OPEN id (in ascending `AC-n` order) whose text is byte-
 *  identical to what it read at the round boundary — the one that
 *  blocks a new round (spec 471, AC-6). `null` when every open id is
 *  either new (absent from `boundaryRows`) or has changed text: the
 *  round may start.
 *
 *  Silence — no boundary entry for an id — reads as "new", never as
 *  "unchanged": a criterion that did not exist at the boundary cannot
 *  have failed to change since it (2-analysis.md, Patterns — never
 *  read absence as agreement). */
export function firstUnchangedOpenCriterion(
  currentRows: Map<string, string>,
  openIds: Iterable<string>,
  boundaryRows: Map<string, string>,
): string | null {
  const sorted = [...openIds].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  for (const id of sorted) {
    const boundaryText = boundaryRows.get(id);
    if (boundaryText === undefined) continue;
    if (boundaryText === currentRows.get(id)) return id;
  }
  return null;
}
