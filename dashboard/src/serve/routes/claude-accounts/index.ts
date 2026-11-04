// The routes behind Claude accounts: adding, renaming and removing one on
// Settings → AI → Claude Code → Accounts, and "Run on <account>" on a step
// a usage limit stopped.

import type { RoutesContext } from "../";
import { handleRunOnRoute } from "./run-on.ts";
import { handleAccountSettingsRoutes } from "./settings.ts";

export async function handleClaudeAccountRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  return (await handleAccountSettingsRoutes(ctx, req, path)) ?? (await handleRunOnRoute(ctx, req, path));
}
