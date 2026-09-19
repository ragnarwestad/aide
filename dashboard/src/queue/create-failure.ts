// When a `create` job is over and left no spec behind. One rule for the
// Specs list (no row for it), the push observer (a message and a push,
// once) and the record, so the three cannot disagree about what a
// failed create is.

import type { BoardMessage, Sentence } from "../i18n/message.ts";
import type { Job } from "./queue.ts";

/** `new-` + 8 hex: the key `parseCreateRequest` gives a create job until its merge renames it. */
export const isProvisionalKey = (folder: string): boolean => /^new-[0-9a-f]{8}$/.test(folder);

const ENDED = new Set(["failed", "stopped", "interrupted"]);

/** A create that is over and left no spec folder: no merge under way, and either it ended badly or its own merge
 *  failed while the job went on. Cancelled is a person's own choice, not a failure. */
export const createEndedWithoutSpec = (
  job: { specFolder: string; state: string; landing?: boolean; landingError?: unknown },
): boolean =>
  isProvisionalKey(job.specFolder) && !job.landing && (ENDED.has(job.state) || job.landingError !== undefined);

const NO_REASON: BoardMessage = { key: "runner.createEndedNoReason" };

/** Why it ended: the landing's own record wins, because a job that went on to a later step holds a held-back
 *  sentence in `error`. */
export const createFailureReason = (job: Pick<Job, "landingError" | "error">): Sentence | Sentence[] =>
  job.landingError ?? job.error ?? NO_REASON;
