// The SSE subscription route (spec 189). Extracted from handle-queue.ts
// (split of split serve.ts step 2) so the dispatcher's own body reads as
// a short sequence of theme calls.
import type { HandleQueueContext } from "../handle-queue.ts";

export function handleQueueEvents(ctx: HandleQueueContext, req: Request, path: string): Response | null {
  if (path === "/api/queue/events") {
    if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
    let mine: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        mine = controller;
        ctx.watchers.add(controller);
        // The subscriber is registered — say so. A caller that acts
        // the instant its `fetch` resolves would otherwise race the
        // registration and wait for an event that was broadcast
        // before it was listening. A comment, so no client sees it.
        ctx.writeTo(controller, ": open\n\n");
      },
      cancel() {
        if (mine) ctx.watchers.delete(mine);
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
