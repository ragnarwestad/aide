import { USAGE_DIALOG_ROUTE, usageDialogBody } from "../../../render/ui/usage-dialog/index.ts";
import { readProviderUsage } from "../../providers/status.ts";
import { keptUsage, readUsageJoined } from "../../providers/usage-kept.ts";
import { languageChoice } from "../../serve-helpers/http.ts";
import type { RoutesContext } from "../";

const included = (tool: string): boolean => tool === "claude" || tool === "codex";

export async function handleProviderUsageRoute(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response | null> {
  if (path !== USAGE_DIALOG_ROUTE) return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const providers = ctx.queue.defaults.providers ?? {};
  const readKey = url.searchParams.get("read");
  if (readKey !== null) {
    const provider = providers[readKey];
    if (!provider || !included(provider.tool)) return new Response("not found", { status: 404 });
    if (!keptUsage(ctx.opts, readKey, provider)) await readUsageJoined(ctx.opts, readKey, provider, ctx.opts.usageProbe ?? readProviderUsage);
  } else {
    for (const [key, provider] of Object.entries(providers)) {
      if (included(provider.tool) && !keptUsage(ctx.opts, key, provider)) void readUsageJoined(ctx.opts, key, provider, ctx.opts.usageProbe ?? readProviderUsage).catch(() => {});
    }
  }
  const entries = Object.entries(providers).filter(([, provider]) => included(provider.tool)).map(([key, provider]) => ({
    key, provider, usage: keptUsage(ctx.opts, key, provider),
  }));
  return new Response(usageDialogBody(entries, Date.now(), languageChoice(url, req).lang), { headers: { "content-type": "text/html; charset=utf-8" } });
}
