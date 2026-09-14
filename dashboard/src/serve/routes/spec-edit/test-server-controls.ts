// The board's own start/stop routes (spec 388) — the family
// `run-controls.ts` beside this file already established: a project/
// specFolder path, `ctx.specRef` for the archived refusal, a redirect
// back to the spec page for a no-JS form POST.
import { specPagePath } from "../../../render";
import { startTestServer, stopTestServer } from "../../test-servers/lifecycle.ts";
import { ARCHIVED_REFUSAL, json, logRefusal, readBounded, specsRedirect } from "../../serve-helpers";
import type { RoutesContext } from "..";

export async function testServerControlRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
  const startMatch = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/test-server$/);
  if (startMatch) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = startMatch;
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref) return new Response("not found", { status: 404 });
    const spec = `${project}/${specFolder}`;
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    if (ref.archived) {
      logRefusal("test-server", spec, ARCHIVED_REFUSAL);
      return wantsJson ? json({ error: ARCHIVED_REFUSAL, spec }, 400) : specsRedirect({}, { error: ARCHIVED_REFUSAL, spec }, specPagePath(project!, specFolder!));
    }
    const result = await startTestServer(ctx.testServers, project!, specFolder!);
    if (!result.ok) {
      logRefusal("test-server", spec, result.error);
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect({}, { error: result.error, spec }, specPagePath(project!, specFolder!));
    }
    return wantsJson
      ? json({ ok: true, testServer: result.entry })
      : specsRedirect({}, undefined, specPagePath(project!, specFolder!));
  }

  const stopMatch = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/test-server\/stop$/);
  if (stopMatch) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = stopMatch;
    const ref = ctx.specRef(project!, specFolder!);
    if (!ref) return new Response("not found", { status: 404 });
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    stopTestServer(ctx.testServers, project!, specFolder!, "the Stop button on the spec row");
    return wantsJson ? json({ ok: true }) : specsRedirect({}, undefined, specPagePath(project!, specFolder!));
  }

  return null;
}
