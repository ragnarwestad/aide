// one job's own page: its steps, its stream, and what the run cost.
//
// Split out of spec-views.ts 2026-09-04, where it had grown to 562
// lines; every function is unchanged and keeps its name.
import { specPhaseFile } from "../../project/discover";
import type { JobDetailView } from "../../render";
import type { Job } from "../../queue/queue.ts";
import { resolveStepModel, tailFile } from "../serve-helpers";
import { finalMessage, summarizeCommands, summarizeEntries, type LogFilter } from "../../queue/parse-stream";
import { diffStatBetween } from "../../git/diff-stat.ts";
import type { SpecViewsContext } from "./";

/** `only` is the Logs tab's filter, read from the URL. It is applied
 *  HERE rather than in the renderer so the bound is per kind: "the last
 *  40 commands", not "the commands among the last 40 lines" — a step
 *  whose tail is all prose would otherwise answer "no commands" for a
 *  step that ran twenty. */
export async function jobDetailView(
  ctx: SpecViewsContext,
  job: Job,
  only?: LogFilter,
): Promise<JobDetailView> {
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
    // Spec 452: the same text also yields the Logs tab's summary —
    // which commands ran and the assistant's own final message — and
    // `r.repos` (its own commit range) yields the changed-files list,
    // via one `git diff --numstat` per repo the step touched.
    results: await Promise.all(
      job.results.map(async (r) => {
        const tool = r.tool ?? named;
        const text = r.streamFile ? tailFile(r.streamFile) : undefined;
        const changedFiles = r.repos
          ? (
              await Promise.all(
                r.repos.map((repo) => diffStatBetween(ctx.gitRun, repo.root, repo.headBefore, repo.headAfter)),
              )
            ).flat()
          : undefined;
        return {
          ...r,
          tokens: r.tokens?.total,
          logs: text ? summarizeEntries(text, { tool, only }).map((e) => e.text) : undefined,
          commands: text ? summarizeCommands(text, { tool }) : undefined,
          finalMessage: text ? finalMessage(text, { tool }) : undefined,
          changedFiles,
        };
      }),
    ),
    phase: phase ?? undefined,
    // The step running RIGHT NOW, when one is: it has no `StepResult`
    // yet, so it cannot ride along in `results` above, and its
    // transcript is the job's own live pointer.
    runningStep:
      running && step
        ? {
            step,
            sessionId: job.sessionId,
            logs: job.streamFile
              ? summarizeEntries(tailFile(job.streamFile), { tool: named, only }).map((e) => e.text)
              : [],
          }
        : undefined,
    archiveHeldBack: target?.archiveHeldBack?.reason,
  };
}
