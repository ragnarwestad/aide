import type { ParseResult } from "../parse-request.ts";
import type { QueueStore } from "../store/index.ts";
import type { Job } from "../types.ts";
import { PLAN_REVIEW, SIDE_PARTS_OF, planReviewToSave } from "../providers/side-tools.ts";

export type RequestOrigin = "manual" | "automatic";

type JobQueue = Pick<QueueStore, "enqueue" | "update">;
type CreateQueue = Pick<QueueStore, "enqueueCreate"> & Partial<Pick<QueueStore, "update">>;

function markManual(queue: Partial<Pick<QueueStore, "update">>, result: ParseResult, origin: RequestOrigin): ParseResult {
  if (result.ok && origin === "manual") {
    if (!queue.update) throw new Error("a manual queue request requires update support");
    queue.update(result.job.id, { pressed: true });
  }
  return result;
}

export function enqueueRequest(queue: JobQueue, raw: unknown, origin: RequestOrigin): ParseResult {
  return markManual(queue, queue.enqueue(raw), origin);
}

export function enqueueCreateRequest(queue: CreateQueue, raw: unknown, origin: RequestOrigin): ParseResult {
  return markManual(queue, queue.enqueueCreate(raw), origin);
}

/** A job that runs `steps`, on the choices `from` would have used. */
export function followOnRequest(
  project: string,
  specFolder: string,
  steps: string[],
  from: Job | undefined,
): Record<string, unknown> {
  if (!from) return { project, specFolder, steps };
  const forSteps = (map: Record<string, string> | undefined): Record<string, string> =>
    Object.fromEntries(steps.filter((step) => map?.[step]).map((step) => [step, map![step]!]));
  return {
    project,
    specFolder,
    steps,
    model: forSteps(from.model),
    provider: forSteps(from.provider),
    effort: forSteps(from.effort),
    executionGroupId: from.executionGroupId,
  };
}

/** The choices a group's Run request writes to every member's own row. */
export function groupRowPicks(
  posted: Record<string, unknown>,
  job: Pick<Job, "steps" | "model" | "provider">,
): { part: string; model: string; provider?: string }[] {
  const postedModels = typeof posted.model === "object" && posted.model !== null
    ? posted.model as Record<string, unknown>
    : undefined;
  const picks: { part: string; model: string; provider?: string }[] = [];
  for (const step of job.steps) {
    if ((typeof posted.model === "string" || typeof postedModels?.[step] === "string") && job.model[step]) {
      picks.push({ part: step, model: job.model[step]!, provider: job.provider?.[step] });
    }
    for (const part of SIDE_PARTS_OF[step] ?? []) {
      if (typeof postedModels?.[part] !== "string" || !job.model[part]) continue;
      if (part === PLAN_REVIEW) {
        const saved = planReviewToSave(
          { model: job.model[part]!, provider: job.provider?.[part] },
          { model: job.model[step]!, provider: job.provider?.[step] },
          { model: job.model[step]!, provider: job.provider?.[step] },
          true,
        );
        picks.push(saved
          ? { part, model: saved.model, provider: saved.provider }
          : { part, model: "", provider: undefined });
      } else {
        picks.push({ part, model: job.model[part]!, provider: job.provider?.[part] });
      }
    }
  }
  return picks;
}

/** `request` on the models picked on its spec's own row, for the steps it
 *  runs: a row's pick wins over the model the request already names, and
 *  brings the provider picked beside it, or none. */
export function withRowPicks<T extends Record<string, unknown>>(
  request: T,
  picks: Pick<QueueStore, "pendingModels" | "pendingProviders">,
): T & { model: Record<string, string>; provider: Record<string, string> } {
  const key = `${String(request.project)}/${String(request.specFolder)}`;
  const models = picks.pendingModels[key] ?? {};
  const providers = picks.pendingProviders[key] ?? {};
  const given = request as { model?: Record<string, string>; provider?: Record<string, string> };
  const model = { ...given.model };
  const provider = { ...given.provider };
  for (const step of request.steps as string[]) {
    if (!models[step]) continue;
    model[step] = models[step];
    if (providers[step]) provider[step] = providers[step];
    else delete provider[step];
  }
  return { ...request, model, provider };
}
