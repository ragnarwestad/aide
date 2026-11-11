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
  };
}
