import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import type { SpawnResult } from "../../queue/runner";
import type { Job } from "../../queue/queue.ts";
import { cleanupProcesses, type CleanupDependencies } from "./engine.ts";

const writeResult = (file: string, ok: boolean, error?: string): void => {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ok, tool: "none", costMeasured: false, terminalReason: ok ? "completed" : "cleanup-failed", error }));
  renameSync(tmp, file);
};

export const cleanupTranscriptLine = (text: string): string =>
  `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: text.trimEnd() }] } })}\n`;

const running = new Map<string, AbortController>();

export function cancelCleanupJob(jobId: string): void {
  running.get(jobId)?.abort();
}

export function createCleanupJob(deps: CleanupDependencies) {
  return {
    start(job: Job, resultFile: string, streamFile: string): SpawnResult {
      const controller = new AbortController();
      running.set(job.id, controller);
      void cleanupProcesses({ ...deps, cancelled: () => controller.signal.aborted }).then((result) => {
        if (controller.signal.aborted) return;
        appendFileSync(streamFile, cleanupTranscriptLine(result.log));
        writeResult(resultFile, true);
      }).catch((error) => {
        if (!controller.signal.aborted) writeResult(resultFile, false, String(error));
      }).finally(() => running.delete(job.id));
      return { pid: process.pid, pgid: 0 };
    },
  };
}
