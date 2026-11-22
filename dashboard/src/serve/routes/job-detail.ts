// One job as JSON at /api/queue/:id, and a step's screenshots under
// /jobs/:id/screenshots/. Its regex matches a single-segment id under
// /api/queue/, which overlaps with the exact-string routes handled
// elsewhere (e.g. /api/queue/create) — it MUST be tried last, after every other
// theme, exactly as it sat last in the original dispatcher.
import { json, serveStatic } from "../serve-helpers";
import { screenshotsDir } from "../../queue/runner/run-log-path.ts";
import type { RoutesContext } from "./";

export async function handleJobDetailRoute(
  ctx: RoutesContext,
  req: Request,
  _url: URL,
  path: string,
): Promise<Response | null> {
  // A finished step's picture of a page it changed, from the folder kept
  // beside its transcript; a step run again is the newest attempt's. `serveStatic` cannot leave the folder.
  const shot = path.match(/^\/jobs\/([A-Za-z0-9-]+)\/screenshots\/([a-z]+)\/([A-Za-z0-9_-]+\.png)$/);
  if (shot) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const [, id, step, file] = shot;
    const streamFile = ctx.queue.get(id!)?.results.findLast((r) => r.step === step && r.streamFile)?.streamFile;
    if (!streamFile) return new Response("not found", { status: 404 });
    const found = serveStatic(screenshotsDir(streamFile), `/${file}`);
    if (!found.ok) return found;
    return new Response(found.body, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  }
  const detail = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)$/);
  if (detail) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const job = ctx.queue.get(detail[1]!);
    if (!job) return json({ error: "no such job" }, 404);
    return json({ generatedAt: new Date().toISOString(), job });
  }

  return null;
}
