// Who needs a person, decided from two things a job holds: its state and
// how many step results it has. Compared with what the observer saw last
// time, that is enough to tell "just entered a waiting state" from "was
// already there and has been updated again" — see `index.ts` for the
// snapshot itself.

import type { MessageKey } from "../i18n/messages.ts";
import type { Job } from "../queue/queue.ts";
import type { JobState, StopReason } from "../queue/steps.ts";
import { isSpecFolder } from "../render/ui/shell.ts";

/** What the observer remembers of a job between two changes. */
export interface Seen {
  state: JobState;
  results: number;
}

export const seenOf = (job: Job): Seen => ({ state: job.state, results: job.results.length });

export interface Attention {
  kind: "failed" | "stopped" | "interrupted" | "archive-held-back";
  step: string;
  reason?: StopReason;
}

/** The states in which a job waits for a person. `cancelled` is not one:
 *  a person ended it themselves. */
const WAITING = new Set<JobState>(["failed", "stopped", "interrupted"]);

export function attentionFor(prev: Seen | undefined, job: Job): Attention | null {
  // A failed `create` (a provisional key, no spec page yet) and a
  // scheduled job have no spec to name and none to open.
  if (!isSpecFolder(job.specFolder)) return null;
  const last = job.results.at(-1);
  if (job.state !== prev?.state && WAITING.has(job.state)) {
    // An interrupted step left no result of its own, so the step that
    // was in flight is the one at `stepIndex`; the others ended with one.
    const step = job.state === "interrupted" ? job.steps[job.stepIndex] : (last?.step ?? job.steps[job.stepIndex]);
    return { kind: job.state as "failed" | "stopped" | "interrupted", step: step ?? "implement", reason: job.stopReason };
  }
  if (
    job.state === "done" &&
    job.results.length > (prev?.results ?? 0) &&
    last?.terminalReason === "acceptance-criteria-unticked"
  ) {
    return { kind: "archive-held-back", step: "archive" };
  }
  return null;
}

export function messageKeyFor(a: Attention): MessageKey {
  if (a.kind === "archive-held-back") return "push.archiveHeldBack";
  if (a.kind === "interrupted") return "push.interrupted";
  if (a.kind === "failed") return "push.failed";
  if (a.reason === "provider-limit") return "push.stoppedProviderLimit";
  if (a.reason === "tests-red") return "push.stoppedTestsRed";
  return "push.stoppedTimeout";
}
