// The newest model id each choice resolves to, in the sidecar
// `model-ids.json`: what the pickers say an alias gives today. A run records
// the id it ran on; a press of Check, or an Add, records the id Claude Code
// names for a Claude choice, so a choice that never ran shows its version
// too. The newest of them wins. Best effort on disk — a sidecar that cannot
// be read or written leaves the pickers showing the bare alias.
//
// Beside it, `model-names.json` keeps the name Claude Code gave a choice and
// the id it gave it for: `Opus 5.5 (1M context)` for `opus[1m]`, `Sonnet 3.5`
// for `claude-3-5-sonnet-20241022`, which no id pattern can rebuild. A name
// counts only while its id is still the choice's newest, so a run that
// reports another id is read from the id again.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseModelIds, persistPendingModels } from "../persist.ts";

/** The newest record of a choice wins, a run's or a Check's. An empty id
 *  and an unresolved choice record nothing. */
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
  if (path) loadModelNames(path, modelNamesOf(into));
  if (!path || !existsSync(path)) return;
  try {
    const parsed = parseModelIds(JSON.parse(readFileSync(path, "utf-8")) as unknown);
    if (parsed) Object.assign(into, parsed);
  } catch {
    // a corrupt file is not worth crashing over — start empty
  }
}

/** The name Claude Code gave a choice, and the id it gave it for. */
export interface NamedModel {
  id: string;
  name: string;
}

/** Each id table's names, kept beside it rather than on the store, so the
 *  store's own shape does not change for them. */
const NAMES = new WeakMap<Record<string, string>, Record<string, NamedModel>>();

export const modelNamesPath = (idsPath: string): string => join(dirname(idsPath), "model-names.json");

export function modelNamesOf(table: Record<string, string>): Record<string, NamedModel> {
  let names = NAMES.get(table);
  if (!names) {
    names = {};
    NAMES.set(table, names);
  }
  return names;
}

/** Records the name Claude Code gave `choice` for `id`, and `id` as the
 *  choice's newest. */
export function recordModelName(
  path: string | undefined,
  table: Record<string, string>,
  choice: string,
  id: string,
  name: string,
): void {
  recordModelId(path, table, choice, id);
  const names = modelNamesOf(table);
  if (names[choice]?.id === id && names[choice]?.name === name) return;
  names[choice] = { id, name };
  if (path) persistPendingModels(modelNamesPath(path), names);
}

function loadModelNames(path: string, into: Record<string, NamedModel>): void {
  const file = modelNamesPath(path);
  if (!existsSync(file)) return;
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const [choice, entry] of Object.entries(raw as Record<string, unknown>)) {
      const e = entry as Partial<NamedModel> | null;
      if (e && typeof e.id === "string" && e.id && typeof e.name === "string" && e.name) {
        into[choice] = { id: e.id, name: e.name };
      }
    }
  } catch {
    // a corrupt file is not worth crashing over — start empty
  }
}
