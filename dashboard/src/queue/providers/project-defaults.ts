// A project's own model and AI per step, laid over the board's Models per
// phase. Every place that resolves a step for a job or a spec hands the
// existing resolvers this overlaid table, so the order — the spec's own
// pick, the project's choice, the board's step, the board's default model —
// is a property of the table rather than of each resolver.

import type { QueueDefaults } from "../types.ts";
import { PLAN_REVIEW } from "./side-tools.ts";

/** One project's own choices: a model and a provider per step or part. */
export type ProjectModels = NonNullable<QueueDefaults["projectModels"]>[string];

type Tables = Pick<QueueDefaults, "model" | "provider" | "projectModels">;

/** The defaults a job or spec of `project` resolves against: the board's,
 *  with the project's own step entries laid over `model` and `provider`.
 *  The board's own object when the project sets nothing, or `project` is
 *  not a name (a request's field read before it is checked). */
export function forProject<D extends Tables>(defaults: D, project: unknown): D {
  const own = typeof project === "string" ? defaults.projectModels?.[project] : undefined;
  if (!own || (!own.model && !own.provider)) return defaults;
  return {
    ...defaults,
    model: { ...defaults.model, ...own.model },
    provider: { ...defaults.provider, ...own.provider },
  };
}

/** Whether the project's own table names the step's model. */
export function projectSets(defaults: Pick<QueueDefaults, "projectModels">, project: string, step: string): boolean {
  return defaults.projectModels?.[project]?.model?.[step] !== undefined;
}

/** What a step rests on with the project's own entry for it left out: the
 *  "Board default" a card row names. Review under Analyze with no board
 *  entry follows Analyze as this project runs it, the project's choice
 *  included; every other step falls back to the board's default model. */
export function boardChoiceFor(defaults: Tables, project: string, step: string): { model?: string; provider?: string } {
  const pick = (model?: string, provider?: string) => ({ ...(model ? { model } : {}), ...(provider ? { provider } : {}) });
  if (defaults.model[step] !== undefined) return pick(defaults.model[step], defaults.provider?.[step]);
  if (step === PLAN_REVIEW) {
    const own = forProject(defaults, project);
    return pick(own.model.analyze ?? own.model.default, own.provider?.analyze);
  }
  return pick(defaults.model.default);
}
