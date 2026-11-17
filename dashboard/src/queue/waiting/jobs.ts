import { join, dirname } from "node:path";
import { WaitingQueue, type WaitingEntry } from "./index.ts";
import type { QueueStore } from "../store/index.ts";
import type { Job } from "../types.ts";
import { formatSentence } from "../../messages/format.ts";
import { seedOrder } from "./order.ts";

export function waitingKey(job: Job): string {
  return job.executionGroupId && job.steps[job.stepIndex] === "archive" ? `group:${job.executionGroupId}:archive` : job.executionGroupId
    ? `group:${job.executionGroupId}:${job.specFolder}:${job.steps[job.stepIndex]}`
    : `job:${job.id}:${job.stepIndex}`;
}
export function jobEntry(job: Job): WaitingEntry {
  return { id: waitingKey(job), jobId: job.id, project: job.project,
    label: job.createTitle ?? job.branch ?? job.specFolder, operation: job.steps[job.stepIndex] ?? "",
    reason: formatSentence("en", job.error) ?? (job.results.at(-1)?.terminalReason === "acceptance-criteria-unticked" ? "Waiting for acceptance criteria to be checked" : job.landing ? "Waiting for this job's merge" : "") };
}
export function createWaiting(store: QueueStore, mirrorPath?: string): WaitingQueue {
  const waiting: WaitingQueue = new WaitingQueue({
    path: mirrorPath ? join(dirname(mirrorPath), "waiting-order.json") : undefined,
    refresh: () => {
      const jobs = store.list();
      const pending = (waiting.established ? [...jobs].reverse() : seedOrder([...jobs].reverse())).filter(j => j.state === "queued" || (j.state === "stopped" && !!j.usageLimitWait) || ((j.state === "done" || j.state === "stopped") && ["acceptance-criteria-unticked", "approach-choice"].includes(j.results.at(-1)?.terminalReason ?? "") && !jobs.some(other => other.id !== j.id && other.project === j.project && other.specFolder === j.specFolder && Date.parse(other.createdAt) >= Date.parse(j.createdAt))));
      const entries = pending.map(jobEntry);
      for (const job of jobs.filter(job => job.state === "running" || job.state === "queued")) {
        for (let index = job.stepIndex + 1; index < job.steps.length; index++) {
          const future = jobEntry({ ...job, stepIndex: index });
          entries.push({ ...future, reason: "Waiting for the previous step" });
        }
      }
      for (const group of store.executionGroups.list()) {
        if (group.removedAt || !["queued", "running", "archiving", "waiting-acceptance"].includes(group.state)) continue;
        if (group.state === "waiting-acceptance") {
          entries.push({ id: `group:${group.id}:archive`, groupId: group.id, project: group.project,
            label: group.displayName ?? group.name, operation: "archive", reason: "Waiting for acceptance criteria to be checked" });
        }
        for (const member of group.members) {
          if (group.completedMembers.includes(member)) continue;
          const steps = group.memberSteps?.[member] ?? ["analyze", "implement"];
          if (jobs.some(j => j.executionGroupId === group.id && j.specFolder === member)) continue;
          for (const step of steps) entries.push({ id: `group:${group.id}:${member}:${step}`, project: group.project,
            label: `${group.displayName ?? group.name} / ${member}`, operation: step, reason: "Waiting for the previous group member" });
        }
      }
      return entries;
    },
  });
  return waiting;
}

/** Group summaries read the same global position as the editor, even without a queued job. */
export function waitingGroups(store: QueueStore) {
  const entries = store.waiting.snapshot().entries;
  return store.executionGroups.list().map(group => {
    const index = entries.findIndex(entry => entry.groupId === group.id);
    const prefix = `group:${group.id}:`;
    const queuedMembers = group.members.filter((member) => entries.some((entry) => entry.id.startsWith(`${prefix}${member}:`)));
    return { ...group, queuedMembers, queuePosition: index < 0 ? undefined : { id: entries[index]!.id, n: index + 1, total: entries.length, reason: entries[index]!.reason, operation: entries[index]!.operation } };
  });
}
