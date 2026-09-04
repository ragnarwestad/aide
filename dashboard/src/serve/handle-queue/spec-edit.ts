// The spec's own pages and their edit routes: the reset page and
// its POST, the spec page itself, and update/save/tick. Extracted
import { checkRoutes } from "./spec-edit/checks.ts";
import { runControlRoutes } from "./spec-edit/run-controls.ts";
import { specPageRoutes } from "./spec-edit/spec-page.ts";
import type { HandleQueueContext } from "../handle-queue.ts";

// Its old home, so every caller keeps the import it has.
export { specWriteInFlight } from "./spec-edit/shared.ts";

/** The spec's own pages and their edit routes, asked family by family.
 *  Each answers `null` for a path that is not its own, so the chain
 *  reads the way the one long function it replaces did. */
export async function handleSpecEditRoutes(
  ctx: HandleQueueContext,
  req: Request,
  url: URL,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
  return (
    (await runControlRoutes(ctx, req, url, path, wantsJson)) ??
    (await specPageRoutes(ctx, req, url, path, wantsJson)) ??
    (await checkRoutes(ctx, req, url, path, wantsJson))
  );
}
