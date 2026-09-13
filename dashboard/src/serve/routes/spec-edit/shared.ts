// What more than one of the spec's own route families needs.
const STATE_SPEC_FILE = "4-status.json";

/** `4-status.json` beside the `4-status.md` path given. */
export const stateRelPath = (statusRelPath: string): string =>
  statusRelPath.replace(/4-status\.md$/, STATE_SPEC_FILE);

export { STATE_SPEC_FILE };

/** Whether `job` is writing the spec's files right now: its step is
 *  running, or its landing is in flight. A queued job writes nothing
 *  yet — and may be queued precisely for a tick (the acceptance
 *  hold-back), so it must not block one. */
export function specWriteInFlight(job: { state: string; landing?: boolean }): boolean {
  return job.state === "running" || !!job.landing;
}
