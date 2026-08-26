// One phase's own outcome record (spec 245's write side), read here for
// the first time (spec 247). `parse-status.ts` stays "4-status.md parsing
// only" (its own file header says so) — this is a sibling module rather
// than an addition there, because it needs `specFileText`/`markdownSection`
// from `discover.ts`, and `discover.ts` already imports from
// `parse-status.ts` (`archiveHeldBackReason`, for `specPhaseFile`) — putting
// this parser there too would make the two files import each other.

import { markdownSection, specFileText } from "./discover.ts";

export interface PhaseOutcome {
  model?: string;
  /** Milliseconds, parsed from the script's own `<N>m<NN>s` string — never
   *  the string itself, so `durationLabel` can format it like every other
   *  duration on the page (including the >1h case the raw string cannot
   *  express: `75m00s` becomes `1h15m`, not left as minutes). */
  timeSpentMs?: number;
  /** Dollars. Absent means the script wrote no `Cost:` line — never 0. */
  cost?: number;
  costUnmeasured?: boolean;
}

// The same four-file mapping `core/scripts/aide-run-spec`'s own
// `phase_file_for()` uses to decide which file THIS phase's own record
// goes into — a different question from `discover.ts`'s `specPhaseFile`
// ("what did this phase PRODUCE"), so a different map answers it.
const PHASE_OUTCOME_FILE: Record<string, string> = {
  create: "1-description.md",
  analyze: "2-analysis.md",
  implement: "3-solution.md",
  archive: "4-status.md",
};

const MODEL_RE = /^- \*\*Model:\*\*[ \t]*(.*)$/m;
const TIME_SPENT_RE = /^- \*\*Time spent:\*\*[ \t]*(\d+)m(\d{2})s\s*$/m;
const COST_RE = /^- \*\*Cost:\*\*[ \t]*\$(\d+(?:\.\d+)?)( \(unmeasured\))?\s*$/m;

/** Scoped to `## Tracking info` only, same as the writer's own
 *  `in_tracking` awk guard — a `- **Cost:**`-shaped bullet in a
 *  Risk-analysis table is not this record. */
export function parsePhaseOutcome(content: string): PhaseOutcome {
  const section = markdownSection(content, "Tracking info") ?? "";
  const outcome: PhaseOutcome = {};
  const model = section.match(MODEL_RE)?.[1]?.trim();
  if (model) outcome.model = model;
  const time = section.match(TIME_SPENT_RE);
  if (time) outcome.timeSpentMs = (Number(time[1]) * 60 + Number(time[2])) * 1000;
  const cost = section.match(COST_RE);
  if (cost) {
    outcome.cost = Number(cost[1]);
    if (cost[2]) outcome.costUnmeasured = true;
  }
  return outcome;
}

/** One phase's outcome, off its own file in `dir` — `{}` for an unknown
 *  step or a file not written yet, same "no such record" answer either
 *  way. */
export function specPhaseOutcome(dir: string, step: string): PhaseOutcome {
  const name = PHASE_OUTCOME_FILE[step];
  if (!name) return {};
  const text = specFileText(dir, name);
  return text ? parsePhaseOutcome(text) : {};
}
