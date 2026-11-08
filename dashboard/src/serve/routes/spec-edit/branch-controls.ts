// Delete branch: the one control an archived row carries when its spec's
// branch merged but is still on origin — one of the families
// `handleSpecEditRoutes` asks in turn, shaped like close-controls.ts.
// JSON for the page script.
import { bodyToObject, json, logRefusal, readBounded } from "../../serve-helpers";

import { landingInProject } from "../../../queue/queue.ts";
import type { RoutesContext } from "..";

export async function branchControlRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  const deletePost = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/delete-branch$/);
  if (!deletePost) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const [, project, specFolder] = deletePost;
  const sent = await readBounded(req);
  if ("refusal" in sent) return sent.refusal;
  try {
    if (sent.text) bodyToObject(sent.text, req.headers.get("content-type"));
  } catch {
    return json({ error: "malformed body" }, 400);
  }
  const spec = `${project}/${specFolder}`;
  const refuse = (error: string): Response => {
    logRefusal("delete-branch", spec, error);
    return json({ error, spec }, 400);
  };
  const ref = ctx.specRef(project!, specFolder!);
  if (!ref) return new Response("not found", { status: 404 });
  if (!ref.archived) return refuse(`${specFolder} is not archived — Delete branch is for an archived spec's leftover branch`);
  if (ref.closed) return refuse(`${specFolder} is closed — its branch was never merged`);
  // The same two in-flight checks Close makes: a landing moves the
  // checkouts this deletes in, and a job for the spec may push the branch.
  if (landingInProject(ctx.queue.list(), project!)) return refuse("a landing is in progress");
  if (ctx.queue.list().some((job) =>
    job.project === project && job.specFolder === specFolder &&
    (job.state === "queued" || job.state === "running")
  )) return refuse("another job for this spec is still running");
  const result = await ctx.deleteLeftBehindBranch(project!, specFolder!);
  // Before the event: the page answers it by asking for its rows.
  ctx.invalidateScan();
  ctx.notifyQueueChanged();
  if (!result.ok) return refuse(result.error);
  return json({ ok: true });
}
