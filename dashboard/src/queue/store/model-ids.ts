// The newest model id each choice ran on, in the sidecar `model-ids.json`:
// what the pickers say an alias gives today. Best effort on disk — a sidecar
// that cannot be read or written leaves the pickers showing the bare alias.

import { existsSync, readFileSync } from "node:fs";
import { parseModelIds, persistPendingModels } from "../persist.ts";

/** The newest run of a choice wins. An empty id and an unresolved choice
 *  record nothing. */
export function recordModelId(
  path: string | undefined,
  table: Record<string, string>,
  choice: string | undefined,
  modelId: string,
): void {
  if (!choice || !modelId || table[choice] === modelId) return;
  table[choice] = modelId;
  if (path) persistPendingModels(path, table);
}

export function loadModelIds(path: string | undefined, into: Record<string, string>): void {
  if (!path || !existsSync(path)) return;
  try {
    const parsed = parseModelIds(JSON.parse(readFileSync(path, "utf-8")) as unknown);
    if (parsed) Object.assign(into, parsed);
  } catch {
    // a corrupt file is not worth crashing over — start empty
  }
}
