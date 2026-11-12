import { USAGE_DIALOG_ROUTE, usageDialogBody } from "../../../render/ui/usage-dialog/index.ts";
import { keptEntries } from "../../providers/usage-kept.ts";
import { languageChoice } from "../../serve-helpers/http.ts";
import type { RoutesContext } from "../";

/** The Usage panel from the kept readings. It starts no reading. */
export async function handleProviderUsageRoute(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {
  if (path !== USAGE_DIALOG_ROUTE) return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const entries = keptEntries(ctx.opts, ctx.queue.defaults.providers ?? {});
  return new Response(usageDialogBody(entries, Date.now(), languageChoice(url, req).lang), { headers: { "content-type": "text/html; charset=utf-8" } });
}
