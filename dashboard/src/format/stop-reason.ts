// Which stop reasons `aide-run-spec` writes leave a step to run again.

import { leavesStepUndone } from "../step-endings.ts";

/** Whether a step whose newest run stopped for `reason` is not done,
 *  though an earlier run of it finished: every failed stop, a step the
 *  provider had no room for, an analyze stopped on the acceptance
 *  criteria or on files another open spec shares, and an implement sent
 *  back to a full analysis: each still has to run again. */
export { leavesStepUndone };
