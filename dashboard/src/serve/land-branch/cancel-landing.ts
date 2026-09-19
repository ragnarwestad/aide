// Cancel while a finished step's work is being merged and tested. The
// job reads `done` then — its step ended — and Cancel used to refuse it,
// leaving a suite that had already gone red once to run to its end with
// nothing a person could do (498, 2026-09-19). The scripts a landing
// runs for a job are tracked here by the job's id; Cancel stops them
// and marks the landing, and the landing ends the job `cancelled`.

import { signalGroup } from "../serve-helpers/signal-group.ts";

const running = new Map<string, Set<number>>();
const cancelled = new Set<string>();

/** A script started for this job's landing, in a group of its own. The
 *  first one of a landing also clears a Cancel left from an earlier one. */
export function trackLandingProcess(jobId: string, pid: number): void {
  if (!running.has(jobId)) cancelled.delete(jobId);
  const pids = running.get(jobId) ?? new Set<number>();
  pids.add(pid);
  running.set(jobId, pids);
}

export function untrackLandingProcess(jobId: string, pid: number): void {
  const pids = running.get(jobId);
  if (!pids) return;
  pids.delete(pid);
  if (pids.size === 0) running.delete(jobId);
}

/** Cancel pressed on a job whose landing is under way: its scripts are
 *  stopped, and the landing is told to end the job cancelled. */
export function cancelLanding(jobId: string): void {
  cancelled.add(jobId);
  for (const pid of running.get(jobId) ?? []) signalGroup(pid);
}

/** Whether Cancel was pressed for this job's landing, once: asking clears it. */
export function takeLandingCancel(jobId: string): boolean {
  return cancelled.delete(jobId);
}
