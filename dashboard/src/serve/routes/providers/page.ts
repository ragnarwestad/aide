// The two pages of a provider: Add (the tool first, then its fields) and
// Edit (the fields filled in). Edit reads the provider's status and its usage
// as it opens, side by side and with the provider's own folders, and hands the
// page the tool's last Check and models reading.

import { PROVIDER_EDIT_PATH, PROVIDER_NEW_PATH, renderProviderPage } from "../../../render";
import { asProviderTool } from "../../../queue/providers/index.ts";
import { readProviderStatus, readProviderUsage } from "../../providers/status.ts";
import { lastChecks } from "../../tool-check.ts";
import { lastModels } from "../../tool-models";
import { languageChoice, modelChoiceOptions, specsClientScript } from "../../serve-helpers";
import type { RoutesContext } from "../";

export async function handleProviderPages(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  if (path !== PROVIDER_NEW_PATH && path !== PROVIDER_EDIT_PATH) return null;
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const key = url.searchParams.get("key") ?? "";
  const provider = ctx.queue.defaults.providers?.[key];
  if (path === PROVIDER_EDIT_PATH && !provider) return new Response("not found", { status: 404 });
  const langResult = languageChoice(url, req);
  const [status, usage] = path === PROVIDER_EDIT_PATH && provider
    ? await Promise.all([
      (ctx.opts.providerProbe ?? readProviderStatus)(key, provider),
      (ctx.opts.usageProbe ?? readProviderUsage)(key, provider),
    ])
    : [undefined, undefined];
  // The reading is kept per tool; it is this page's only when it was read with
  // this provider's folders.
  const last = provider ? lastModels()[provider.tool] : undefined;
  const reading = last && provider && last.provider === provider.name ? last : undefined;
  const html = renderProviderPage(ctx.nav(), new Date().toISOString(), {
    tool: asProviderTool(url.searchParams.get("tool")),
    edit: path === PROVIDER_EDIT_PATH && provider ? { key, provider } : undefined,
    status,
    usage,
    check: provider ? lastChecks()[provider.tool] : undefined,
    models: {
      reading,
      choices: ctx.queue.defaults.modelChoices,
      options: modelChoiceOptions(ctx.queue),
    },
    aiTab: url.searchParams.get("aitab") ?? undefined,
    script: await specsClientScript(),
    lang: langResult.lang,
    currentUrl: langResult.currentUrl,
  });
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
  return new Response(html, { headers });
}
