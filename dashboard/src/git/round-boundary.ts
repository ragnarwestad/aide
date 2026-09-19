// Spec 471: whether a held-back spec's open AC-n rows have moved on
// since the round that held it back — one line at a time, the same
// `git show <sha>:<path>` technique description-freshness.ts already
// uses for a whole-file diff, narrowed here to a single AC-n line.

import { basename } from "node:path";
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
  // `<sha>:<path>` is relative to the repository root unless it starts with
  // `./`, and the spec is in `dir`, not at the root. A spec that was
  // archived at the boundary keeps its description under the sibling
  // `archive/<folder>/`.
  const own = await run(dir, ["show", `${sha}:./1-description.md`]);
  const out = own.code === 0
    ? own
    : await run(dir, ["show", `${sha}:../archive/${basename(dir)}/1-description.md`]);
  return out.code === 0 ? parseAcRows(out.stdout) : new Map();
}

/** The current description's own AC-n rows — the other half of the
 *  comparison `criteriaMovedOn` makes, read off content the
 *  caller already has in hand rather than a second git call. */
export function acRowsFromText(descriptionText: string): Map<string, string> {
  return parseAcRows(descriptionText);
}

/** Whether the criteria have moved on since the round boundary: at
 *  least one OPEN id reads differently from its text there, or is new —
 *  absent from `boundaryRows` — or the description carries an id the
 *  boundary did not have at all (added, with no status row yet). One is
 *  enough: the other open criteria may be right as they stand, and a
 *  rule that made every one of them change forced edits with no reason
 *  behind them. `false` only when nothing a new round could act on has
 *  changed — the same words would give the same result.
 *
 *  Silence — no boundary entry for an id — reads as "new", never as
 *  "unchanged": a criterion that did not exist at the boundary cannot
 *  have failed to change since it. */
export function criteriaMovedOn(
  currentRows: Map<string, string>,
  openIds: Iterable<string>,
  boundaryRows: Map<string, string>,
): boolean {
  for (const id of openIds) {
    const boundaryText = boundaryRows.get(id);
    if (boundaryText === undefined || boundaryText !== currentRows.get(id)) return true;
  }
  for (const id of currentRows.keys()) {
    if (!boundaryRows.has(id)) return true;
  }
  return false;
}
