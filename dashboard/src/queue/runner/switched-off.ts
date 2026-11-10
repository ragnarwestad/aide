// A step whose provider is switched off in Settings → Providers waits on
// the queue until the provider is switched on again, or the step is given
// another provider. Worked out from the jobs each tick, like the usage-limit
// holds, so switching the provider on is all it takes.

import type { BoardMessage } from "../../messages/types.ts";
import { type Job } from "../queue.ts";
import { requireWorkflowStep } from "../../workflow-steps.ts";
import { switchedOff, type Provider } from "../providers/index.ts";
import type { ProviderOf } from "./usage-limit.ts";

/** The queued jobs whose current step runs on a switched-off provider, with
 *  the sentence each is held with. */
export function switchedOffHolds(
  jobs: readonly Job[],
  providerOf: ProviderOf,
  providers: Record<string, Provider> | undefined,
): Map<string, BoardMessage> {
  const held = new Map<string, BoardMessage>();
  for (const job of jobs) {
    if (job.state !== "queued" || job.landing) continue;
    if (requireWorkflowStep(job.steps[job.stepIndex] ?? "").runBy === "board") continue;
    const key = providerOf(job);
    if (switchedOff(key, providers)) held.set(job.id, { key: "runner.providerSwitchedOff", values: { provider: providers![key]!.name } });
  }
  return held;
}
