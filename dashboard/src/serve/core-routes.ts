// The routes `createServer`'s `fetch` answers itself, once the queue
// surface has already declined a path: aide-run ingestion, the live
// rows feed, and the static/PWA fallback.

import type { AideRunStore } from "../queue/aide-run-store.ts";
import { parseAideRun } from "../queue/aide-run-store.ts";
import { PROJECTS_ROUTE } from "../render";
import { STARTED_AT } from "./state.ts";
import {
  json, readBounded, servePwaAsset, serveSpecEditorAsset, SPEC_EDITOR_ASSET_PATH,
  serveSpecViewerAsset, SPEC_VIEWER_ASSET_PATH,
} from "./serve-helpers";

export interface CoreRoutesContext {
  store: AideRunStore;
  notifyQueueChanged: () => void;
  /** This process's own boot-time commit (spec 269), a getter since it
   *  is read once, asynchronously, right after `createServer` starts —
   *  see `state.ts`'s own doc comment for why it stays `null` rather
   *  than "loading" until that resolves. */
  readServingSha: () => string | null;
}

export async function handleCore(
  ctx: CoreRoutesContext,
  req: Request,
  url: URL,
  path: string,
): Promise<Response> {
  if (path === "/api/aide-run") {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try {
      raw = JSON.parse(body.text);
    } catch {
      return json({ error: "malformed json" }, 400);
    }
    const parsed = parseAideRun(raw);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const stored = ctx.store.put(parsed.run, new Date().toISOString());
    // The second source a row reads (spec 189). Cost, subagent count and
    // live state arrive here and nowhere near the queue's own store, so
    // a push driven by that store alone would let them sit still for the
    // whole of a long step.
    ctx.notifyQueueChanged();
    return json({ ok: true, sessionId: stored.sessionId });
  }

  if (path === "/api/aide-runs") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    return json({ generatedAt: new Date().toISOString(), rows: ctx.store.list() });
  }

  // What commit this process is actually running (spec 269) — read
  // once at boot, in `process.cwd()`, and never refreshed. A restart
  // that silently failed to happen looks exactly like one that worked
  // until something asks this; a probe nobody's
  // monitoring can use needs no more than a Host of its own.
  if (path === "/api/version") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    return json({ sha: ctx.readServingSha(), startedAt: STARTED_AT });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }

  if (path === SPEC_EDITOR_ASSET_PATH) return serveSpecEditorAsset(req);
  if (path === SPEC_VIEWER_ASSET_PATH) return serveSpecViewerAsset(req);

  const pwaAsset = servePwaAsset(path);
  if (pwaAsset) return pwaAsset;

  // AC-1: the address people bookmarked before the overview became a
  // served route — answered here, not from a file, so nothing has to
  // regenerate it when the route it points at changes.
  if (path === "/projects.html") {
    return new Response(null, { status: 302, headers: { location: `${PROJECTS_ROUTE}${url.search}` } });
  }

  return new Response("not found", { status: 404 });
}
