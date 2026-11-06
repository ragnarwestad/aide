// The addresses that once added and edited a provider on pages of their
// own: each now sends the reader to the Providers tab, where Add is a
// dialog and the chosen provider is shown beside the list. The chosen
// provider is read by the Settings route (`providerDetailFor`), and its
// usage, which takes seconds to read, by an address of its own the tab
// asks once it has drawn.

import { PROVIDER_EDIT_PATH, PROVIDER_NEW_PATH, PROVIDER_USAGE_PATH, PROVIDERS_TAB_PATH, providerEditPath, usageBlock } from "../../../render";
import type { Provider } from "../../../queue/providers/index.ts";
import { readProviderUsage } from "../../providers/status.ts";
import { lastChecks } from "../../tool-check.ts";
import { lastModels } from "../../tool-models";
import { languageChoice, modelChoiceOptions } from "../../serve-helpers";
import { keptUsage, readUsage } from "../../providers/usage-kept.ts";
import type { ProviderDetailOptions } from "../../../render/pages/settings-page/provider-detail.ts";
import type { ProviderStatus } from "../../../render";
import type { RoutesContext } from "../";

/** What the Providers tab shows of the chosen provider: its status as the
 *  tab read it, its usage when a reading of it is kept, the tool's last
 *  Check, and the models reading when it was read with this provider. */
export async function providerDetailFor(
  ctx: RoutesContext,
  key: string,
  provider: Provider,
  status: ProviderStatus | undefined,
  aiTab: string | undefined,
): Promise<ProviderDetailOptions> {
  const usage = keptUsage(ctx.opts, key, provider);
  const last = lastModels()[provider.tool];
  return {
    key, provider, status, usage, usagePending: !usage, aiTab,
    check: lastChecks()[provider.tool],
    models: {
      reading: last && last.providerKey === key ? last : undefined,
      choices: ctx.queue.defaults.modelChoices,
      options: modelChoiceOptions(ctx.queue),
    },
  };
}

const redirect = (location: string): Response => new Response(null, { status: 302, headers: { location } });

export async function handleProviderPages(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (path !== PROVIDER_NEW_PATH && path !== PROVIDER_EDIT_PATH && path !== PROVIDER_USAGE_PATH) return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  if (path === PROVIDER_USAGE_PATH) {
    const key = url.searchParams.get("key") ?? "";
    const provider = ctx.queue.defaults.providers?.[key];
    if (!provider) return new Response("not found", { status: 404 });
    const usage = await readUsage(ctx.opts, key, provider, ctx.opts.usageProbe ?? readProviderUsage);
    const html = usageBlock(usage, Date.now(), languageChoice(url, req).lang);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (path === PROVIDER_EDIT_PATH) {
    const key = url.searchParams.get("key") ?? "";
    if (!ctx.queue.defaults.providers?.[key]) return new Response("not found", { status: 404 });
    const aiTab = url.searchParams.get("aitab");
    return redirect(providerEditPath(key) + (aiTab ? `&aitab=${encodeURIComponent(aiTab)}` : ""));
  }
  return redirect(PROVIDERS_TAB_PATH);
}
