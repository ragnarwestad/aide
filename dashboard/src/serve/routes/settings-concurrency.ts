// Settings' Process tab: how many steps the queue may run at once. The
// file is written first and the running queue changed only once the
// write succeeded, the order the models-and-timeouts save follows; the
// runner reads the count on every tick, so the next step it starts is
// the first to use it. No tick is run from here: one waits on a fetch
// per project with a queued job, which would hold the Save press, and
// the runner's own timer ticks anyway.
import { SETTINGS_ROUTE } from "../../render";
import { persistQueueSettings } from "../../queue/queue.ts";
import {
  QUEUE_CONCURRENCY_MAX, QUEUE_CONCURRENCY_MIN, bodyToObject, isQueueConcurrency, json, readBounded,
} from "../serve-helpers";
import type { RoutesContext } from "./";

export const SETTINGS_CONCURRENCY_ROUTE = "/api/queue/settings/concurrency";

export async function handleSettingsConcurrencyRoute(
  ctx: RoutesContext,
  req: Request,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
  if (path !== SETTINGS_CONCURRENCY_ROUTE) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await readBounded(req);
  if ("refusal" in body) return body.refusal;
  let raw: unknown;
  try { raw = bodyToObject(body.text, req.headers.get("content-type")); }
  catch { return json({ error: "malformed body" }, 400); }
  // Back to the Process tab, where the field is, whichever way it went.
  const back = (key: "error" | "notice", text: string): Response =>
    new Response(null, {
      status: 303,
      headers: { location: `${SETTINGS_ROUTE}?tab=process&${key}=${encodeURIComponent(text)}` },
    });
  const refuse = (error: string) => (wantsJson ? json({ error }, 400) : back("error", error));
  if (!ctx.opts.queueConfigFile) return refuse("this server has no queue config file");
  if (!ctx.runner) return refuse("this server runs no queue");
  const asked = (raw as Record<string, unknown> | null)?.concurrency;
  if (!isQueueConcurrency(asked)) {
    return refuse(
      `How many steps may run at once must be a whole number from ${QUEUE_CONCURRENCY_MIN} to ${QUEUE_CONCURRENCY_MAX}`,
    );
  }
  const error = persistQueueSettings(ctx.opts.queueConfigFile, { concurrency: asked });
  if (error) return refuse(error);
  ctx.runner.setConcurrency(asked);
  return wantsJson ? json({ ok: true, concurrency: asked }) : back("notice", "Defaults saved");
}
