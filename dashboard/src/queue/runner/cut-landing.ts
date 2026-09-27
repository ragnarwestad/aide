// A landing the last process never finished — stopped by a restart, a
// crash or a power cut — is run again at boot, from the step's own result
// file, through the same hook that started it. The store reads such a job
// back with `landingCut` set rather than `landing`, which would hold the
// queue shut with nothing left to clear it. Dropped instead, it left a
// step's work on its branch for good. Running one twice is safe: a branch
// already merged and gone is nothing to land.

import type { WorkflowStep } from "../queue.ts";
import type { RunnerOptions, StepOutcome } from "./types.ts";

export function resumeCutLandings(o: Pick<RunnerOptions, "store" | "readResult" | "onStepDone">): void {
  for (const job of o.store.list()) {
    if (!job.landingCut) continue;
    o.store.update(job.id, { landingCut: undefined });
    const step = job.results.at(-1)?.step as WorkflowStep | undefined;
    const raw = job.resultFile ? o.readResult(job.resultFile) : null;
    if (!step || !raw) {
      console.error(`queue: ${job.project}/${job.specFolder}'s landing was cut short and has no result to land from`);
      continue;
    }
    const work = o.onStepDone?.(job, step, raw as Partial<StepOutcome>);
    if (!work) continue;
    // Held the way `Runner.complete` holds it: the job's next step waits.
    o.store.update(job.id, { landing: true });
    const clear = (): void => {
      o.store.update(job.id, { landing: undefined });
    };
    void Promise.resolve(work).then(clear, clear);
  }
}
