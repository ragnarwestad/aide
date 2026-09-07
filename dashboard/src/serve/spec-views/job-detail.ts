// one job's own page: its steps, its stream, and what the run cost.
//
// Split out of spec-views.ts 2026-09-04, where it had grown to 562
// lines; every function is unchanged and keeps its name.
import { specPhaseFile } from "../../project/discover.ts";
import type { JobDetailView } from "../../render.ts";
import type { Job } from "../../queue/queue.ts";
import { resolveStepModel, tailFile } from "../serve-helpers.ts";
import { summarizeStream } from "../../queue/parse-stream.ts";
import type { SpecViewsContext } from "../spec-views.ts";

export async function jobDetailView(ctx: SpecViewsContext, job: Job): Promise<JobDetailView> {
  const target = ctx.targets().find((t) => t.project === job.project && t.specFolder === job.specFolder);
  // Which CLI this page is about (spec 125). A running step's tool is
  // not recorded anywhere yet — the result file that would carry it is
  // written when the step ENDS — so it is resolved the same way the
  // argv resolved it: from the config entry the chosen model name
  // points at. A finished job answers from its own last result.
  const step = job.steps[job.stepIndex];
  const running = job.state === "running";
  const named = running
    ? ctx.queue.defaults.modelChoices?.[resolveStepModel(job, step ?? "", ctx.queue.defaults.model) ?? ""]?.tool
    : job.results[job.results.length - 1]?.tool;
  const tool = named ?? "claude";
  // What this job's step WROTE (spec 150). The step running now, or
  // failing that the last one that ran — read off disk, uncached and
  // ungitted: this page says what the phase produced, and which
  // VERSION of it is the spec page's question.
  const shownStep = step ?? job.steps[job.steps.length - 1];
  const dir = ctx.specDir(job.project, job.specFolder);
  const phase = dir && shownStep ? specPhaseFile(dir, shownStep) : null;
  return {
    ...(await ctx.jobRow(job)),
    tool,
    title: target?.title,
    finishedAt: job.finishedAt,
    // Each finished step's OWN transcript (spec 240), read from its
    // own `streamFile` rather than the job's last one — a three-step
    // attempt used to make only its last step's log reachable at all.
    results: job.results.map((r) => ({
      ...r,
      tokens: r.tokens?.total,
      logs: r.streamFile ? summarizeStream(tailFile(r.streamFile), { tool: r.tool ?? named }) : undefined,
    })),
    phase: phase ?? undefined,
    // The step running RIGHT NOW, when one is: it has no `StepResult`
    // yet, so it cannot ride along in `results` above, and its
    // transcript is the job's own live pointer.
    runningStep:
      running && step
        ? {
            step,
            sessionId: job.sessionId,
            logs: job.streamFile ? summarizeStream(tailFile(job.streamFile), { tool: named }) : [],
          }
        : undefined,
    archiveHeldBack: target?.archiveHeldBack?.reason,
  };
}
