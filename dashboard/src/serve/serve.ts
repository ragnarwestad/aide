// The aide-dashboard server: serves every page of the board and its
// actions, and receives aide-run events (POST /api/aide-run).
//
// CLI: serve [--port N] [--mirror FILE]
//
// `createServer` is a staged assembly, not one long body: each of the
// setup/*.ts and create-server/*.ts functions it calls builds one cluster
// of wiring, and `state.ts` holds the handful of mutable `let`s
// (`scan`, `unlanded`, `prOpen`, `notifySoon`, plus `server`
// and `runner` themselves) that cross those stage boundaries. The
// stages run in dependency order — project resolution before the
// queue, schedules before land, land before the runner, everything
// before `Bun.serve()`. Callbacks read later-created state only after setup:
// `readServerPort` reads the server, `scheduleCtx.readRunner` reads the runner,
// and the automatic dependency handler reads the routes context.

import { AideRunStore } from "../queue/aide-run-store.ts";
import { Notifier } from "../integrations/notify.ts";
import type { ProjectResolver } from "../queue/queue.ts";

export type { ServerOptions } from "./options.ts";
import type { ServerOptions } from "./options.ts";
import type { CoreRoutesContext } from "./core-routes.ts";
import type { RoutesContext } from "./routes";
import { createServerState } from "./state.ts";
import { setupWatch } from "./setup/watch.ts";
import { createScheduleStore } from "../queue/schedule-store.ts";
import { setupProjectResolution } from "./setup/project-resolution.ts";
import { createProjectResolver } from "./setup/resolve-project.ts";
import { setupSpecViews } from "./setup/spec-views.ts";
import { createQueueRunner, resumeCutLandingsAtBoot, type RunnerSetupContext } from "./runner-setup/index.ts";
import { setBoardInfo } from "../render/ui/board-info.ts";
import { createToolReadings } from "./tool-check.ts";
import { navEntries } from "../render";
import {
  assertHeaderAuthOnLoopback, createQueueWithPush, pdfToolIsAvailable, readServingCommit,
  wireLand, wireSchedules, wireTestServers, type Land, type Schedules, type TestServers, type Wiring,
} from "./create-server/services.ts";
import { buildRoutesCtx, buildRunnerSetupCtx, buildSpecViewsCtx } from "./create-server/contexts.ts";
import {
  keepWatchersAlive, recoverTestServersAtBoot, serverHandle, startHttpServer, startPolling, startToolChecks,
} from "./create-server/lifecycle.ts";

export function createServer(opts: ServerOptions) {
  assertHeaderAuthOnLoopback(opts);

  const { w, nav, pdfToolAvailable } = createWiring(opts);
  const { store, state, allowed, watch } = w;
  const { ensureCheckout } = w.resolution;

  // The runner exists only when a binary is configured. Spawned
  // DETACHED, in its own process group: measured on the mini, such a
  // child survives `launchctl bootout`, so a redeploy does not kill a
  // run — and the group is what SIGTERM must reach, since claude spawns
  // children of its own.
  const notifier = new Notifier({ command: opts.queueNotifyCommand });
  const schedules = wireSchedules(w);

  // The board registry — built before `land`, which needs it
  // to stop a spec's board once its archive actually lands.
  const { testServerStore, testServersCtx } = wireTestServers(w);
  const land = wireLand(w, schedules, testServersCtx);

  const runnerSetupCtx = buildRunnerSetupCtx(w, { schedules, land, testServerStore, notifier, readRoutesCtx: () => routesCtx });
  const runner = createQueueRunner(runnerSetupCtx);
  state.runner = runner;

  // And on boot, before anything is queued: an already-added project
  // meets this spec for the first time on some restart, and the clone
  // it needs should not land in the middle of the first request that
  // wants it. Fire and forget — a clone that fails says so on the
  // project's own readiness line, and the server serves either way.
  for (const project of allowed) void ensureCheckout(project);
  const keepAlive = keepWatchersAlive(watch);

  const views = setupSpecViews(buildSpecViewsCtx(w, { schedules, land, testServersCtx, pdfToolAvailable }));
  const routesCtx: RoutesContext = buildRoutesCtx(w, { nav, schedules, land, testServersCtx, runner, views, pdfToolAvailable });
  const coreCtx: CoreRoutesContext = {
    store, notifyQueueChanged: watch.notifyQueueChanged,
    readServingSha: () => state.servingSha,
  };
  const server = startHttpServer(opts, routesCtx, coreCtx);
  state.server = server;

  // On boot, before anything new starts: every job left `running`, then every landing cut short.
  // Only once the server is up, so a start that fails before it records no deploy as done.
  // Primed first, so the jobs the store already holds are not news.
  const timer = bootServices(w, { land, runner, runnerSetupCtx, schedules, testServersCtx });

  return serverHandle({ state, server, watch, schedules, testServerStore, queue: w.queue, timer, keepAlive, toolReadings: w.toolReadings });
}

/** Every service the stages share, built in dependency order. */
function createWiring(opts: ServerOptions) {
  const store = new AideRunStore({ mirrorPath: opts.mirrorPath });
  const nav = () => opts.navEntries ?? navEntries();
  const state = createServerState();
  // Always set, including `undefined` — `board-info.ts`'s own
  // rule, since `bun test` runs many `createServer()` calls in one
  // process and a merge/leave-if-set read would let an earlier test's
  // board leak into a later, ordinary-server test.
  setBoardInfo(opts.testBoardSpec);
  const allowed = new Set(opts.queueProjects ?? []);
  const pdfToolAvailable = pdfToolIsAvailable(opts);

  // Built before `setupProjectResolution`, which hands it to
  // `promptFileFor`; the tick, the pages and the schedule routes share it.
  const scheduleStore = createScheduleStore(opts.queueConfigFile);
  const resolution = setupProjectResolution(opts, allowed, state, scheduleStore);
  const { targets } = resolution;
  readServingCommit(state, resolution.gitRun);

  const resolveProject: ProjectResolver = createProjectResolver(state, allowed, targets, opts.dashboardCheckoutRoot);
  const watch = setupWatch(opts, allowed, state);
  const { push, queue } = createQueueWithPush(opts, { allowed, resolveProject, watch, scheduleStore, targets });
  const toolReadings = createToolReadings();
  const w: Wiring = { opts, state, store, allowed, scheduleStore, resolution, watch, queue, push, toolReadings };
  return { w, nav, pdfToolAvailable };
}

/** The boot-time catch-up once the server is listening; answers the polling timer. */
function bootServices(
  w: Wiring,
  parts: {
    land: Land;
    runner: ReturnType<typeof createQueueRunner>;
    runnerSetupCtx: RunnerSetupContext;
    schedules: Schedules;
    testServersCtx: TestServers["testServersCtx"];
  },
) {
  const { land, runner, schedules } = parts;
  w.push.prime();
  land.deployJob.finishAfterRestart();
  runner?.reconcile();
  if (runner) resumeCutLandingsAtBoot(parts.runnerSetupCtx);
  const timer = startPolling(w, runner, schedules);

  recoverTestServersAtBoot(parts.testServersCtx, w.allowed);
  startToolChecks(w);
  return timer;
}

if (import.meta.main) {
  const { installTimestampedConsole } = await import("./serve-helpers/timestamped-console.ts");
  installTimestampedConsole();
  const { runCli } = await import("./cli.ts");
  runCli();
}
