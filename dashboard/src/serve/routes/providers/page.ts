// The page that adds a provider (the tool first, then its fields), and the
// address that once edited one, which now sends the reader to that provider
// on the Providers tab. The chosen provider is read by the Settings route
// (`providerDetailFor`).

import { PROVIDER_EDIT_PATH, PROVIDER_NEW_PATH, providerEditPath, renderProviderPage } from "../../../render";
import { asProviderTool, type Provider } from "../../../queue/providers/index.ts";
import { readProviderUsage } from "../../providers/status.ts";
import { lastChecks } from "../../tool-check.ts";
import { lastModels } from "../../tool-models";
import { languageChoice, modelChoiceOptions, specsClientScript } from "../../serve-helpers";
import type { ProviderDetailOptions } from "../../../render/pages/settings-page/provider-detail.ts";
import type { ProviderStatus } from "../../../render";
import type { RoutesContext } from "../";

/** What the Providers tab shows of the chosen provider: its status as the
 *  tab read it, its usage read now with its own folders, the tool's last
 *  Check, and the models reading when it was read with this provider. */
export async function providerDetailFor(
  ctx: RoutesContext,
  key: string,
  provider: Provider,
  status: ProviderStatus | undefined,
  aiTab: string | undefined,
): Promise<ProviderDetailOptions> {
  const usage = await (ctx.opts.usageProbe ?? readProviderUsage)(key, provider);
  const last = lastModels()[provider.tool];
  return {
    key, provider, status, usage, aiTab,
    check: lastChecks()[provider.tool],
    models: {
      reading: last && last.providerKey === key ? last : undefined,
      choices: ctx.queue.defaults.modelChoices,
      options: modelChoiceOptions(ctx.queue),
    },
  };
}

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
    return new Response(null, { status: 302, headers: { location: providerEditPath(key) + (aiTab ? `&aitab=${encodeURIComponent(aiTab)}` : "") } });
  }
  const langResult = languageChoice(url, req);
  const html = renderProviderPage(ctx.nav(), new Date().toISOString(), {
    tool: asProviderTool(url.searchParams.get("tool")),
    script: await specsClientScript(),
    lang: langResult.lang,
    currentUrl: langResult.currentUrl,
  });
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
  return new Response(html, { headers });
}
