// The test board's Delay press: how long the round's stand-in model
// waits before each step (`round-delay.ts`). Like Stop and Run it
// belongs to a test board alone, and to one `test/round/run` started,
// since only that names the file the stand-in reads.
import { getBoardInfo } from "../../render/ui/board-info.ts";
import { delayFile, writeDelay } from "../../integrations/round-delay.ts";
import { bodyToObject, json, readBounded } from "../serve-helpers";
import type { RoutesContext } from "./";

/** `undefined` for a path that is not this route's own, so it joins the
 *  same `??`-chain `handleRoutes()`'s dispatcher already is. */
export async function selfDelayRoute(_ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  if (path !== "/api/self-run/delay") return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const file = delayFile();
  if (!getBoardInfo() || !file) return new Response("not a test board", { status: 404 });
  const sent = await readBounded(req);
  if ("refusal" in sent) return sent.refusal;
  const body = bodyToObject(sent.text, req.headers.get("content-type")) as { seconds?: unknown } | null;
  const seconds = Number(body?.seconds);
  if (!writeDelay(file, seconds)) return json({ error: `not a delay: ${String(body?.seconds)}` }, 400);
  return json({ ok: true, seconds });
}
