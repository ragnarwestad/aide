// The two routes a device talks to when its owner turns notifications on
// or off (spec 501). Both are POSTs in the queue surface, so the request
// guard has already refused a request from another site.
import { json, readBounded } from "../serve-helpers";
import type { RoutesContext } from "./";

const MAX_BODY = 8 * 1024;

export async function handlePushRoutes(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (path !== "/api/push/subscribe" && path !== "/api/push/unsubscribe") return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const read = await readBounded(req, MAX_BODY);
  if ("refusal" in read) return read.refusal;
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return json({ ok: false, error: "the body is not JSON" }, 400);
  }
  const answer =
    path === "/api/push/subscribe" ? await ctx.push.subscribe(body, url.origin) : await ctx.push.unsubscribe(body);
  return answer.ok ? json({ ok: true }) : json(answer, 400);
}
