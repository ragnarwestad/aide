// What a phase's unfolded row shows (spec 500): the transcript of the
// newest attempt that ran the step — what the run said AND what it did —
// and where that step is on the spec's Logs tab.
//
// The model's own messages alone were too little to follow a run by: a
// session that works through commands writes a sentence every few
// minutes (512's implement: nine in 33 minutes, over 107 commands), so
// the row looked frozen while the step was busy.
import type { QueueStore } from "../../queue/queue.ts";
import { finalMessage, isFinal, summarizeEntries } from "../../queue/parse-stream";
import type { PhaseMessages } from "../../render";
import { tailFile } from "../serve-helpers";
import { stepKey, workRoundJobs } from "./work-round.ts";

const KEPT = 200;
const FINAL_MAX = 2000;

/** The final message is already escaped, so a cut must not leave half an
 *  entity (`&am`) at its end. */
function cutFinal(text: string): string {
  if (text.length <= FINAL_MAX) return text;
  const head = text.slice(0, FINAL_MAX);
  const amp = head.lastIndexOf("&");
  return `${amp > head.lastIndexOf(";") && FINAL_MAX - amp < 8 ? head.slice(0, amp) : head}…`;
}

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
    const text = file ? tailFile(file) : "";
    const tool = result?.tool;
    const messages = summarizeEntries(text, { tool, only: "all", max: KEPT }).map((e) => e.text);
    const final = running ? undefined : finalMessage(text, { tool });
    if (final) {
      if (messages.length && isFinal(messages[messages.length - 1]!, final)) messages.pop();
      messages.push(cutFinal(final));
      while (messages.length > KEPT) messages.shift();
    }
    return {
      messages,
      step: stepKey(workRoundJobs(queue, job.project, job.specFolder), job, step),
      running,
    };
  }
  return undefined;
}
