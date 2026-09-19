// The push notifications' own wiring (spec 501): built before the queue
// store, which takes its `observe` on its change hook, and read from the
// store lazily so neither has to wait for the other.
import { createPush, type Push } from "../../push";
import type { Job } from "../../queue/queue.ts";
import type { ServerOptions } from "../options.ts";

export function setupPush(opts: ServerOptions, inputs: { jobs: () => Job[] }): Push {
  return createPush({
    jobs: inputs.jobs,
    subscriptionsPath: opts.pushSubscriptionsPath,
    keyPath: opts.pushKeyPath,
    fetch: opts.pushFetch,
  });
}
