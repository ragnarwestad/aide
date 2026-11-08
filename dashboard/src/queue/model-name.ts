import type { Job } from "./queue.ts";

/** The listed spelling of a model name: what the queue config offers, or
 *  the several listed spellings that differ from it only in case. */
export type ListedModel = { name: string } | { candidates: string[] };

/** An exact match wins; otherwise a single case-only match resolves to its
 *  listed spelling. Several case-only matches are a guess, so they come
 *  back as `candidates` for the caller to name in a refusal. */
export function listedModelName(names: readonly string[], name: string): ListedModel {
  if (names.includes(name)) return { name };
  const same = names.filter((n) => n.toLowerCase() === name.toLowerCase());
  return same.length === 1 ? { name: same[0]! } : { candidates: same };
}

/** The choice a step runs on: the job's own pick for it, else the job's
 *  whole-job pick, else the config's per-step default, else its default.
 *  Here rather than beside the argv so the runner can name the choice a
 *  step ran on without importing from `serve/`. */
export function resolveStepModel(job: Job, step: string, live: Record<string, string>): string | undefined {
  return job.model[step] ?? job.modelChoice ?? live[step] ?? live.default;
}
