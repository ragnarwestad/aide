// The spec's own pages and their edit routes: the reset page and
// its POST, the spec page itself, and update/save/tick. Extracted
import { testServerControlRoutes } from "./test-server-controls.ts";
import { checkRoutes } from "./checks.ts";
import { closeControlRoutes } from "./close-controls.ts";
import { branchControlRoutes } from "./branch-controls.ts";
import { runControlRoutes } from "./run-controls.ts";
import { specPageRoutes } from "./spec-page.ts";
import { trackingRoutes } from "./tracking.ts";
import type { RoutesContext } from "..";

// Its old home, so every caller keeps the import it has.
export { specWriteInFlight } from "./shared.ts";

/** The spec's own pages and their edit routes, asked family by family.
 *  Each answers `null` for a path that is not its own, so the chain
 *  reads the way the one long function it replaces did. */
export async function handleSpecEditRoutes(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  return (
    (await runControlRoutes(ctx, req, path)) ??
    (await closeControlRoutes(ctx, req, path)) ??
    (await branchControlRoutes(ctx, req, path)) ??
    (await testServerControlRoutes(ctx, req, path)) ??
    (await specPageRoutes(ctx, req, url, path)) ??
    (await trackingRoutes(ctx, req, path)) ??
    (await checkRoutes(ctx, req, url, path))
  );
}
