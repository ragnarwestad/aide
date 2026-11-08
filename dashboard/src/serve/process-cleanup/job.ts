import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import type { SpawnResult } from "../../queue/runner";
import type { Job } from "../../queue/queue.ts";
import { CLEANUP_OPERATIONS, cleanupProcesses, type CleanupDependencies, type CleanupProgress } from "./engine.ts";

const writeResult = (file: string, ok: boolean, error?: string): void => {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ok, tool: "none", costMeasured: false, terminalReason: ok ? "completed" : "cleanup-failed", error }));
  renameSync(tmp, file);
};

export const cleanupTranscriptLine = (text: string): string =>
  `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: text.trimEnd() }] } })}\n`;

const running = new Map<string, AbortController>();

const cleanupMark = (event: CleanupProgress): string => {
  if (event.state === "detail") return event.text;
  const index = CLEANUP_OPERATIONS.findIndex(({ step }) => step === event.step);
  const operation = CLEANUP_OPERATIONS[index]!;
  const ending = event.state === "skipped" ? "skipped: nothing to stop" : event.state === "stopped" ? `stopped: ${event.text}` : event.state;
  return `--- Step ${index + 1} of ${CLEANUP_OPERATIONS.length}: ${operation.title} — ${ending}`;
};

export function cancelCleanupJob(jobId: string): void {
  running.get(jobId)?.abort();
}

export function createCleanupJob(deps: CleanupDependencies) {
  return {
    start(job: Job, resultFile: string, streamFile: string): SpawnResult {
      const controller = new AbortController();
      running.set(job.id, controller);
      void cleanupProcesses({
        ...deps,
        cancelled: () => controller.signal.aborted,
        progress: (event) => appendFileSync(streamFile, cleanupTranscriptLine(cleanupMark(event))),
      }).then(() => {
        if (controller.signal.aborted) return;
        writeResult(resultFile, true);
      }).catch((error) => {
        if (!controller.signal.aborted) writeResult(resultFile, false, String(error));
      }).finally(() => running.delete(job.id));
      return { pid: process.pid, pgid: 0 };
    },
  };
}
