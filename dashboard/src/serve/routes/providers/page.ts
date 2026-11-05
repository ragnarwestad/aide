// The two pages of a provider: Add (the tool first, then its fields) and
// Edit (the fields filled in).

import { PROVIDER_EDIT_PATH, PROVIDER_NEW_PATH, renderProviderPage } from "../../../render";
import { asProviderTool } from "../../../queue/providers/index.ts";
import { languageChoice, specsClientScript } from "../../serve-helpers";
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
  const html = renderProviderPage(ctx.nav(), new Date().toISOString(), {
    tool: asProviderTool(url.searchParams.get("tool")),
    edit: path === PROVIDER_EDIT_PATH && provider ? { key, provider } : undefined,
    script: await specsClientScript(),
    lang: langResult.lang,
    currentUrl: langResult.currentUrl,
  });
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
  return new Response(html, { headers });
}
