import type { ParseResult } from "../parse-request.ts";
import type { QueueStore } from "../store/index.ts";
import type { Job } from "../types.ts";

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
