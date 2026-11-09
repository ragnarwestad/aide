// What more than one of the spec's own route families needs.
import type { Job } from "../../../queue/types.ts";
import { dirname, join } from "node:path";
import { STATE_FILE } from "../../../project/spec-names.ts";

/** The state file beside the status file path given. */
export const stateRelPath = (statusRelPath: string): string => join(dirname(statusRelPath), STATE_FILE);

/** Whether `job` is writing the spec's files right now: its step is
 *  running, or its landing is in flight. A queued job writes nothing
 *  yet — and may be queued precisely for a tick (the acceptance
 *  hold-back), so it must not block one. */
/** A job that runs `steps`, on the models and effort `from` would have run
 *  them with. The timeouts are not carried: a job takes those from
 *  Settings. */
export function followOnJob(
  project: string,
  specFolder: string,
  steps: string[],
  from: Job | undefined,
): Record<string, unknown> {
  if (!from) return { project, specFolder, steps };
  const forSteps = (map: Record<string, string> | undefined): Record<string, string> =>
    Object.fromEntries(steps.filter((s) => map?.[s]).map((s) => [s, map![s]!]));
  return { project, specFolder, steps, model: forSteps(from.model), effort: forSteps(from.effort) };
}
