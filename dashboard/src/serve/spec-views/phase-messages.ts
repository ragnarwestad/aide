// What a phase's unfolded row shows: the Log of the newest
// attempt that ran the step — the same log the Logs tab shows, Aide's
// lines and the AI's — and where that step is on the spec's Logs tab.
//
// The model's own messages alone were too little to follow a run by: a
// session that works through commands writes a sentence every few
// minutes (one implement: nine in 33 minutes, over 107 commands), so
// the row looked frozen while the step was busy.
import type { QueueStore } from "../../queue/queue.ts";
import { stepLog, stepMarks, stepTokens } from "../../queue/parse-stream";
import type { PhaseMessages } from "../../render";
import type { SidePart } from "../../queue/providers/side-tools.ts";
import { resolveStepModel, tailFileAt } from "../serve-helpers";
import { codexSessionReader } from "./codex-sessions.ts";
import { resolveStepProvider } from "../../queue/providers/index.ts";
import { readRunLog } from "./job-detail.ts";
import { stepLinesOf } from "./job-marks.ts";
import { phaseAttempts, resultKey, workRoundJobs } from "./work-round.ts";
import { aiLabel } from "./job-detail.ts";
import { withModelId } from "../../render/ui/components/model-label.ts";

/** `attemptIds` is newest first; the first attempt that ran (or is
 *  running) the step is the one read. A newer job only queued for the step
 *  has nothing to read and hides nothing. */
export function phaseMessagesFor(
  queue: Pick<QueueStore, "get" | "list" | "defaults">,
  attemptIds: string[],
  step: string,
): PhaseMessages | undefined {
  for (const id of attemptIds) {
    const job = queue.get(id);
    if (!job) continue;
    const resultIndex = job.results.findLastIndex((r) => r.step === step);
    const result = resultIndex < 0 ? undefined : job.results[resultIndex];
    const running = job.state === "running" && job.steps[job.stepIndex] === step;
    if (!result && !running) continue;
    const file = running ? job.streamFile : result?.streamFile;
    // The step's Log as the Logs tab draws it — Aide's own lines and the
    // AI's, in the order they happened, every line of it: this row is a
    // window on that log, not a shorter copy. Aide's lines include the
    // landing, so the merge step and its test run show here as they go.
    const transcript = file ? tailFileAt(file, Infinity) : { text: "", start: 0 };
    const runLog = file ? readRunLog(file) : undefined;
    const shown = stepLog(transcript, runLog, { tool: running ? undefined : result?.tool, final: !running, codexSession: codexSessionReader(running ? resolveStepProvider(job, step, queue.defaults) : result?.provider?.key ?? resolveStepProvider(job, step, queue.defaults), queue.defaults.providers) });
    const { logs } = shown;
    // The steps the log marked, each with its time and the tokens it used, listed above the Log.
    const marks = stepMarks(logs, stepTokens(transcript.text, result?.tool));
    const jobs = workRoundJobs(queue, job.project, job.specFolder);
    const stored = phaseAttempts(jobs, step);
    const identity = running
      ? { phase: step, attempt: stored.length + 1, at: job.stepStartedAt ?? job.startedAt }
      : stored.find((item) => item.job === job && item.resultIndex === resultIndex)?.identity;
    return {
      logs,
      errors: shown.errors,
      aiModel: withModelId(
        aiLabel(
          running
            ? queue.defaults.modelChoices?.[resolveStepModel(job, step, queue.defaults.model) ?? ""]?.tool
            : result?.tool,
          resolveStepModel(job, step, queue.defaults.model ?? {}),
        ),
        running ? undefined : result?.modelId,
      ),
      steps: stepLinesOf(marks, logs, [], Date.parse(job.stepStartedAt ?? job.startedAt ?? ""), running),
      step: running ? "live" : resultKey(jobs, job, resultIndex),
      identity,
      running,
    };
  }
  return undefined;
}

/** One side session's own part of the implement step's transcript: the
 *  bytes its range names, drawn as the tool that session ran on writes them.
 *  `attemptIds` is newest first; the first attempt whose implement result has
 *  that session with a range is the one read. */
export function sideMessagesFor(
  queue: Pick<QueueStore, "get">,
  attemptIds: string[],
  part: SidePart,
): PhaseMessages | undefined {
  for (const id of attemptIds) {
    const result = queue.get(id)?.results.findLast((r) => r.step === "implement");
    const side = result?.[part];
    if (!result?.streamFile || !side?.transcript) continue;
    const whole = tailFileAt(result.streamFile, Infinity);
    // Bytes, not characters: the range is an offset in the file.
    const bytes = Buffer.from(whole.text);
    const from = Math.max(side.transcript.from, whole.start) - whole.start;
    const to = Math.min(side.transcript.to - whole.start, bytes.length);
    if (to <= 0) continue;
    const text = bytes.subarray(from, Math.max(from, to)).toString("utf-8");
    const { logs } = stepLog({ text, start: 0 }, undefined, { tool: side.tool ?? result.tool, final: true });
    return { logs, steps: [], running: false };
  }
  return undefined;
}
