// The addresses that once added and edited a provider on pages of their
// own: each now sends the reader to the Providers tab, where Add is a
// dialog and the chosen provider is shown beside the list. The chosen
// provider is read by the Settings route (`providerDetailFor`), which reads
// the open tab's models or installation before the page answers, and shows
// the usage the server keeps.

import { PROVIDER_EDIT_PATH, PROVIDER_NEW_PATH, PROVIDERS_TAB_PATH, providerEditPath } from "../../../render";
import type { Language } from "../../../i18n";
import type { Provider } from "../../../queue/providers/index.ts";
import { readProviderUsage } from "../../providers/status.ts";
import { readInstallationTab, readModelsTab } from "./readings.ts";
import { keptUsage, readsUsage } from "../../providers/usage-kept.ts";
import { providerTab, type ProviderDetailOptions } from "../../../render/pages/settings-page/provider-detail.ts";
import type { ProviderStatus } from "../../../render";
import type { RoutesContext } from "../";

/** What the Providers tab shows of the chosen provider: its status as the
 *  tab read it, and what the open tab shows: the usage the server keeps, or
 *  the models or the installation, read now. A tool the server reads no
 *  usage for answers its own reading, which runs nothing. */
export async function providerDetailFor(
  ctx: RoutesContext,
  key: string,
  provider: Provider,
  status: ProviderStatus | undefined,
  aiTab: string | undefined,
  lang: Language,
): Promise<ProviderDetailOptions> {
  const base = { key, provider, status, aiTab };
  switch (providerTab(aiTab)) {
    case "usage":
      return {
        ...base,
        usage: readsUsage(provider.tool) ? keptUsage(ctx.opts, key) : await (ctx.opts.usageProbe ?? readProviderUsage)(key, provider),
      };
    case "models":
      return { ...base, reading: await readModelsTab(ctx, provider, lang) };
    case "installation":
      return { ...base, reading: await readInstallationTab(ctx, provider, lang) };
    case "config":
      return base;
  }
}

const redirect = (location: string): Response => new Response(null, { status: 302, headers: { location } });

export async function handleProviderPages(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (path !== PROVIDER_NEW_PATH && path !== PROVIDER_EDIT_PATH) return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  if (path === PROVIDER_EDIT_PATH) {
    const key = url.searchParams.get("key") ?? "";
    if (!ctx.queue.defaults.providers?.[key]) return new Response("not found", { status: 404 });
    const aiTab = url.searchParams.get("aitab");
    return redirect(providerEditPath(key) + (aiTab ? `&aitab=${encodeURIComponent(aiTab)}` : ""));
  }
  return redirect(PROVIDERS_TAB_PATH);
}
