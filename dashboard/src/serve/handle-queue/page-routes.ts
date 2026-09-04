// Full-page GET routes and their redirects: the list, New spec,
// Settings, Add/Remove project, a project's own page, and the
// Projects listing. Extracted from handle-queue.ts (split of split
// serve.ts step 2).
import type { HandleQueueContext } from "../handle-queue.ts";
import { specsPages } from "./page-routes/specs-pages.ts";
import { projectPages } from "./page-routes/project-pages.ts";
import { schedulePages } from "./page-routes/schedule-pages.ts";

/** The full-page GET routes, asked family by family. Each answers
 *  `null` for a path that is not its own, so the chain reads the way
 *  the one long function it replaces did. */
export async function handlePageRoutes(
  ctx: HandleQueueContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  return (
    (await specsPages(ctx, req, url, path)) ??
    (await projectPages(ctx, req, url, path)) ??
    (await schedulePages(ctx, req, url, path))
  );
}
