// the controls a run is steered with: the model a step runs at, picked
// before any job exists. One of the families `handleSpecEditRoutes` asks
// in turn (split 2026-09-04: the file had reached 567 lines). Every
// check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own.
import { ARCHIVED_REFUSAL, bodyToObject, json, logRefusal, readBounded } from "../../serve-helpers";

import type { RoutesContext } from "..";

export async function runControlRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  // Spec 308: a model picked for a phase before any job exists — the
  // spec-scoped sibling of `POST /api/queue/:id/model` (job-actions.ts),
  // which needs a job to attach the pick to and this route does not.
  const modelPost = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/model$/);
  if (modelPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = modelPost;
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref) return new Response("not found", { status: 404 });
    const spec = `${project}/${specFolder}`;
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    if (ref.archived) {
      logRefusal("model", spec, ARCHIVED_REFUSAL);
      return json({ error: ARCHIVED_REFUSAL, spec }, 400);
    }
    const step = typeof body.step === "string" ? body.step : "";
    const model = typeof body.model === "string" ? body.model : "";
    const result = ctx.queue.setPendingModel(project!, specFolder!, step, model);
    if (!result.ok) {
      logRefusal("model", spec, result.error);
      return json({ error: result.error, spec }, 400);
    }
    return json({ ok: true });
  }

  return null;
}
