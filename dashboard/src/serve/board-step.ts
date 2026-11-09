import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import type { Sentence } from "../i18n/message.ts";
import { formatRunLogLine } from "../queue/parse-stream/step-log.ts";
import { stepMarkLine } from "../queue/parse-stream/step-marks.ts";
import { runLogPath } from "../queue/runner/run-log-path.ts";

function writeResult(file: string, result: Record<string, unknown>): void {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(result));
  renameSync(temporary, file);
}

export function boardStep(options: { resultFile: string; streamFile: string; startedAt?: string }) {
  const started = Date.parse(options.startedAt ?? new Date().toISOString());
  const write = (text: string, error = false): void => {
    const now = new Date();
    const seconds = Math.max(0, Math.floor((now.getTime() - started) / 1000));
    appendFileSync(runLogPath(options.streamFile), `${formatRunLogLine(now.toTimeString().slice(0, 8), seconds, text, error)}\n`);
  };
  return {
    mark(place: string, title: string, ending: string): void {
      write(stepMarkLine(place, title, ending), ending.startsWith("stopped"));
    },
    note(text: string): void { write(text); },
    done(): void {
      writeResult(options.resultFile, { ok: true, tool: "none", costMeasured: false, terminalReason: "completed" });
    },
    failed(terminalReason: string, error: string, sentence?: Sentence): void {
      writeResult(options.resultFile, {
        ok: false, tool: "none", costMeasured: false, terminalReason, error, ...(sentence ? { sentence } : {}),
      });
    },
  };
}
