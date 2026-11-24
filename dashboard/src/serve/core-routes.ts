// The routes `createServer`'s `fetch` answers itself, once the queue
// surface has already declined a path: aide-run ingestion, the live
// rows feed, and the static/PWA fallback.

import type { AideRunStore } from "../queue/aide-run-store.ts";
import { parseAideRun } from "../queue/aide-run-store.ts";
import { STARTED_AT } from "./state.ts";
import {
  json, readObjectBody, servePwaAsset, serveSpecEditorAsset, SPEC_EDITOR_ASSET_PATH,
  serveSpecViewerAsset, SPEC_VIEWER_ASSET_PATH,
} from "./serve-helpers";
import { languageChoice } from "./serve-helpers/http.ts";
import { deployMarkAnswer } from "../render/ui/deploy-mark/index.ts";

export interface CoreRoutesContext {
  store: AideRunStore;
  notifyQueueChanged: () => void;
  /** This process's own boot-time commit, a getter since it
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
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    const parsed = parseAideRun(sent.body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const stored = ctx.store.put(parsed.run, new Date().toISOString());
    // The second source a row reads. Cost, subagent count and
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

  // What commit this process is actually running — read
  // once at boot, in `process.cwd()`, and never refreshed. A restart
  // that silently failed to happen looks exactly like one that worked
  // until something asks this; a probe nobody's
  // monitoring can use needs no more than a Host of its own.
  if (path === "/api/version") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    return json({ sha: ctx.readServingSha(), startedAt: STARTED_AT });
  }

  // The header's Deploy mark as the header draws it, in the reader's
  // language: what a page swaps in when the event stream says it changed.
  if (path === "/api/deploy-mark") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    return new Response(deployMarkAnswer(languageChoice(url, req).lang), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }

  if (path === SPEC_EDITOR_ASSET_PATH) return serveSpecEditorAsset(req);
  if (path === SPEC_VIEWER_ASSET_PATH) return serveSpecViewerAsset(req);

  // The worker's wait and offline pages are in the reader's language.
  const pwaAsset = servePwaAsset(path, languageChoice(url, req).lang);
  if (pwaAsset) return pwaAsset;

  return new Response("not found", { status: 404 });
}
