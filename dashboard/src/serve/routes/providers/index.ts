// The routes behind providers: adding, editing, renaming and removing one on
// Settings → Providers, and the pages that add and edit one.

import type { RoutesContext } from "../";
import { handleProviderPages } from "./page.ts";
import { handleProviderSettingsRoutes } from "./settings.ts";

export async function handleProviderRoutes(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  return (
    (await handleProviderSettingsRoutes(ctx, req, path)) ??
    (await handleProviderPages(ctx, req, url, path))
  );
}
