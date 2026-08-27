// The routes `createServer`'s `fetch` answers itself, once the queue
// surface has already declined a path: aide-run ingestion, the live
// rows feed, and the static/PWA fallback. Split out of serve.ts (split
// serve.ts by theme).

import type { AideRunStore } from "../queue/aide-run-store.ts";
import { parseAideRun } from "../queue/aide-run-store.ts";
import type { LiveEnricher } from "../integrations/live.ts";
import { json, readBounded, serveStatic, servePwaAsset } from "./serve-helpers.ts";

export interface CoreRoutesContext {
  store: AideRunStore;
  enricher: LiveEnricher;
  notifyQueueChanged: () => void;
  siteDir: string;
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
    const { rows, enriched } = await ctx.enricher.rows(ctx.store);
    return json({ generatedAt: new Date().toISOString(), enriched, rows });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }

  const pwaAsset = servePwaAsset(path);
  if (pwaAsset) return pwaAsset;

  return serveStatic(ctx.siteDir, path);
}
