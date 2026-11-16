// A group moving on once one member's step has ended: the runner queues the
// next member by position, or else leaves the group waiting for Archive. The
// move waits for the board's first specs sweep, before which no spec's done
// steps are known.

import { specFolders, type SpecRef } from "../../project/discover";
import { enqueueRequest, followOnRequest, withRowPicks } from "../request/index.ts";
import type { QueueStore } from "../store/index.ts";
import type { Job } from "../types.ts";
import type { WorkflowStep } from "../steps.ts";

/** The member after `current` in its group, by position. */
export function nextGroupMember(specs: readonly SpecRef[], current: string): SpecRef | undefined {
  const at = specs.find((spec) => spec.folder === current);
  if (!at?.group) return undefined;
  return specs
    .filter((spec) => spec.group?.name === at.group!.name && spec.group.position > at.group!.position)
    .sort((a, b) => a.group!.position - b.group!.position || a.folder.localeCompare(b.folder))[0];
}

export interface GroupMove {
  store: QueueStore;
  job: Job;
  step: WorkflowStep;
  /** The project's specs root, where the members are read; absent, there is no next member. */
  specsRoot: string | undefined;
  /** Runs `next` once the board's first specs sweep has finished, at once after it. */
  whenSpecsScanned: (next: () => void) => void;
  log: (what: string, spec: string, why: string) => void;
}

/** A member's step ended `completed`: record it, then, once the first specs
 *  sweep has finished, queue the next member on the finished job's Analyze and
 *  Implement, or leave the group waiting for Archive (after Implement) or
 *  stopped. A group already stopped when the step ends moves on no further. */
export function moveGroupOn({ store, job, step, specsRoot, whenSpecsScanned, log }: GroupMove): void {
  const group = job.executionGroupId ? store.executionGroups.get(job.executionGroupId) : undefined;
  if (group && step === "implement") {
    store.executionGroups.update(group.id, { completedMembers: [...new Set([...group.completedMembers, job.specFolder])] });
  }
  if (group?.state === "stopped") return;
  whenSpecsScanned(() => {
    if (queueNextMember(store, job, specsRoot, log) || !group) return;
    if (step === "implement") store.executionGroups.waitForAcceptance(group.id);
    else store.executionGroups.stop(group.id);
  });
}

function queueNextMember(store: QueueStore, job: Job, specsRoot: string | undefined, log: GroupMove["log"]): boolean {
  if (!specsRoot) return false;
  const next = nextGroupMember(specFolders(specsRoot, false), job.specFolder);
  if (!next) return false;
  const steps = job.steps?.filter((step) => step === "analyze" || step === "implement") ?? ["analyze", "implement"];
  const group = job.executionGroupId ? store.executionGroups.get(job.executionGroupId) : undefined;
  const request = group?.sharedChoices
    ? followOnRequest(job.project, next.folder, steps, job)
    : withRowPicks({ project: job.project, specFolder: next.folder, steps, executionGroupId: job.executionGroupId }, store);
  const made = enqueueRequest(store, request, "automatic");
  if (!made.ok) log("group continuation", `${job.project}/${next.folder}`, made.error);
  return made.ok;
}
