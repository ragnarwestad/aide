// Whether a queued job may start as far as its dependencies go.
//
// The dependency answer is worked out before a tick, and asking origin
// takes time: a job queued while it was being asked is not in it. Read
// as "nothing to wait for", such a job started and was refused by
// `aide-run-spec` instead of being held. So the answer names the jobs it
// looked at, and a job it did not look at waits for the next tick.

/** The dependency each held job waits on, by job id, and every job id
 *  the answer looked at. */
export type DependencyHolds = Map<string, string> & { checked?: ReadonlySet<string> };

/** The job waits a tick without a reason of its own: the answer did not look at it. */
export const NOT_CHECKED = Symbol("not checked");

export function dependencyHold(holds: DependencyHolds | undefined, jobId: string): string | typeof NOT_CHECKED | undefined {
  const dependency = holds?.get(jobId);
  if (dependency !== undefined) return dependency;
  return holds?.checked && !holds.checked.has(jobId) ? NOT_CHECKED : undefined;
}
