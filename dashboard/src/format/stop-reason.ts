// Which stop reasons `aide-run-spec` writes mean the step itself failed.
//
// A commit subject carries the reason a step stopped (`(stopped: <reason>)`),
// and a phase read from history alone has only that to go on. `timeout`,
// `provider-limit`, `acceptance-criteria` and a cancel are the queue's own
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
];

export const isFailedStop = (reason: string | undefined): boolean =>
  reason !== undefined && FAILED_STOPS.includes(reason);

/** Whether a step whose newest run stopped for `reason` is not done,
 *  though an earlier run of it finished: every failed stop, and an
 *  analyze stopped on the acceptance criteria, which reads Stopped but
 *  still has to run again. */
export const leavesStepUndone = (reason: string | undefined): boolean =>
  isFailedStop(reason) || reason === "acceptance-criteria";
