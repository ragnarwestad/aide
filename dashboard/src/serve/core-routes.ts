// The routes `createServer`'s `fetch` answers itself, once the queue
// surface has already declined a path: aide-run ingestion, the live
// rows feed, and the static/PWA fallback.

import type { AideRunStore } from "../queue/aide-run-store.ts";
import { parseAideRun } from "../queue/aide-run-store.ts";
import {
  json, readBounded, serveStatic, servePwaAsset, serveSpecEditorAsset, SPEC_EDITOR_ASSET_PATH,
  serveSpecViewerAsset, SPEC_VIEWER_ASSET_PATH,
} from "./serve-helpers.ts";

export interface CoreRoutesContext {
  store: AideRunStore;
  notifyQueueChanged: () => void;
  siteDir: string;
  /** This process's own boot-time commit (spec 269), a getter since it
   *  is read once, asynchronously, right after `createServer` starts —
   *  see `state.ts`'s own doc comment for why it stays `null` rather
   *  than "loading" until that resolves. */
  readServingSha: () => string | null;
}

export async function handleCore(
  ctx: CoreRoutesContext,
  req: Request,
  _url: URL,
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
  // until something asks this; unauthenticated so a probe nobody's
  // monitoring can use is not locked behind the queue token.
  if (path === "/api/version") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    return json({ sha: ctx.readServingSha() });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }

  if (path === SPEC_EDITOR_ASSET_PATH) return serveSpecEditorAsset(req);
  if (path === SPEC_VIEWER_ASSET_PATH) return serveSpecViewerAsset(req);

  const pwaAsset = servePwaAsset(path);
  if (pwaAsset) return pwaAsset;

  return serveStatic(ctx.siteDir, path);
}
