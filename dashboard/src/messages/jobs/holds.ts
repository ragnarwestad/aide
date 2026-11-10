import type { MessageKey } from "../catalog.ts";
import type { QueueRowView } from "../../render/ui/job-state/types.ts";

/** The held-back reasons that resolve on their own — the queue
 *  starts the work itself the moment the thing in front of it finishes,
 *  so nobody has anything to act on. Every other held-back reason,
 *  named here or not, keeps the waiting kind's warning triangle: a
 *  message added to this family later and left off this list defaults
 *  to "waiting", not silently to "info". */
export const HELD_BACK_INFO_KEYS = new Set<MessageKey>([
  "runner.landingPause",
  "runner.archiveRunning",
  "runner.dependencyNotArchived",
  "runner.usageLimitHeld",
  "runner.usageLimitHeldNoReset",
  "runner.usageLimitHeldProbe",
  "runner.scheduleWaitsOnJob",
]);

/** Whether a queued job's own hold resolves on its own, read off the
 *  key alone, never the rendered text. Exported so the
 *  row's own state word (`specStateChip`, resting.ts) colours a
 *  held-back queue exactly as this file's notice line already does —
 *  one classification, asked from two places, rather than the same
 *  keys copied a second time and left free to drift apart. */
export function heldBackResolvesOnItsOwn(r: Pick<QueueRowView, "errorReason" | "error">): boolean {
  if (r.errorReason !== "held-back" || !r.error || typeof r.error !== "object" || Array.isArray(r.error)) {
    return false;
  }
  return HELD_BACK_INFO_KEYS.has(r.error.key);
}

