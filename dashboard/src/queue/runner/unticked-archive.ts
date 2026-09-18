// A queued `archive` whose acceptance rows are still open ends here, with
// the result `aide-archive-spec`'s own pre-check would have written —
// no process, no cost — so the row reads the same one refusal either way.

import type { Job, QueueStore } from "../queue.ts";

export function endUntickedArchive(store: QueueStore, job: Job, now: string): void {
  store.transition(job.id, "no-step-left", {
    finishedAt: now,
    error: undefined,
    errorReason: undefined,
    results: [
      ...job.results,
      {
        step: "archive",
        ok: true,
        costUsd: 0,
        tool: "none",
        costMeasured: true,
        terminalReason: "acceptance-criteria-unticked",
        at: now,
      },
    ],
  });
}
