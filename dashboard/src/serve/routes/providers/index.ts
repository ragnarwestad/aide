// The routes behind providers: adding, editing, renaming and removing one on
// Settings → Providers.

import type { RoutesContext } from "../";
import { handleProviderSettingsRoutes } from "./settings.ts";
import { handleProviderUsageRoute } from "./usage.ts";

export async function handleProviderRoutes(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  return (await handleProviderSettingsRoutes(ctx, req, path)) ??
    (await handleProviderUsageRoute(ctx, req, url, path));
}
