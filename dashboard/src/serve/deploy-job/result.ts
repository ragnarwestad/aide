// The result file a deploy job leaves for the runner, which reads it as it
// reads any step's: `aide-run-spec`'s shape, with `tool: none` since no model
// ran and `costMeasured: false` since nothing was spent.

import { renameSync, writeFileSync } from "node:fs";
import { renderSentence, type Sentence } from "../../i18n/message.ts";

/** Whole or not at all: the runner reads the file while it is written. */
function write(file: string, result: Record<string, unknown>): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(result));
  renameSync(tmp, file);
}

export const writeDeployDone = (file: string): void =>
  write(file, { ok: true, tool: "none", costMeasured: false, terminalReason: "completed" });

/** A failed deploy: `sentence` is what the row reads in the reader's language,
 *  `error` the same in English, which the row keeps as hover detail. */
export function writeDeployFailed(file: string, sentence: Sentence): string {
  const error = renderSentence("en", sentence) ?? "";
  write(file, { ok: false, tool: "none", costMeasured: false, terminalReason: "deploy-failed", error, sentence });
  return error;
}
