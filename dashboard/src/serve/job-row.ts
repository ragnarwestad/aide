// The queue row view: what every list, job page and spec page draws a
// job from — pulled out of `createServer`'s closure the same way the
// earlier clusters were (spec: split serve.ts, step 6). Small context:
// unlike `schedules.ts`, nothing here reads a `let` reassigned later in
// boot, so every field is a plain value.

import { queuePriorityOrder, tailEdits, type Job, type QueueStore } from "../queue/queue.ts";
import type { AideRunStore } from "../queue/aide-run-store.ts";
import type { QueueRowView, SideRunView } from "../render";
import type { SideRun } from "../queue/runner/side-run.ts";
import { resolveStepProvider } from "../queue/providers/index.ts";
import { resolveStepEffort, resolveStepModel, resolveTimeoutSec } from "./serve-helpers";

export interface JobRowContext {
  queue: QueueStore;
  store: AideRunStore;
}

export async function jobRow(ctx: JobRowContext, job: Job): Promise<QueueRowView> {
  // The step whose model the row is about: the one running, or the
  // last one for a job that has finished.
  const step = job.steps[job.stepIndex] ?? job.steps[job.steps.length - 1];
  const providerKey = step && step !== "deploy" ? resolveStepProvider(job, step, ctx.queue.defaults) : undefined;
  return {
    id: job.id,
    project: job.project,
    specFolder: job.specFolder,
    // What a create job's row is called while its folder is still a
    // provisional key: `new-abc123de` says nothing to anyone.
    createTitle: job.createTitle,
    steps: job.steps,
    stepIndex: job.stepIndex,
    // Which of them the row may still be given or relieved
    // of. Asked of the queue's own module, so the box and the route
    // that takes its tick cannot disagree about where the tail
    // starts.
    editableSteps: tailEdits(job),
    queuePosition: job.state === "queued" ? queuePosition(ctx.queue, job) : undefined,
    state: job.state,
    landing: job.landing,
    model: step ? resolveStepModel(job, step, ctx.queue.defaults.model) : job.modelChoice,
    // The newest run of this step that named one; a running step has no
    // result yet and speaks with the id of the attempt before it.
    modelId: step ? [...job.results].reverse().find((r) => r.step === step && r.modelId)?.modelId : undefined,
    stepModels: job.model,
    stepProviders: job.provider,
    effort: step ? resolveStepEffort(job, step) : undefined,
    spentUsd: job.spentUsd,
    // The stored split is five numbers; the page shows one. Flattened
    // here, at the boundary, so no render file has to know what a
    // result file looks like.
    spentTokens: job.spentTokens,
    // One number, for the step this row speaks for: `stateLabel` puts
    // it into words ("stopped — 45 min") and has no step to resolve
    // against of its own.
    timeoutSec: resolveTimeoutSec(job.timeoutSec, step ?? "default", ctx.queue.defaults.timeoutSec),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    stepStartedAt: job.stepStartedAt,
    // Stored on the job — only the run that called `gh` knows
    // the URL, and there is nothing on this machine to work it out from.
    prUrl: job.prUrl,
    pushError: job.pushError,
    stopReason: job.stopReason,
    usageLimitWait: job.usageLimitWait,
    // The provider the step runs, or ran, on, as it is named now.
    provider: providerKey ? (ctx.queue.defaults.providers?.[providerKey]?.name ?? providerKey) : undefined,
    error: job.error,
    errorDetail: job.errorDetail,
    dependencyNotice: job.dependencyNotice,
    // Why the landing was refused, when it was refused for something
    // the row can act on. Stored on the job, because a
    // landing has no browser to redirect the reason to.
    errorReason: job.errorReason,
    landingError: job.landingError,
    // Which third of an implement is running. Only for
    // `implement`, which is the one step that reports its phases, and
    // only off the job's LIVE `sessionId` — the queue clears that the
    // moment a step ends, so a finished job cannot pick up a leftover
    // row from the session it once used.
    tddPhase:
      step === "implement" && job.state === "running" && job.sessionId
        ? ctx.store.get(job.sessionId)?.phase
        : undefined,
    results: job.results.map((r) => ({
      step: r.step, ok: r.ok, tool: r.tool, costUsd: r.costUsd, tokens: r.tokens?.total, modelId: r.modelId, terminalReason: r.terminalReason,
      providerLimit: r.providerLimit,
      provider: r.provider,
      // When the step ENDED — what a phase's own duration
      // is sliced out of, together with its own recorded start below.
      at: r.at,
      // This step's own recorded start, when there is one.
      startedAt: r.startedAt,
      // Carried, not dropped: the totals the list and the overview tab
      // build out of these results have no other way to know a figure
      // they are summing was over-charged.
      costMeasured: r.costMeasured,
      // The review and the verification, each on its own, with tokens as the total.
      review: sideView(r.review), verify: sideView(r.verify),
      // Why `gh` opened no pull request: the step's own answer, said in
      // that phase's log.
      prError: r.prError,
    })),
  };
}

/** A stored review or verification as the list draws it. */
function sideView(run: SideRun | undefined): SideRunView | undefined {
  if (!run) return undefined;
  return { outcome: run.outcome, tool: run.tool, durationSec: run.durationSec, costUsd: run.costUsd, tokens: run.tokens?.total };
}

/** The same `queuePriorityOrder()` `Runner.tick()` calls,
 *  applied to every currently `queued` job that is actually waiting for
 *  a slot, oldest-first as `list()` gives every other reader of the
 *  store. A job the runner is holding back for another reason
 *  (`errorReason === "held-back"`, set by `Runner.hold()`) is excluded
 *  from both the count and its own place — it is not
 *  competing for a slot at all. */
function queuePosition(queue: QueueStore, job: Job): { n: number; total: number } | undefined {
  // Not competing for a slot: it stays where it is even if the queue
  // were empty, so it gets no place, and it does not count toward
  // anyone else's total either.
  if (job.errorReason === "held-back") return undefined;
  const queued = queuePriorityOrder(
    [...queue.list()].reverse().filter((j) => j.state === "queued" && j.errorReason !== "held-back"),
  );
  return { n: queued.findIndex((j) => j.id === job.id) + 1, total: queued.length };
}
