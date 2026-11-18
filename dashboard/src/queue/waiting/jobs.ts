import { join, dirname } from "node:path";
import { WaitingQueue, type WaitingEntry } from "./index.ts";
import type { QueueStore } from "../store/index.ts";
import type { Job } from "../types.ts";
import { formatSentence } from "../../messages/format.ts";
import { seedOrder } from "./order.ts";
import type { MarkState } from "../parse-stream/step-marks.ts";
import { usageLimitStopSuperseded } from "../runner/usage-limit.ts";

export function waitingKey(job: Job): string {
  return job.executionGroupId && job.steps[job.stepIndex] === "archive" ? `group:${job.executionGroupId}:archive` : job.executionGroupId
    ? `group:${job.executionGroupId}:${job.specFolder}:${job.steps[job.stepIndex]}`
    : `job:${job.id}:${job.stepIndex}`;
}
export function jobEntry(job: Job): WaitingEntry {
  return { id: waitingKey(job), jobId: job.id, groupId: job.steps[job.stepIndex] === "archive" ? job.executionGroupId : undefined, project: job.project,
    label: job.createTitle ?? job.branch ?? job.specFolder, operation: job.steps[job.stepIndex] ?? "",
    reason: formatSentence("en", job.error) ?? (job.results.at(-1)?.terminalReason === "acceptance-criteria-unticked" ? "Waiting for acceptance criteria to be checked" : job.landing ? "Waiting for this job's merge" : "") };
}
const archiveChecks = new WeakMap<QueueStore, Set<string>>();

/** Called after the runner has ended archives with open acceptance. */
export function validateWaitingArchives(store: QueueStore): void {
  const checked = archiveChecks.get(store)!;
  for (const job of store.list()) {
    if (job.state === "queued" && !job.landing && !job.landingCut && job.steps[job.stepIndex] === "archive") checked.add(waitingKey(job));
  }
}

export function createWaiting(store: QueueStore, mirrorPath?: string): WaitingQueue {
  const checked = new Set<string>();
  const unresolved = new Set<string>();
  const running = new Set<string>();
  archiveChecks.set(store, checked);
  const waiting: WaitingQueue = new WaitingQueue({
    path: mirrorPath ? join(dirname(mirrorPath), "waiting-order.json") : undefined,
    retainAbsent: id => running.has(id) || unresolved.has(id) || (!id.startsWith("job:") && !id.startsWith("group:")),
    refresh: () => {
      const jobs = store.list();
      running.clear();
      for (const job of jobs) if (job.state === "running" && !job.landing && !job.landingCut) running.add(waitingKey(job));
      const archives = new Set(jobs.filter(j => j.state === "queued" && !j.landing && !j.landingCut && j.steps[j.stepIndex] === "archive").map(waitingKey));
      for (const id of checked) if (!archives.has(id)) checked.delete(id);
      unresolved.clear();
      for (const id of archives) if (!checked.has(id)) unresolved.add(id);
      const pending = (waiting.established ? [...jobs].reverse() : seedOrder([...jobs].reverse())).filter(j =>
        (j.state === "queued" && !j.landing && !j.landingCut && !unresolved.has(waitingKey(j))) ||
        (j.state === "stopped" && !!j.usageLimitWait && !usageLimitStopSuperseded(jobs, j)) ||
        ((j.state === "done" || j.state === "stopped") && j.results.at(-1)?.terminalReason === "approach-choice" &&
          !jobs.some(other => other.id !== j.id && other.project === j.project && other.specFolder === j.specFolder && Date.parse(other.createdAt) >= Date.parse(j.createdAt))));
      return pending.map(jobEntry);
    },
  });
  waiting.snapshot();
  return waiting;
}

/** Group summaries read the same admitted work as the editor. */
export function waitingGroups(store: QueueStore) {
  const entries = store.waiting.snapshot().entries;
  return store.executionGroups.list().map(group => {
    const index = entries.findIndex(entry => entry.groupId === group.id);
    const prefix = `group:${group.id}:`;
    const queuedMembers = group.members.filter((member) => entries.some((entry) => entry.id.startsWith(`${prefix}${member}:`)));
    return { ...group, queuedMembers, queuePosition: index < 0 ? undefined : { id: entries[index]!.id, n: index + 1, total: entries.length, reason: entries[index]!.reason, operation: entries[index]!.operation } };
  });
}

/** A job's steps with a started one queued while the queue holds the job's
 *  merge waiting for the repository's lock: the merge step marks itself
 *  started before it asks for the lock. */
export function queuedWhileMergeWaits<T extends { state?: MarkState }>(steps: T[], waiting: WaitingQueue | undefined, jobId: string): T[] {
  const waits = [...(waiting?.pending.values() ?? [])].some((entry) => entry.jobId === jobId && entry.id.startsWith("merge:"));
  const queuedStepState: MarkState = "queued";
  return waits ? steps.map((step) => (step.state === "running" ? { ...step, state: queuedStepState } : step)) : steps;
}
