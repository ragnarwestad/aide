// A scheduled job whose own AI or model this board cannot start. Its fire
// would be refused every time, so the fault is shown at the top of every
// page as soon as the configuration holds it, not when the job is due.

import { listedModelName } from "./model-name.ts";
import { providerModelError } from "./providers/parse.ts";
import type { ScheduleEntry } from "./schedule.ts";
import type { QueueDefaults } from "./types.ts";

export interface ScheduleFault {
  project: string;
  name: string;
  problem: string;
}

/** Every enabled entry that names an AI or a model the board cannot start
 *  it on. An entry that names neither runs on the configured defaults. */
export function scheduleFaults(
  projects: Iterable<readonly [string, readonly ScheduleEntry[]]>,
  defaults: Pick<QueueDefaults, "modelChoices" | "providers">,
): ScheduleFault[] {
  const faults: ScheduleFault[] = [];
  for (const [project, entries] of projects) {
    for (const entry of entries) {
      if (!entry.enabled) continue;
      const problem = entryProblem(entry, defaults);
      if (problem) faults.push({ project, name: entry.name, problem });
    }
  }
  return faults;
}

function entryProblem(entry: ScheduleEntry, defaults: Pick<QueueDefaults, "modelChoices" | "providers">): string | null {
  if (entry.provider && !defaults.providers?.[entry.provider]) return `${entry.provider} is not a provider this dashboard offers`;
  if (!entry.model) return null;
  if (!("name" in listedModelName(Object.keys(defaults.modelChoices ?? {}), entry.model))) {
    return `${entry.model} is not a model this dashboard offers`;
  }
  return entry.provider ? providerModelError(defaults, entry.provider, entry.model)?.error ?? null : null;
}
