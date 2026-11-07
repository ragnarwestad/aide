// The addresses that once added and edited a provider on pages of their
// own: each now sends the reader to the Providers tab, where Add is a
// dialog and the chosen provider is shown beside the list. The chosen
// provider is read by the Settings route (`providerDetailFor`); its usage,
// its models and its installation, which take seconds to read, by an
// address each that the tab asks once it has drawn.

import {
  PROVIDER_EDIT_PATH, PROVIDER_INSTALLATION_PATH, PROVIDER_MODELS_PATH, PROVIDER_NEW_PATH, PROVIDER_USAGE_PATH,
  PROVIDERS_TAB_PATH, providerEditPath, usageBlock,
} from "../../../render";
import type { Provider } from "../../../queue/providers/index.ts";
import { readProviderUsage } from "../../providers/status.ts";
import { languageChoice } from "../../serve-helpers";
import { readInstallationTab, readModelsTab } from "./readings.ts";
import { keptUsage, readUsage } from "../../providers/usage-kept.ts";
import type { ProviderDetailOptions } from "../../../render/pages/settings-page/provider-detail.ts";
import type { ProviderStatus } from "../../../render";
import type { RoutesContext } from "../";

/** What the Providers tab shows of the chosen provider: its status as the
 *  tab read it, and its usage when a reading of it is kept. */
export async function providerDetailFor(
  ctx: RoutesContext,
  key: string,
  provider: Provider,
  status: ProviderStatus | undefined,
  aiTab: string | undefined,
): Promise<ProviderDetailOptions> {
  const usage = keptUsage(ctx.opts, key, provider);
  return { key, provider, status, usage, usagePending: !usage, aiTab };
}


const redirect = (location: string): Response => new Response(null, { status: 302, headers: { location } });

export async function handleProviderPages(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  const reading = path === PROVIDER_USAGE_PATH || path === PROVIDER_MODELS_PATH || path === PROVIDER_INSTALLATION_PATH;
  if (path !== PROVIDER_NEW_PATH && path !== PROVIDER_EDIT_PATH && !reading) return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  if (reading) {
    const key = url.searchParams.get("key") ?? "";
    const provider = ctx.queue.defaults.providers?.[key];
    if (!provider) return new Response("not found", { status: 404 });
    const lang = languageChoice(url, req).lang;
    const html = path === PROVIDER_MODELS_PATH ? await readModelsTab(ctx, provider, lang)
      : path === PROVIDER_INSTALLATION_PATH ? await readInstallationTab(ctx, provider, lang)
      : usageBlock(await readUsage(ctx.opts, key, provider, ctx.opts.usageProbe ?? readProviderUsage), Date.now(), lang);
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
