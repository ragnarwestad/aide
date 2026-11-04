// What a finished step writes onto its job: the entry it adds to
// `results`, and the fields every ending shares, whichever transition
// follows. Both are read from the result file another process left, so
// every field of `outcome` is a question rather than a promise.

import { mergeBranchRefs, type Job, type StepResult, type TokenUsage, type WorkflowStep } from "../queue.ts";
import { asResultTool } from "../steps.ts";
import { claudeAccountOf, contextUse, providerLimit, sharedFiles, stepRepoRanges, testedGreen, type StepOutcome } from "./types.ts";

export interface StepMeasures {
  cost: number;
  tokens: TokenUsage | undefined;
  modelId: string | undefined;
  /** When the step's own work ended: now, or `undefined` while a
   *  landing it handed over has not settled. */
  at: string | undefined;
}

export function stepResultEntry(job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>, m: StepMeasures): StepResult {
  return {
    step,
    ok: !!outcome.ok,
    costUsd: m.cost,
    // Narrowed to the names the page knows how to route on: whatever
    // else a result file says, it is not a tool this dashboard can render
    // for. "none" is the deterministic create path — the one other value
    // `aide-run-spec` actually writes, alongside "codex" — and must not be
    // silently collapsed into "claude". Checked against the one list
    // rather than a copy of it.
    tool: asResultTool(outcome.tool) ?? "claude",
    tokens: m.tokens, modelId: m.modelId, context: contextUse(outcome.context), providerLimit: providerLimit(outcome.providerLimit), claudeAccount: claudeAccountOf(job, outcome.tool), testedGreen: testedGreen(outcome.testedGreen),
    costMeasured: outcome.costMeasured !== false,
    terminalReason: outcome.terminalReason ?? "no reason recorded",
    subtype: outcome.subtype, sharedFiles: sharedFiles(outcome.sharedFiles),
    // What the run reported, or failing that the id we gave it — a
    // step whose result carried no session was still run under one.
    sessionId: outcome.sessionId ?? job.sessionId,
    streamFile: job.streamFile,
    // Every repo root this step's own commit(s) span —
    // `aide-run-spec` emits this for every step.
    repos: stepRepoRanges(outcome.repos),
    prError: outcome.prError,
    // A step whose work lands: the clock this stamp ends is the step's
    // OWN work, and that work is not over until the merge is.
    at: m.at,
    // This step's own start — moves off `Job.stepStartedAt` and onto the
    // result it produced.
    startedAt: job.stepStartedAt,
  };
}

/** The fields every ending of a step writes, whichever transition follows. */
export function afterStep(
  job: Job,
  outcome: Partial<StepOutcome>,
  results: StepResult[],
  landing: true | undefined,
  m: Pick<StepMeasures, "cost" | "tokens">,
): Partial<Job> {
  return {
    results,
    landing,
    spentUsd: job.spentUsd + m.cost,
    // Undefined until something measures one: a job of steps that all
    // predate token measurement shows a dash, not a zero.
    spentTokens:
      m.tokens || job.spentTokens !== undefined
        ? (job.spentTokens ?? 0) + (m.tokens?.total ?? 0)
        : undefined,
    branchUrl: outcome.branchUrl ?? job.branchUrl,
    // Kept across steps the same way `branchUrl` is: the request belongs
    // to the CODE branch, which `implement` pushes and `archive` never
    // touches, so the step that ends the job is not the step that opened it.
    prUrl: outcome.prUrl ?? job.prUrl,
    pushError: outcome.pushError ?? job.pushError,
    // Accumulated BY ROOT, never replaced: a step that pushed to one repo
    // must not erase the repo an earlier step pushed to.
    branchUrls: mergeBranchRefs(job.branchUrls, outcome.branchUrls),
    pid: undefined,
    pgid: undefined,
    // The step is over: nothing is live under this id any more, and a page
    // that kept showing it would say the job is still working.
    sessionId: undefined,
    // Its value just moved onto the result; left set, a job merely
    // `queued` for its NEXT step would read as still ticking from the step
    // that already finished.
    stepStartedAt: undefined,
  };
}
