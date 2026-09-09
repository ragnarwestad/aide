// The test board's own Stop control (spec 424, REQ-3/REQ-4): a board
// reached at its own address can stop ITSELF, with no reason to know
// its own process group or send a signal — `test/round/run`'s own EXIT
// trap already tears down the worktree, the log and the temp directory
// the moment this process's server stops answering, however that
// happens (2-analysis.md, "Codebase analysis"). This route only has to
// respond, then exit.
//
// Not scoped to a project/specFolder, unlike `board-controls.ts`'s
// start/stop routes: a test board serves exactly one thing, itself.
import { getBoardInfo } from "../../render/ui/board-info.ts";
import { stoppedPage } from "./spec-edit/board-waiting.ts";
import type { HandleQueueContext } from "../handle-queue.ts";

/** `undefined` for a path that is not this route's own, so it joins the
 *  same `??`-chain `handleQueue()`'s dispatcher already is. */
export function selfStopRoute(ctx: HandleQueueContext, req: Request, path: string): Response | null {
  if (path !== "/api/self-stop") return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  // REQ-5: an ordinary (prod) server never draws the Stop button, but a
  // request can be sent by hand regardless of what the page draws.
  if (!getBoardInfo()) return new Response("not a test board", { status: 404 });
  // Deferred so the response below has left the socket first —
  // `process.exit()` called synchronously right after returning a
  // `Response` races Bun's own write (3-solution.md's Risk analysis;
  // verified against a real `Bun.serve()` in this route's own test,
  // not assumed).
  setTimeout(ctx.selfStopExit, 50);
  return stoppedPage();
}
