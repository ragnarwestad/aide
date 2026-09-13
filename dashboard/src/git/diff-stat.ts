// Spec 452: AC-2's "which files this step wrote or deleted, with lines
// added and removed" — `aide-run-spec` already carries a step's own
// `headBefore`/`headAfter` per repo (`StepResult.repos`), so the only
// new question this dashboard asks git is a plain `diff --numstat`
// between the two. Kept beside, not inside, `description-freshness.ts`
// (460 lines already, close to the 500-line limit) — a new file for a
// new question, per `dashboard/CLAUDE.md`'s "new functionality goes into
// its own file" rule.
//
// No cache, unlike every checker in `description-freshness.ts`: a
// finished step's `headBefore`/`headAfter` never change once written, so
// there is nothing here for a TTL to protect against re-asking.

import type { GitRunner } from "./branch-status.ts";

export interface DiffStatEntry {
  path: string;
  added: number;
  removed: number;
  /** `git diff --numstat` reports `-`/`-`, not a number, for a binary
   *  file. Coercing that to `Number("-") || 0` would read as "0 added /
   *  0 removed" — indistinguishable from "unchanged" — so a binary
   *  file that changed says so instead of a false zero. */
  binary: boolean;
}

export async function diffStatBetween(
  run: GitRunner,
  dir: string,
  before: string,
  after: string,
): Promise<DiffStatEntry[]> {
  if (before === after) return [];
  const out = await run(dir, ["diff", "--numstat", before, after]);
  if (out.code !== 0) return [];
  return out.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [a, r, path] = line.split("\t");
      const binary = a === "-" || r === "-";
      return { path: path ?? "", added: binary ? 0 : Number(a) || 0, removed: binary ? 0 : Number(r) || 0, binary };
    });
}
