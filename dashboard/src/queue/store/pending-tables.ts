// The choices a reader made for a spec before any job exists, on disk: the
// model picked per phase and the phases ticked. A file that cannot be read
// leaves the table empty; one that cannot be written keeps it in memory.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parsePendingModels,
  parsePendingSteps,
  persistPendingModels,
} from "../persist.ts";

function loadTable<T extends object>(
  path: string | undefined,
  parse: (raw: unknown) => T | null | undefined,
  into: T,
): void {
  if (!path || !existsSync(path)) return;
  try {
    const parsed = parse(JSON.parse(readFileSync(path, "utf-8")) as unknown);
    if (parsed) Object.assign(into, parsed);
  } catch {
    // a corrupt file is not worth crashing over — start empty
  }
}

export const loadPendingModels = (
  path: string | undefined,
  into: Record<string, Record<string, string>>,
): void => loadTable(path, parsePendingModels, into);

export const loadPendingSteps = (
  path: string | undefined,
  into: Record<string, string[]>,
): void => loadTable(path, parsePendingSteps, into);

export function savePendingTable(
  path: string | undefined,
  table: Record<string, unknown>,
): void {
  if (path) persistPendingModels(path, table);
}

/** Where the providers picked beside the pending models are kept: a file of
 *  its own beside `pending-models.json`, so nothing that hands the store
 *  its paths has to know about it. */
export const pendingProvidersPath = (
  modelsPath: string | undefined,
): string | undefined =>
  modelsPath ? join(dirname(modelsPath), "pending-providers.json") : undefined;
