import type { SpawnResult } from "../../queue/runner";
import type { Job } from "../../queue/queue.ts";
import { t } from "../../i18n";
import { boardStep } from "../board-step.ts";
import { CLEANUP_OPERATIONS, cleanupProcesses, type CleanupDependencies, type CleanupProgress } from "./engine.ts";

const running = new Map<string, AbortController>();

const cleanupMark = (event: CleanupProgress): { place?: string; title?: string; ending?: string; note?: string } => {
  if (event.state === "detail") return { note: event.text };
  const index = CLEANUP_OPERATIONS.findIndex(({ step }) => step === event.step);
  const operation = CLEANUP_OPERATIONS[index]!;
  const ending = event.state === "skipped" ? "skipped: nothing to stop" : event.state === "stopped" ? `stopped: ${event.text}` : event.state;
  return { place: `${index + 1} of ${CLEANUP_OPERATIONS.length}`, title: t("en", operation.label), ending };
};

export function cancelCleanupJob(jobId: string): void {
  running.get(jobId)?.abort();
}

export function createCleanupJob(deps: CleanupDependencies) {
  return {
    start(job: Job, resultFile: string, streamFile: string): SpawnResult {
      const controller = new AbortController();
      const output = boardStep({ resultFile, streamFile, startedAt: new Date(deps.now()).toISOString() });
      running.set(job.id, controller);
      void cleanupProcesses({
        ...deps,
        cancelled: () => controller.signal.aborted,
        progress: (event) => {
          const line = cleanupMark(event);
          if (line.note) output.note(line.note);
          else output.mark(line.place!, line.title!, line.ending!);
        },
      }).then(() => {
        if (controller.signal.aborted) return;
        output.done();
      }).catch((error) => {
        if (!controller.signal.aborted) output.failed("cleanup-failed", String(error));
      }).finally(() => running.delete(job.id));
      return { pid: process.pid, pgid: 0 };
    },
  };
}
