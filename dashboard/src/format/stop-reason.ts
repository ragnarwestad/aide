// Which stop reasons `aide-run-spec` writes mean the step itself failed.
//
// A commit subject carries the reason a step stopped (`(stopped: <reason>)`),
// and a phase read from history alone has only that to go on. `timeout`,
// `provider-limit`, `acceptance-criteria`, `shared-files` and a cancel are the queue's own
// stops and stay amber; `refused` is the runner declining before any model
// ran. A reason nobody has listed here reads as a stop, as before.

import {
  STEP_ENDINGS,
  isFailedEnding,
  leavesStepUndone,
} from "../step-endings.ts";

export const FAILED_STOPS: readonly string[] = STEP_ENDINGS
  .filter(({ failure }) => failure)
  .map(({ name }) => name);

export const isFailedStop = isFailedEnding;

/** Whether a step whose newest run stopped for `reason` is not done,
 *  though an earlier run of it finished: every failed stop, a step the
 *  provider had no room for, an analyze stopped on the acceptance
 *  criteria or on files another open spec shares, and an implement sent
 *  back to a full analysis, which read Stopped but still have to run
 *  again. */
export { leavesStepUndone };
