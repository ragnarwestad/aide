// What a phase's unfolded row shows (spec 500): the Log of the newest
// attempt that ran the step — the same log the Logs tab shows, Aide's
// lines and the AI's — and where that step is on the spec's Logs tab.
//
// The model's own messages alone were too little to follow a run by: a
// session that works through commands writes a sentence every few
// minutes (512's implement: nine in 33 minutes, over 107 commands), so
// the row looked frozen while the step was busy.
import type { QueueStore } from "../../queue/queue.ts";
import { stepLog } from "../../queue/parse-stream";
import type { PhaseMessages } from "../../render";
import { tailFileAt } from "../serve-helpers";
import { readCodexSession } from "./codex-sessions.ts";
import { readRunLog } from "./job-detail.ts";
import { stepKey, workRoundJobs } from "./work-round.ts";

/** `attemptIds` is newest first; the first attempt that ran (or is
 *  running) the step is the one read. A newer job only queued for the step
 *  has nothing to read and hides nothing. */
export function phaseMessagesFor(
  queue: Pick<QueueStore, "get" | "list">,
  attemptIds: string[],
  step: string,
): PhaseMessages | undefined {
  for (const id of attemptIds) {
    const job = queue.get(id);
    if (!job) continue;
    const result = job.results.find((r) => r.step === step);
    const running = job.state === "running" && job.steps[job.stepIndex] === step;
    if (!result && !running) continue;
    const file = running ? job.streamFile : result?.streamFile;
    // The step's Log as the Logs tab draws it — Aide's own lines and the
    // AI's, in the order they happened, every line of it: this row is a
    // window on that log, not a shorter copy. Aide's lines include the
    // landing, so the merge step and its test run show here as they go.
    const transcript = file ? tailFileAt(file, Infinity) : { text: "", start: 0 };
    const runLog = file ? readRunLog(file) : undefined;
    const { logs } = stepLog(transcript, runLog, { tool: result?.tool, final: !running, codexSession: readCodexSession });
    return {
      logs,
      step: stepKey(workRoundJobs(queue, job.project, job.specFolder), job, step),
      running,
    };
  }
  return undefined;
}
