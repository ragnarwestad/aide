import type { QueueStore, WorkflowStep } from "../queue.ts";

interface LandingStep {
  index: number;
  step: WorkflowStep;
  now: () => string;
}

/** Stamp the named result when it is still the same unstamped step. */
export function stampStep(
  store: Pick<QueueStore, "get" | "update">,
  jobId: string,
  landed: LandingStep,
): void {
  const current = store.get(jobId);
  const entry = current?.results[landed.index];
  if (!entry || entry.step !== landed.step || entry.at !== undefined) return;
  const results = [...current.results];
  results[landed.index] = { ...entry, at: landed.now() };
  store.update(jobId, { results });
}

/** Return the flag for the caller's own write and clear it after the
 * landing settles, stamping that step at the same instant when named. */
export function holdLanding(
  store: Pick<QueueStore, "get" | "update">,
  jobId: string,
  work: unknown,
  landed?: LandingStep,
): { patch: { landing: true }; settled: Promise<void> } {
  const settle = (): void => {
    if (landed) stampStep(store, jobId, landed);
    store.update(jobId, { landing: undefined });
  };
  const settled = Promise.resolve(work).then(settle, settle);
  return { patch: { landing: true }, settled };
}
