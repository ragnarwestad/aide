// Holding a queued job: the reason it waits is written on its row, only
// when it changed, and taken off again by the first pass that does not
// hold it.

import type { BoardMessage } from "../../i18n/message.ts";
import type { Job, QueueStore } from "../queue.ts";

/** Hold one job with the reason it is held for RIGHT NOW. Written
 *  only when it changed: an unconditional update would rewrite the
 *  mirror every two seconds for a job that is doing nothing. `held`
 *  collects the ids this pass held. */
export function holdJob(store: QueueStore, held: Set<string>, job: Job, reason: BoardMessage): void {
  held.add(job.id);
  // Every caller reaches this with a job that IS queued right now,
  // so the reason it holds for is always the current one — whatever
  // `errorReason` an earlier, unrelated attempt left behind (a refused
  // landing's own record lives in `landingError`,
  // which this never touches, not in `error`/`errorReason`).
  const current = job.error;
  const same = !!current && typeof current === "object" && !Array.isArray(current) &&
    current.key === reason.key && JSON.stringify(current.values) === JSON.stringify(reason.values);
  if (!same) store.update(job.id, { error: reason, errorReason: "held-back" });
}

/** Take the hold-back sentence off every queued job this pass did not
 *  hold. The reason is gone; the row must not go on naming it. Only
 *  `held-back` sentences — a stopped job's own error is its record,
 *  not a wait. */
export function clearStaleHolds(store: QueueStore, held: Set<string>): void {
  for (const job of store.list()) {
    if (job.state !== "queued" || held.has(job.id)) continue;
    if (job.errorReason !== "held-back") continue;
    store.update(job.id, { error: undefined, errorReason: undefined });
  }
}
