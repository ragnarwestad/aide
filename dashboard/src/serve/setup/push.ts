// The push notifications' own wiring: built before the queue
// store, which takes its `observe` on its change hook, and read from the
// store lazily so neither has to wait for the other.
import { createPush, type Push } from "../../push";
import { openSpecCount } from "../../render/pages/specs-list/data-model/spec-state.ts";
import type { SpecTarget } from "../../render/pages/specs-list/data-model/types.ts";
import type { ExecutionGroup } from "../../queue/execution-groups";
import { activeJobCount } from "../../queue/job-rules/active-count.ts";
import { setSpecActivityCounts } from "../../render/ui/running-specs";
import { waitingCount } from "../../push/attention.ts";
import { setWaitingCount } from "../../render/ui/pwa.ts";
import type { Job } from "../../queue/queue.ts";
import { scheduleTrackingKey } from "../../project/spec-names.ts";
import { scheduleNotifyOf } from "../../queue/schedule.ts";
import type { ScheduleStore } from "../../queue/schedule-store.ts";
import type { ServerOptions } from "../options.ts";

export function setupPush(
  opts: ServerOptions,
  inputs: { jobs: () => Job[]; notify: () => void; scheduleStore: ScheduleStore; served: ReadonlySet<string>; targets: () => SpecTarget[]; groups: () => ExecutionGroup[] },
): Push {
  // The one count every page loads with, every live update carries and every
  // push sends for the app's icon.
  const waiting = () => waitingCount(inputs.jobs(), (project) => inputs.served.has(project));
  setWaitingCount(waiting);
  setSpecActivityCounts(() => {
    const jobs = inputs.jobs();
    const groups = inputs.groups();
    const targets = inputs.targets();
    const schedules = new Map<string, Set<string>>();
    return {
      activeJobs: activeJobCount(jobs, groups, (project) => inputs.served.has(project), (project, key) => {
        let keys = schedules.get(project);
        if (!keys) {
          keys = new Set(inputs.scheduleStore.list(project).map(entry => scheduleTrackingKey(entry.name)));
          schedules.set(project, keys);
        }
        return keys.has(key);
      }, (project, specFolder) => targets.some((t) => t.project === project && t.specFolder === specFolder)),
      openSpecs: openSpecCount(targets, jobs, groups),
    };
  });
  return createPush({
    waiting,
    jobs: inputs.jobs,
    subscriptionsPath: opts.pushSubscriptionsPath,
    keyPath: opts.pushKeyPath,
    failedCreatesPath: opts.failedCreatesPath,
    notify: inputs.notify,
    // The entry's own choice, read when a run ends: an edit made while it
    // ran applies to it, and a deleted entry sends nothing.
    scheduleNotify: (project, key) => {
      const entry = inputs.scheduleStore.list(project).find((e) => scheduleTrackingKey(e.name) === key);
      return entry ? scheduleNotifyOf(entry) : null;
    },
    fetch: opts.pushFetch,
  });
}
