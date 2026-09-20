// the controls a run is started or steered with: the reopen page, and the
// model and effort a step runs at. One of the three families
// `handleSpecEditRoutes` asks in
// turn (split 2026-09-04: the file had reached 567 lines). Every
// check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own.
import { FILTER_FIELD_PREFIX, FROM_LIST_FIELD, renderReopenSpecPage } from "../../../render";
import { ARCHIVED_REFUSAL, bodyToObject, json, languageChoice, logRefusal, specsClientScript, readBounded, specsRedirect } from "../../serve-helpers";

import type { RoutesContext } from "..";

export async function runControlRoutes(
  ctx: RoutesContext,
  req: Request,
  url: URL,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
  const reopenPage = path.match(/^\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/reopen$/);
  if (reopenPage) {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = reopenPage;
    const ref = ctx.specRef(project!, specFolder!);
    // Reopen is for a spec that is archived or closed (a closed one is
    // archived too, as far as the lookup is concerned).
    if (!ref || !ref.archived) return new Response("not found", { status: 404 });
    // What the list row handed on, and nothing else the URL might carry.
    const handOn: Record<string, string> = {};
    for (const [name, value] of url.searchParams) {
      if (name === FROM_LIST_FIELD || name.startsWith(FILTER_FIELD_PREFIX)) handOn[name] = value;
    }
    const langResult = languageChoice(url, req);
    const html = renderReopenSpecPage(project!, specFolder!, ctx.nav(), new Date().toISOString(), {
      error: url.searchParams.get("error") ?? undefined,
      script: await specsClientScript(),
      lang: langResult.lang,
      currentUrl: langResult.currentUrl,
      handOn,
    });
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    if (langResult.setCookie) headers.append("set-cookie", langResult.setCookie);
    return new Response(html, { headers });
  }

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
      return wantsJson ? json({ error: ARCHIVED_REFUSAL, spec }, 400) : specsRedirect(body, { error: ARCHIVED_REFUSAL, spec });
    }
    const step = typeof body.step === "string" ? body.step : "";
    const model = typeof body.model === "string" ? body.model : "";
    const result = ctx.queue.setPendingModel(project!, specFolder!, step, model);
    if (!result.ok) {
      logRefusal("model", spec, result.error);
      return wantsJson ? json({ error: result.error, spec }, 400) : specsRedirect(body, { error: result.error, spec });
    }
    return wantsJson ? json({ ok: true }) : specsRedirect(body);
  }

  // Spec 364: the effort-level sibling of the model pending pick above —
  // same shape, same reason, checked against EFFORT_LEVELS instead of
  // a configured allowlist.
  const effortPost = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/effort$/);
  if (effortPost) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = effortPost;
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
      logRefusal("effort", spec, ARCHIVED_REFUSAL);
      return wantsJson ? json({ error: ARCHIVED_REFUSAL, spec }, 400) : specsRedirect(body, { error: ARCHIVED_REFUSAL, spec });
    }
    const step = typeof body.step === "string" ? body.step : "";
    const effort = typeof body.effort === "string" ? body.effort : "";
    const result = ctx.queue.setPendingEffort(project!, specFolder!, step, effort);
    if (!result.ok) {
      logRefusal("effort", spec, result.error);
      return wantsJson ? json({ error: result.error, spec }, 400) : specsRedirect(body, { error: result.error, spec });
    }
    return wantsJson ? json({ ok: true }) : specsRedirect(body);
  }

  return null;
}
