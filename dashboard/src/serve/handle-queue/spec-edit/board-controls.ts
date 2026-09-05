// The board's own start/stop routes (spec 388) — the family
// `run-controls.ts` beside this file already established: a project/
// specFolder path, `ctx.specRef` for the archived refusal, a redirect
// back to the spec page for a no-JS form POST.
import { specPagePath } from "../../../render.ts";
import { startBoard, stopBoard } from "../../boards/lifecycle.ts";
import { ARCHIVED_REFUSAL, json, logRefusal, readBounded, specsRedirect } from "../../serve-helpers.ts";
import type { HandleQueueContext } from "../../handle-queue.ts";

export async function boardControlRoutes(
  ctx: HandleQueueContext,
  req: Request,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
  const startMatch = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/board$/);
  if (startMatch) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = startMatch;
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref) return new Response("not found", { status: 404 });
    const spec = `${project}/${specFolder}`;
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    if (ref.archived) {
      logRefusal("board", spec, ARCHIVED_REFUSAL);
      return wantsJson ? json({ error: ARCHIVED_REFUSAL, spec }, 400) : specsRedirect({}, { error: ARCHIVED_REFUSAL, spec }, specPagePath(project!, specFolder!));
    }
    const result = await startBoard(ctx.boards, project!, specFolder!);
    if (!result.ok) {
      logRefusal("board", spec, result.error);
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect({}, { error: result.error, spec }, specPagePath(project!, specFolder!));
    }
    return wantsJson
      ? json({ ok: true, board: result.entry })
      : specsRedirect({}, undefined, specPagePath(project!, specFolder!));
  }

  const stopMatch = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/board\/stop$/);
  if (stopMatch) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = stopMatch;
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref) return new Response("not found", { status: 404 });
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    stopBoard(ctx.boards, project!, specFolder!);
    return wantsJson ? json({ ok: true }) : specsRedirect({}, undefined, specPagePath(project!, specFolder!));
  }

  return null;
}
