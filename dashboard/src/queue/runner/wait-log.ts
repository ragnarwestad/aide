// Why a queued job waits, written to the server's log once the wait is
// long enough to be worth a line: the hold that keeps it, again when that
// hold changes, and once when the job starts. A hold that writes nothing
// on the row (no free slot, the same spec running) is named too, since
// the log is where such a wait is otherwise invisible.

import { formatSentence } from "../../messages/format.ts";
import type { BoardMessage } from "../../messages/types.ts";
import type { Job } from "../queue.ts";
import type { HoldName } from "./holds.ts";

export const WAIT_LOG_AFTER_MS = 5 * 60_000;

interface Waiting {
  since: number;
  logged?: string;
}

const name = (job: Pick<Job, "id" | "project" | "specFolder">): string =>
  `${job.project}/${job.specFolder} (job ${job.id.slice(0, 8)})`;

const minutes = (ms: number): string => `${Math.round(ms / 60_000)} min`;

export class WaitLog {
  private readonly waiting = new Map<string, Waiting>();

  constructor(private readonly log: (line: string) => void) {}

  /** The job is held this pass, by `hold`. */
  held(job: Job, hold: { name: HoldName; reason?: BoardMessage }, now: string): void {
    const at = Date.parse(now);
    const entry = this.waiting.get(job.id) ?? { since: at };
    this.waiting.set(job.id, entry);
    if (at - entry.since < WAIT_LOG_AFTER_MS) return;
    const why = hold.reason ? `${hold.name}: ${formatSentence("en", hold.reason)}` : hold.name;
    if (entry.logged === why) return;
    entry.logged = why;
    this.log(`queue: ${name(job)} has waited ${minutes(at - entry.since)} — ${why}`);
  }

  /** The job starts; a wait that was logged gets its end logged too. */
  started(job: Job, now: string): void {
    const entry = this.waiting.get(job.id);
    this.waiting.delete(job.id);
    if (entry?.logged) this.log(`queue: ${name(job)} starts after waiting ${minutes(Date.parse(now) - entry.since)}`);
  }

  /** Forget every job not among `queued`: cancelled, removed or started elsewhere. */
  keepOnly(queued: Set<string>): void {
    for (const id of this.waiting.keys()) if (!queued.has(id)) this.waiting.delete(id);
  }
}
