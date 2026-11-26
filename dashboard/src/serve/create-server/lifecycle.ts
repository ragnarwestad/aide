// What `createServer` starts once its contexts are built — the HTTP
// server, the timers, the boot-time recoveries and checks — and the
// handle it returns, which stops them again.

import { watchScheduleFaults } from "../../render/ui/faults/schedule-faults.ts";
import { checkAllTools, type CheckableTool, type ToolReadings } from "../tool-check.ts";
import { withToolReadings } from "../../render/ui/tool-checks.ts";
import { compressResponse, checkRequest, createHostAllowlist } from "../serve-helpers";
import type { ServerOptions } from "../options.ts";
import { handleCore, type CoreRoutesContext } from "../core-routes.ts";
import { handleRoutes, type RoutesContext } from "../routes";
import { DEFAULT_BIND_HOST, isQueuePath } from "../queue-guard.ts";
import type { ServerState } from "../state.ts";
import type { WatchSetup } from "../setup/watch.ts";
import type { createQueueRunner } from "../runner-setup/index.ts";
import { recoverTestServers, sweepDeadTestServers } from "../test-servers/recover.ts";
import { clearCheckoutFaults } from "../../render/ui/checkout-faults.ts";
import { specsClientScript } from "../serve-helpers/static.ts";
import { runnerScriptDir, type Schedules, type TestServers, type Wiring } from "./services.ts";

type Runner = ReturnType<typeof createQueueRunner>;

export function keepWatchersAlive(watch: WatchSetup): ReturnType<typeof setInterval> {
  // Bun cuts a connection that has said nothing for `idleTimeout` (120
  // seconds, set on `Bun.serve` in `startHttpServer` for slow git work),
  // and a page watching a quiet queue is exactly such a connection. A
  // comment every 45 seconds keeps it open and costs the page nothing.
  const keepAlive = setInterval(() => {
    for (const c of [...watch.watchers]) watch.writeTo(c, ": ping\n\n");
  }, 45_000);
  keepAlive.unref?.();
  return keepAlive;
}

export function startHttpServer(opts: ServerOptions, routesCtx: RoutesContext, coreCtx: CoreRoutesContext) {
  const hosts = createHostAllowlist({ extra: opts.allowedHosts ?? [], lookup: opts.tailscaleName });
  void specsClientScript(); // bundled before the first page, which then carries the same stamp as later ones
  return Bun.serve({
    port: opts.port,
    hostname: opts.bindHost ?? DEFAULT_BIND_HOST,
    // Bun cuts an idle connection after 10 seconds when this is unset,
    // and a two-repo merge under load takes longer than that.
    idleTimeout: 120,
    async fetch(req) {
      // One check in front of EVERY route, so no route can be added
      // outside it. First, before
      // `new URL(req.url)`, which throws for a request with no Host.
      const refused = await checkRequest(req, hosts);
      if (refused) return compressResponse(req, refused);

      const url = new URL(req.url);
      const path = url.pathname;

      // Every page drawn while answering reads this server's tool
      // readings in its header, never another server's in the process.
      return withToolReadings(routesCtx.toolReadings, async () => {
        const response = isQueuePath(path)
          ? await handleRoutes(routesCtx, req, url, path)
          : await handleCore(coreCtx, req, url, path);
        return compressResponse(req, response);
      });
    },
  });
}

export function startPolling(w: Wiring, runner: Runner, schedules: Schedules): ReturnType<typeof setInterval> | null {
  const growth = w.watch.streamGrowth(() => w.queue.list());
  const timer = runner
    ? setInterval(() => {
        runner.poll();
        growth.tick();
        void schedules.tickRunner();
      }, w.opts.queuePollMs ?? 2000)
    : null;
  timer?.unref?.();
  return timer;
}

export function recoverTestServersAtBoot(testServersCtx: TestServers["testServersCtx"], allowed: Set<string>): void {
  // A deploy restarts this process, and the registry lives in memory:
  // a test server started before it is still up, still holding its
  // port and its branch. Asked here, once, so the next click on that
  // spec's link goes to the board that exists rather than failing to
  // start a second one on a branch git already has checked out.
  void recoverTestServers(testServersCtx, [...allowed])
    .then(async (found) => {
      for (const e of found) console.log(`boards: ${e.branch} is still running on :${e.port}`);
      // And the other half: a test server that did NOT survive leaves
      // its worktree registered, and that registration refuses the next
      // checkout of its branch — which is the next click on that spec's
      // own link.
      for (const path of await sweepDeadTestServers(testServersCtx, [...allowed])) {
        console.log(`boards: removed the worktree of a test server that is gone — ${path}`);
      }
    })
    .catch(() => {
      // Best effort: a dashboard that could not ask still serves.
    });
}

export function startToolChecks(w: Wiring): void {
  const { opts, queue } = w;
  // What each AI can and cannot do on this machine, asked once, now that
  // the server is answering. Started here rather than before `Bun.serve`
  // for one reason: the whole round is about two seconds on a healthy
  // machine, but a CLI that hangs is bounded only by the check's own
  // timeout, and no page should wait on that. A reader who opens
  // Settings in the first moments sees "not checked yet" and then the
  // answer; a fault reaches the header notice on every page.
  //
  // Only when asked. `cli.ts` is the one caller that asks; a test that
  // starts a server says nothing and gets nothing, which is what stops a
  // suite from spawning four CLIs per fixture.
  w.toolReadings.setModelChoices(() => queue.defaults.modelChoices);
  // The tools any model is configured for — read live, since Settings can
  // change them. Registered whether or not this server checks at start,
  // so its header weighs only its own tools.
  w.toolReadings.setConfiguredTools((): CheckableTool[] => [
    ...new Set(Object.values(queue.defaults.modelChoices ?? {}).map((choice) => (choice.tool ?? "claude") as CheckableTool)),
  ]);
  watchScheduleFaults({ projects: () => w.allowed, entries: (project) => w.scheduleStore.list(project), defaults: () => queue.defaults });
  if (!opts.checkToolsOnStart) return;
  void checkAllTools(w.toolReadings, { providers: () => queue.defaults.providers, scriptDir: runnerScriptDir(opts) }).catch(() => {
    // Same best effort: a check that could not run leaves the tab
    // reading "not checked yet", which is true.
  });
}

function closeWatchers(watch: WatchSetup): void {
  watch.closeSpecWatchers();
  // Every watching page, let go of deliberately: `server.stop(true)`
  // cuts the sockets, and a controller left in the set would be
  // written to by nothing but would still be held.
  for (const c of [...watch.watchers]) {
    try {
      c.close();
    } catch {
      // already gone, which is the outcome either way
    }
  }
  watch.watchers.clear();
  watch.phaseWatchers.clear();
}

export function serverHandle(parts: {
  state: ServerState;
  server: ReturnType<typeof startHttpServer>;
  watch: WatchSetup;
  schedules: Schedules;
  testServerStore: TestServers["testServerStore"];
  queue: Wiring["queue"];
  timer: ReturnType<typeof setInterval> | null;
  keepAlive: ReturnType<typeof setInterval>;
  toolReadings: ToolReadings;
}) {
  const { state, server, watch, schedules, timer } = parts;
  return {
    port: server.port,
    hostname: server.hostname,
    /** How many specs roots are being watched right now.
     *  Here for one question nothing else can answer: that `stop()` let
     *  the handles go. A watcher nobody closes outlives the server for
     *  the life of the process, and the directories it points at are
     *  removed underneath it. */
    specWatchCount: () => watch.specWatchers.size,
    phaseWatchCount: () => watch.phaseWatchers.size,
    /** The board registry itself — here for the same reason
     *  `specWatchCount` above is: a question a test needs answered (or,
     *  here, a fixture needs to seed directly — an archived spec whose
     *  board is already tracked, without spawning a real round to get
     *  there) that nothing else exposes. */
    testServersStore: () => parts.testServerStore,
    /** This server's tool checks and model readings, for a test to ask
     *  what it recorded. */
    toolReadings: () => parts.toolReadings,
    /** The queue itself, for the same reason: a fixture that needs a merge
     *  admitted at its repository, which only a running landing does. */
    queue: () => parts.queue,
    settle: schedules.settleSpecCaches,
    // `server.stop` resolves once the last connection is closed. Nothing
    // here waits for that — the caller is shutting down — so the promise
    // is dropped on purpose rather than by accident.
    stop: () => {
      state.stopped = true;
      if (timer) clearInterval(timer);
      for (const t of schedules.timers) if (t) clearInterval(t);
      clearInterval(parts.keepAlive);
      closeWatchers(watch);
      // The checkout faults are this board's, so the next board in the
      // process does not inherit them (`render/ui/checkout-faults.ts`).
      clearCheckoutFaults();
      void server.stop(true);
    },
  };
}
