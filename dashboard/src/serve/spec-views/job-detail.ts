// one job's own page: its steps, its stream, and what the run cost.
//
// Split out of spec-views.ts 2026-09-04, where it had grown to 562
// lines; every function is unchanged and keeps its name.
import { specPhaseFile } from "../../project/discover";
import type { JobDetailView } from "../../render";
import type { Job } from "../../queue/queue.ts";
import { existsSync } from "node:fs";
import { resolveStepModel, tailFile, tailFileAt } from "../serve-helpers";
import { stepLog } from "../../queue/parse-stream";
import { RUN_LOG_MAX_BYTES, runLogPath } from "../../queue/runner/run-log-path.ts";
import { diffStatBetween } from "../../git/diff-stat.ts";
import type { SpecViewsContext } from "./";

/** The AI's name in its separator: the tool and the model choice, each word
 *  capitalised (`Claude Sonnet`); a choice that starts with the tool's name is
 *  not prefixed again (`Codex`). Nothing for a step that ran no AI. */
export function aiLabel(tool: string | undefined, choice: string | undefined): string | undefined {
  if (!tool || tool === "none") return undefined;
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const words = choice && !choice.toLowerCase().startsWith(tool.toLowerCase()) ? [tool, choice] : [choice ?? tool];
  return words.map(cap).join(" ");
}

/** The step's run log, when it has one. */
function readRunLog(streamFile: string): string | undefined {
  const path = runLogPath(streamFile);
  return existsSync(path) ? tailFile(path, RUN_LOG_MAX_BYTES) : undefined;
}

export async function jobDetailView(
  ctx: SpecViewsContext,
  job: Job,
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
  // The running step is built from the job's live transcript, with no final message.
  const liveRunLog = running && step && job.streamFile ? readRunLog(job.streamFile) : undefined; // before the transcript
  const live =
    running && step && job.streamFile
      ? stepLog(tailFileAt(job.streamFile), liveRunLog, { tool: named, final: false })
      : undefined;
  return {
    ...(await ctx.jobRow(job)),
    tool,
    title: target?.title,
    finishedAt: job.finishedAt,
    // Each finished step's OWN transcript (spec 240), read from its
    // own `streamFile` rather than the job's last one — a three-step
    // attempt used to make only its last step's log reachable at all.
    // The same text also yields the log lines, the error lines and the
    // assistant's own final message, and `r.repos` (its own commit
    // range) yields the changed-files list, via one `git diff --numstat`
    // per repo the step touched.
    results: await Promise.all(
      job.results.map(async (r) => {
        const tool = r.tool ?? named;
        // The run log first, the transcript second: every offset in the log is then at most
        // the size the transcript has when it is read, whether or not the step is still running.
        const runLog = r.streamFile ? readRunLog(r.streamFile) : undefined;
        const tail = r.streamFile ? tailFileAt(r.streamFile) : undefined;
        const choice = resolveStepModel(job, r.step, ctx.queue.defaults.model ?? {});
        const changedFiles = r.repos
          ? (
              await Promise.all(
                r.repos.map((repo) => diffStatBetween(ctx.gitRun, repo.root, repo.headBefore, repo.headAfter)),
              )
            ).flat()
          : undefined;
        const shown = tail ? stepLog(tail, runLog, { tool, final: true }) : undefined;
        return {
          ...r,
          tokens: r.tokens?.total,
          logs: shown?.logs,
          errors: shown?.errors,
          aiModel: aiLabel(tool, choice),
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
            logs: live?.logs ?? [],
            errors: live?.errors ?? [],
            aiModel: aiLabel(tool, resolveStepModel(job, step, ctx.queue.defaults.model ?? {})),
          }
        : undefined,
    archiveHeldBack: target?.archiveHeldBack?.reason,
  };
}
