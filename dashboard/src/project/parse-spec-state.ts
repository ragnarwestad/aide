// spec 355: reading 4-status.json — the one file a spec's completed
// phases, archived/reopened stamps and acceptance-criteria ticks are
// derived into, by core/scripts/lib/spec-state.sh, at the same moment
// the three writer scripts (aide-run-spec, aide-archive-spec,
// aide-write-spec) change 4-status.md's prose. This is the ONE reader:
// every state-bearing field a gate or a rendered row needs comes
// through here, never through a fresh regex over the prose beside it.
//
// A per-spec-folder runtime file, unlike core/scripts/lib/workflow-
// steps.json's repo-wide, build-time-known JSON import — there is one
// 4-status.json per spec folder, read at request time, so this is an
// ordinary function that takes a directory, not a static `import ...
// with { type: "json" }`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SpecStateAcceptanceRow {
  task: string;
  done: boolean;
}

export interface SpecStatePhaseCount {
  done: number;
  total: number;
}

export interface SpecState {
  completedPhases: string[];
  archived: { date: string } | null;
  reopened: { date: string; boundaryCommit: string } | null;
  acceptanceCriteria: SpecStateAcceptanceRow[];
  phaseCounts: Record<string, SpecStatePhaseCount>;
}

/** The first Phase/Fase/Checklist/Acceptance section (in file order,
 *  which is the order `phaseCounts`'s own keys were inserted in) that
 *  still has an unfinished row — the same "first open phase" rule
 *  `parse-status.ts`'s `parseStatus` used to compute straight off the
 *  prose, `## Acceptance criteria` included: once every earlier
 *  section is finished, `phase` reads as "Acceptance criteria" exactly
 *  like the prose parser's own `phase` field always has.
 *  `"done"` once every section is finished, `null` when the file has
 *  no matching section at all. See `currentAcceptancePhase` for the
 *  INDEPENDENT read that surfaces the same section while an earlier
 *  phase is still current. */
export function currentPhase(state: SpecState): string | null {
  const headings = Object.keys(state.phaseCounts);
  if (headings.length === 0) return null;
  for (const heading of headings) {
    const counts = state.phaseCounts[heading]!;
    if (counts.done < counts.total) return heading;
  }
  return "done";
}

/** The `## Acceptance criteria` heading, only when it still has an open
 *  row — these rows are the spec's own person to judge, never
 *  `aide-implement`'s, so they must not sit behind `currentPhase`
 *  reaching "done" first. */
export function currentAcceptancePhase(state: SpecState): string | null {
  const heading = Object.keys(state.phaseCounts).find((h) => /^acceptance\b/i.test(h));
  if (!heading) return null;
  const counts = state.phaseCounts[heading]!;
  return counts.done < counts.total ? heading : null;
}

/** `dir`'s own `4-status.json`, parsed. `null` covers every way there is
 *  nothing to read — no file yet (REQ-10: a spec no writer script has
 *  touched since spec 355 shipped, or an archived spec the backfill has
 *  not reached yet), unreadable, not valid JSON — because every caller
 *  treats "missing" and "unreadable" the same way: show it as missing,
 *  never fall back to re-parsing the prose beside it (REQ-5, REQ-10). */
export function readSpecState(dir: string): SpecState | null {
  try {
    const path = join(dir, "4-status.json");
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    return {
      completedPhases: Array.isArray(parsed.completedPhases) ? parsed.completedPhases : [],
      archived: parsed.archived ?? null,
      reopened: parsed.reopened ?? null,
      acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria) ? parsed.acceptanceCriteria : [],
      phaseCounts: parsed.phaseCounts && typeof parsed.phaseCounts === "object" ? parsed.phaseCounts : {},
    };
  } catch {
    return null;
  }
}
