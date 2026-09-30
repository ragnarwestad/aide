// The board's own start/stop routes (spec 388) — the family
// `run-controls.ts` beside this file already established: a project/
// specFolder path, `ctx.specRef` for the archived refusal, a JSON answer
// for the page script.
import { startTestServer, stopTestServer } from "../../test-servers/lifecycle.ts";
import { ARCHIVED_REFUSAL, json, logRefusal, readBounded } from "../../serve-helpers";
import type { RoutesContext } from "..";

export async function testServerControlRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
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
      return json({ error: ARCHIVED_REFUSAL, spec }, 400);
    }
    const result = await startTestServer(ctx.testServers, project!, specFolder!);
    if (!result.ok) {
      logRefusal("test-server", spec, result.error);
      return json({ error: result.error, spec }, 400);
    }
    return json({ ok: true, testServer: result.entry });
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
    return json({ ok: true });
  }

  return null;
}
