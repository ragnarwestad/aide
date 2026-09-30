// The project page's Wiki tab posts here: one wiki build per press, queued
// under the project's own tracking key (`wikiTrackingKey`). The queue's
// clash rule then allows one unfinished build per project, and a build whose
// merge is still running refuses another, with the queue's own sentence.

import { wikiTrackingKey } from "../../queue/steps.ts";
import { json, logRefusal, readBounded } from "../serve-helpers";
import type { RoutesContext } from "./";

export async function handleWikiRoute(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  const match = path.match(/^\/api\/queue\/projects\/([^/]+)\/wiki$/);
  if (!match) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const name = decodeURIComponent(match[1]!);
  const body = await readBounded(req);
  if ("refusal" in body) return body.refusal;
  if (!ctx.opts.projectRoot || !ctx.allowed.has(name)) return new Response("no such project\n", { status: 404 });

  const result = ctx.queue.enqueue({ project: name, specFolder: wikiTrackingKey(name), steps: ["wiki"] });
  if (!result.ok) {
    logRefusal("build wiki", name, result.error);
    return json({ error: result.error }, 400);
  }
  await ctx.tickRunner();
  return json({ ok: true, job: result.job });
}
