// Spec 356: the dashboard's read-only use of the one table
// (core/scripts/lib/transitions.json) that decides whether a spec may
// move between phases — imported the same way dashboard/src/queue/
// steps.ts already imports workflow-steps.json (spec 349). The
// dashboard never WRITES a phase (only aide-run-spec and
// aide-archive-spec, run against a real checkout, ever do); this is the
// one place it asks the table before letting a request reach the queue.

import transitionsData from "../../../core/scripts/lib/transitions.json" with { type: "json" };

export type SpecPhase = "created" | "analyzed" | "implemented" | "archived" | "closed";

interface TransitionRow {
  phase: SpecPhase;
  event: string;
  next: SpecPhase | null;
  refusal: { reason: string; message: string } | null;
  condition: string | null;
}

const ROWS = transitionsData.rows as TransitionRow[];

export type LegalMove = { ok: true; next: SpecPhase } | { ok: false; reason: string; message: string };

/** The phase a spec with these `completedPhases` (spec 355's
 *  `4-status.json`) is in — the same rule
 *  core/scripts/lib/spec-transitions.sh's `current_phase_from` derives
 *  in bash: the `closed` stamp decides first, then `archived` (both
 *  written before `completedPhases` ever gains the matching step), then
 *  membership in `completedPhases` for the three phases before that —
 *  never "last element", since the array is not guaranteed ordered.
 *  `closed` is optional so callers untouched by spec 406 (there are
 *  several, threading `closedFolders` through is Phase 3's own work)
 *  keep compiling unchanged; omitted, a spec is never read as closed. */
export function phaseFromState(
  completedPhases: readonly string[],
  archived: { date: string } | null | undefined,
  closed?: { date: string } | null,
): SpecPhase {
  if (closed) return "closed";
  if (archived) return "archived";
  if (completedPhases.includes("implement")) return "implemented";
  if (completedPhases.includes("analyze")) return "analyzed";
  return "created";
}

/** Looks up `[phase, event]` in the table (REQ-1). A pair the table has
 *  no row for is itself a refusal ("no-such-move"), never a silent
 *  accept — the same default core/scripts/lib/spec-transitions.sh's
 *  `may_apply_spec_transition` applies. `%s` in a refusal's message
 *  template is the one place the spec folder is substituted in
 *  (REQ-3). Conditions (e.g. a dependency gate) are NOT evaluated here
 *  — every row this dashboard-side check needs today (REQ-9's backward
 *  moves) has none; a row that names one is treated as satisfied by
 *  this read-only use, exactly as core/scripts/lib/spec-transitions.sh's
 *  own `check_transition_condition` treats a condition no caller has
 *  defined a checker for. */
export function isLegalMove(phase: SpecPhase, event: string, specLabel: string): LegalMove {
  const row = ROWS.find((r) => r.phase === phase && r.event === event);
  if (!row) {
    return { ok: false, reason: "no-such-move", message: `${specLabel} has no ${event} move from ${phase}` };
  }
  if (row.refusal) {
    return { ok: false, reason: row.refusal.reason, message: row.refusal.message.replace("%s", specLabel) };
  }
  return { ok: true, next: row.next as SpecPhase };
}
