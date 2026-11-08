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

export function createCleanupJob(deps: CleanupDependencies) {
  return {
    start(_job: Job, resultFile: string, streamFile: string): SpawnResult {
      void cleanupProcesses(deps).then((result) => {
        appendFileSync(streamFile, cleanupTranscriptLine(result.log));
        writeResult(resultFile, true);
      }).catch((error) => writeResult(resultFile, false, String(error)));
      return { pid: process.pid, pgid: 0 };
    },
  };
}
