// The push notifications' own wiring (spec 501): built before the queue
// store, which takes its `observe` on its change hook, and read from the
// store lazily so neither has to wait for the other.
import { createPush, type Push } from "../../push";
import type { Job } from "../../queue/queue.ts";
import { scheduleNotifyOf, scheduleTrackingKey } from "../../queue/schedule.ts";
import type { ScheduleStore } from "../../queue/schedule-store.ts";
import type { ServerOptions } from "../options.ts";

export function setupPush(opts: ServerOptions, inputs: { jobs: () => Job[]; notify: () => void; scheduleStore: ScheduleStore }): Push {
  return createPush({
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
