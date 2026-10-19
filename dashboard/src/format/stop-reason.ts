// Which stop reasons `aide-run-spec` writes mean the step itself failed.
//
// A commit subject carries the reason a step stopped (`(stopped: <reason>)`),
// and a phase read from history alone has only that to go on. `timeout`,
// `provider-limit`, `acceptance-criteria`, `shared-files` and a cancel are the queue's own
// stops and stay amber; `refused` is the runner declining before any model
// ran. A reason nobody has listed here reads as a stop, as before.

/** The reasons the script writes after the AI's turn, or after its own
 *  check of what the turn left, that end a step failed. */
export const FAILED_STOPS: readonly string[] = [
  "cli-error",
  "model-refused",
  "no-progress",
  "scope-violation",
  "merge-unfinished",
  "tests-red",
  "unpushed",
  "short-analysis-over-limit",
];

export const isFailedStop = (reason: string | undefined): boolean =>
  reason !== undefined && FAILED_STOPS.includes(reason);

/** Whether a step whose newest run stopped for `reason` is not done,
 *  though an earlier run of it finished: every failed stop, a step the
 *  provider had no room for, and an analyze stopped on the acceptance
 *  criteria or on files another open spec shares, which read Stopped but
 *  still have to run again. */
export const leavesStepUndone = (reason: string | undefined): boolean =>
  isFailedStop(reason) || reason === "model-at-capacity" || reason === "acceptance-criteria" || reason === "shared-files";
