// The SSE subscription route (spec 189). Extracted from routes.ts
// (split of split serve.ts step 2) so the dispatcher's own body reads as
// a short sequence of theme calls.
import { parsePhaseKeys, phaseKey } from "../../render";
import type { RoutesContext } from "./";

export function handleQueueEvents(ctx: RoutesContext, req: Request, path: string): Response | null {
  if (path === "/api/queue/events") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    let mine: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        mine = controller;
        ctx.watchers.add(controller);
        // The phases this tab has unfolded (spec 500): only these hear a
        // transcript grow. A spec it has open hears its Close or Reopen
        // grow too: the line under its phases lists the steps the log marks.
        const url = new URL(req.url);
        const keys = parsePhaseKeys(url.searchParams.get("phases"));
        for (const spec of (url.searchParams.get("open") ?? "").split(",")) {
          const slash = spec.indexOf("/");
          if (slash <= 0 || slash === spec.length - 1) continue;
          for (const step of ["close", "reopen"]) keys.add(phaseKey(spec.slice(0, slash), spec.slice(slash + 1), step));
        }
        if (keys.size) ctx.phaseWatchers.set(controller, keys);
        // The subscriber is registered — say so. A caller that acts
        // the instant its `fetch` resolves would otherwise race the
        // registration and wait for an event that was broadcast
        // before it was listening. A comment, so no client sees it.
        ctx.writeTo(controller, ": open\n\n");
      },
      cancel() {
        if (mine) {
          ctx.watchers.delete(mine);
          ctx.phaseWatchers.delete(mine);
        }
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Nothing serves this through a proxy today, but one that
        // buffered would hold every event back until the connection
        // closed — which is the whole of what this route is for.
        "x-accel-buffering": "no",
      },
    });
  }

  return null;
}
