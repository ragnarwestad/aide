/** Compact recorded facts for global list selection. Changed files invalidate
 * only their own spec; no acceptance coverage, model controls or notices are read. */
import { statSync } from "node:fs";
import { join } from "node:path";
import { specFileText } from "../discover";
import { parseStatus } from "../parse-status";
import { specPhaseOutcome, type PhaseOutcome } from "../parse-phase-outcome.ts";
import { DESCRIPTION_FILE, ANALYSIS_FILE, SOLUTION_FILE, STATUS_FILE } from "../spec-names.ts";

interface RecordFacts { done: string[]; outcomes: Record<string, PhaseOutcome> }
const records = new Map<string, { stamp: string; value: RecordFacts }>();
const fields = [DESCRIPTION_FILE, ANALYSIS_FILE, SOLUTION_FILE, STATUS_FILE];
const steps = ["create", "analyze", "implement", "archive"];
export function phaseRecords(dir: string): RecordFacts {
  const stamp = fields.map((file) => {
    try { const stat = statSync(join(dir, file)); return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; }
    catch { return "missing"; }
  }).join("|");
  const previous = records.get(dir);
  if (previous?.stamp === stamp) return previous.value;
  const outcomes = Object.fromEntries(steps.map((step) => {
    const full = specPhaseOutcome(dir, step);
    return [step, { timeSpentMs: full.timeSpentMs, cost: full.cost, costUnmeasured: full.costUnmeasured, tokens: full.tokens,
      attempts: full.attempts, result: full.result, analysis: full.analysis, sentBack: full.sentBack }];
  }));
  const value = { done: parseStatus(specFileText(dir, STATUS_FILE) ?? "").workflowSteps, outcomes };
  if (records.size >= 20000) records.delete(records.keys().next().value!);
  records.set(dir, { stamp, value });
  return value;
}
