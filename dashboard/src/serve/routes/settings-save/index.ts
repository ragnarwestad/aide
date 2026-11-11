import {
  mergeQueueDefaults, persistQueueSettingsResult, type QueueSettingsUpdate,
} from "../../../queue/queue.ts";
import { parseQueueConcurrency, QUEUE_DEFAULTS } from "../../serve-helpers/config.ts";
import type { RoutesContext } from "../index.ts";

/** Persist one partial update, then apply the complete saved result exactly as startup does. */
export function saveQueueSettings(ctx: RoutesContext, update: QueueSettingsUpdate): string | null {
  const file = ctx.opts.queueConfigFile;
  if (!file) return "this server has no queue config file";
  const result = persistQueueSettingsResult(file, update);
  if ("error" in result) return result.error;

  const effective = mergeQueueDefaults(QUEUE_DEFAULTS, result.value);
  for (const key of Object.keys(ctx.queue.defaults)) {
    delete ctx.queue.defaults[key as keyof typeof ctx.queue.defaults];
  }
  Object.assign(ctx.queue.defaults, effective);
  ctx.runner?.setConcurrency(parseQueueConcurrency(result.value.concurrency));
  return null;
}
