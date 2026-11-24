// Settings' Process tab: how many steps the queue may run at once. The
// file is written first and the running queue changed only once the
// write succeeded, the order the models-and-timeouts save follows; the
// runner reads the count on every tick, so the next step it starts is
// the first to use it. No tick is run from here: one waits on a fetch
// per project with a queued job, which would hold the Save press, and
// the runner's own timer ticks anyway.
import {
  QUEUE_CONCURRENCY_MAX, QUEUE_CONCURRENCY_MIN, isQueueConcurrency, json, readObjectBody,
} from "../serve-helpers";
import type { RoutesContext } from "./";
import { saveQueueSettings } from "./settings-save/index.ts";

export const SETTINGS_CONCURRENCY_ROUTE = "/api/queue/settings/concurrency";

export async function handleSettingsConcurrencyRoute(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  if (path !== SETTINGS_CONCURRENCY_ROUTE) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sent = await readObjectBody(req);
  if ("refusal" in sent) return sent.refusal;
  const refuse = (error: string) => json({ error }, 400);
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  if (!ctx.runner) return refuse("this server runs no queue");
  const asked = sent.body.concurrency;
  if (!isQueueConcurrency(asked)) {
    return refuse(
      `How many steps may run at once must be a whole number from ${QUEUE_CONCURRENCY_MIN} to ${QUEUE_CONCURRENCY_MAX}`,
    );
  }
  const error = saveQueueSettings(ctx, { concurrency: asked });
  if (error) return refuse(error);
  return json({ ok: true, concurrency: asked });
}
