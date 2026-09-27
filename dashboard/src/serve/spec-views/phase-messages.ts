// What a phase's unfolded row shows (spec 500): the transcript of the
// newest attempt that ran the step — what the run said AND what it did —
// and where that step is on the spec's Logs tab.
//
// The model's own messages alone were too little to follow a run by: a
// session that works through commands writes a sentence every few
// minutes (512's implement: nine in 33 minutes, over 107 commands), so
// the row looked frozen while the step was busy.
import type { QueueStore } from "../../queue/queue.ts";
import { endWithFinalMessage, summarizeEntries } from "../../queue/parse-stream";
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
    // Whole, not its tail: the step marks from the start of the run are
    // what says how far it got, and the bound below keeps every one.
    const text = file ? tailFile(file, Infinity) : "";
    const tool = result?.tool;
    const entries = summarizeEntries(text, { tool, only: "all", max: KEPT });
    const marks = new Set(entries.filter((e) => e.mark).map((e) => e.text));
    const lines = entries.map((e) => e.text);
    const messages = running ? lines : endWithFinalMessage(lines, text, { tool }, cutFinal);
    for (let i = 0; messages.length > KEPT && i < messages.length; ) {
      if (marks.has(messages[i]!)) i++;
      else messages.splice(i, 1);
    }
    return {
      messages,
      step: stepKey(workRoundJobs(queue, job.project, job.specFolder), job, step),
      running,
    };
  }
  return undefined;
}
