import type { Job, QueueStore } from "../../../queue/queue.ts";
import { runProjectSuiteBeforePush } from "../test-gate.ts";
import { greenResultsForLand } from "../seen-green.ts";
import { testRepairSession } from "./session.ts";
import type { GateVerdict } from "../test-gate.ts";
import type { GatedJob } from "../seen-green.ts";
export interface RepairRequest { root: string; branch: string; verdict: GateVerdict; job: GatedJob }
export function repairable(verdict: GateVerdict): boolean {
  return !verdict.ok && !verdict.terminalReason && typeof verdict.error === "object" && verdict.error.key === "landing.testsRedOnMerge"
    && !!verdict.failedTests?.length && verdict.failedTests.every((test) => !!test.file);
}
export function repairLanding(run: (request: RepairRequest) => Promise<boolean>) {
  let rounds = 0;
  return async (request: RepairRequest): Promise<boolean> => {
    if (rounds >= 2 || !repairable(request.verdict)) return false;
    rounds++;
    return run(request);
  };
}

export function createLandingGate(queue: QueueStore, scriptDir?: string) {
  const repairs = new Map<string, ReturnType<typeof repairLanding>>();
  return async (root: string, job: Job, branch: string, button: string) => {
    const step = job.steps[job.stepIndex];
    const gatedJob = step === "land" ? greenResultsForLand(job, queue.list()) : job;
    let repair = repairs.get(job.id);
    if (!repair && (step === "land" || step === "archive")) {
      repair = repairLanding(testRepairSession(queue.defaults, job, scriptDir, () => queue.get(job.id)?.state === "cancelled"));
      repairs.set(job.id, repair);
    }
    try {
      const verdict = await runProjectSuiteBeforePush(root, gatedJob, branch, { scriptDir, jobs: () => queue.list(), button, repair });
      if (!verdict.repaired) repairs.delete(job.id);
      return verdict;
    } catch (error) {
      repairs.delete(job.id);
      throw error;
    }
  };
}
