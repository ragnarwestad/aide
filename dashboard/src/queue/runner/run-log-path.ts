// A step's run log: what `aide-run-spec` writes to stderr, kept beside the
// step's transcript. The write side (the spawn) and the read side
// (`jobDetailView`) import this file, so the two cannot disagree about the name.
import { writeFileSync } from "node:fs";

export const RUN_LOG_MAX_BYTES = 1024 * 1024;

/** `<job id>.<step>.stream.jsonl` gives `<job id>.<step>.run.log`. */
export const runLogPath = (streamFile: string): string => `${streamFile.replace(/\.stream\.jsonl$/, "")}.run.log`;

/** Empty the step's log and open it for the spawn: Bun writes from byte 0
 *  without truncating, so a shorter log would end in the tail of an earlier one. */
export function openRunLog(streamFile: string): ReturnType<typeof Bun.file> {
  const path = runLogPath(streamFile);
  writeFileSync(path, "");
  return Bun.file(path);
}
