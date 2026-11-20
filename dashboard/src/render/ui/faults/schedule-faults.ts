// The scheduled jobs the board cannot start, read by `headerNotices()` on
// every page. `serve.ts` hands over where the entries and the defaults
// are, and both are read as they are now, so a fixed entry leaves the
// notice on the next page.

import { scheduleFaults, type ScheduleFault } from "../../../queue/schedule-faults.ts";
import type { ScheduleEntry } from "../../../queue/schedule.ts";
import type { QueueDefaults } from "../../../queue/types.ts";

let source: (() => ScheduleFault[]) | undefined;

export function watchScheduleFaults(o: {
  projects: () => Iterable<string>;
  entries: (project: string) => readonly ScheduleEntry[];
  defaults: () => Pick<QueueDefaults, "modelChoices" | "providers">;
}): void {
  source = () => scheduleFaults([...o.projects()].map((project) => [project, o.entries(project)] as const), o.defaults());
}

export function currentScheduleFaults(): ScheduleFault[] {
  try {
    return source?.() ?? [];
  } catch {
    return [];
  }
}
