import { resolve, dirname } from "node:path";
import { checkAllTools, setConfiguredTools, toolRechecker, type CheckableTool } from "./tool-check.ts";
import { runProjectSuiteBeforePush } from "./land-branch/test-gate.ts";
import { assignSpecNumberAfterMerge } from "./land-branch/finalize-create.ts";
// The aide-dashboard server: serves every page of the board and its
// actions, and receives aide-run events (POST /api/aide-run).
//
// CLI: serve [--port N] [--mirror FILE]
//
// `createServer` is a staged assembly, not one long body: each of the
// setup/*.ts files it calls builds one cluster of wiring that used to
// sit inline here, and `state.ts` holds the handful of mutable `let`s
// (`scan`, `unlanded`, `prOpen`, `warming`, `notifySoon`, plus `server`
// and `runner` themselves) that cross those stage boundaries. The
// stages run in dependency order — project resolution before the
// queue, schedules before land, land before the runner, everything
// before `Bun.serve()` — so nothing here needs the forward-reference
// tricks the pre-split single function relied on except the two that
// are genuinely unavoidable: `readServerPort` (nothing exists before
// `Bun.serve()` returns) and `scheduleCtx.readRunner` (the runner is
// built after schedules, since it needs the land functions).

import { AideRunStore } from "../queue/aide-run-store.ts";
import { Notifier } from "../integrations/notify.ts";
import { QueueStore, type ProjectResolver } from "../queue/queue.ts";

import { QUEUE_DEFAULTS, compressResponse, checkRequest, createHostAllowlist } from "./serve-helpers";
export * from "./serve-helpers";
export type { ServerOptions } from "./options.ts";
import type { ServerOptions } from "./options.ts";
import { handleCore, type CoreRoutesContext } from "./core-routes.ts";
import { handleRoutes, type RoutesContext } from "./routes";
import { DEFAULT_PDF_CACHE_DIR } from "./routes/spec-pdf.ts";
import { type SpecViewsContext } from "./spec-views";
import { isLoopbackBind, isQueuePath } from "./queue-guard.ts";
import { answerProjectChange, persistAllowlist as persistAllowlistImpl, type ProjectActionsContext } from "./project-actions.ts";
import { createServerState } from "./state.ts";
import { setupWatch } from "./setup/watch.ts";
import { makeSettle } from "./serve-helpers/settle.ts";
import { setupPush } from "./setup/push.ts";
import { createScheduleStore } from "../queue/schedule-store.ts";
import { setupProjectResolution } from "./setup/project-resolution.ts";
import { setupSchedules } from "./setup/schedules.ts";
import { setupLand } from "./setup/land.ts";
import { setupTestServers } from "./setup/test-servers.ts";
import { createProjectResolver } from "./setup/resolve-project.ts";
import { setupSpecViews } from "./setup/spec-views.ts";
import { setupQueueContext } from "./setup/queue-context.ts";
import { createLaunchdRestart } from "./land-branch";
import { createQueueRunner, type RunnerSetupContext } from "./runner-setup.ts";
import { recoverTestServers, sweepDeadTestServers } from "./test-servers/recover.ts";
import { setBoardInfo } from "../render/ui/board-info.ts";
import { clearCheckoutFaults } from "../render/ui/checkout-faults.ts";
import { navEntries } from "../render";

export function createServer(opts: ServerOptions) {
  // Spec 363: a header this process trusts is only trustworthy because
  // nothing OTHER than the proxy in front of it can reach the port
  // carrying it. Checked once, here, before anything
  // else runs and before `Bun.serve()` binds a socket — an unconditional
  // throw, not a per-request branch that a future new route could
  // forget to add.
  if (opts.headerAuth && !isLoopbackBind(opts.bindHost)) {
    throw new Error(
      `headerAuth names "${opts.headerAuth.header}" but the server binds ` +
        `${opts.bindHost ?? "0.0.0.0"}, not loopback — a header from anywhere ` +
        "else can be forged by anyone who can reach this port. Bind to " +
        "127.0.0.1 (or ::1), or remove headerAuth from the queue config.",
    );
  }

  const store = new AideRunStore({ mirrorPath: opts.mirrorPath });
  const nav = () => opts.navEntries ?? navEntries();
  const state = createServerState();
  // Spec 424: always set, including `undefined` — `board-info.ts`'s own
  // rule, since `bun test` runs many `createServer()` calls in one
  // process and a merge/leave-if-set read would let an earlier test's
  // board leak into a later, ordinary-server test.
  setBoardInfo(opts.testBoardSpec);
  const allowed = new Set(opts.queueProjects ?? []);

  // Spec 358: `Bun.which` is synchronous, unlike `servingSha`'s check
  // below, so this needs no `state.ts` field — a plain const, computed
  // once and captured by value in both contexts built later in this
  // function. `pdfToolAvailable` is overridable (the same shape
  // `runnerAvailable` already is): no test should depend on `md-to-pdf`
  // actually being installed on the machine running `bun test`.
  const pdfToolAvailable = opts.pdfToolAvailable ?? !!Bun.which("md-to-pdf");
  const pdfCacheDir = opts.pdfCacheDir ?? DEFAULT_PDF_CACHE_DIR;
  const pdfGeneratorBin = opts.pdfGeneratorBin ?? "aide-generate-pdf";

  // Built before `setupProjectResolution`, which hands it to
  // `promptFileFor`; the tick, the pages and the schedule routes share it.
  const scheduleStore = createScheduleStore(opts.queueConfigFile);
  const resolution = setupProjectResolution(opts, allowed, state, scheduleStore);
  const { targets, gitRun, branchStatus, ensureCheckout } = resolution;

  // This process's own commit, read once (spec 269) — see state.ts's
  // own doc comment for why both fields start and stay `null` until
  // this resolves. `servingRepoRoot` is the repo this process runs
  // from, used to tell "the project whose checkout I am" from every
  // other one.
  Promise.all([
    gitRun(process.cwd(), ["rev-parse", "HEAD"]),
    gitRun(process.cwd(), ["rev-parse", "--show-toplevel"]),
  ])
    .then(([sha, top]) => {
      if (sha.code === 0) state.servingSha = sha.stdout.trim();
      if (top.code === 0) state.servingRepoRoot = top.stdout.trim();
    })
    // A `gitRun` that throws rather than answering with a nonzero code
    // (no git on the machine at all) must leave both `null`, the same
    // fail-open answer a nonzero code produces — not an unhandled
    // rejection that takes the server down.
    .catch(() => {});

  const resolveProject: ProjectResolver = createProjectResolver(state, allowed, targets);

  const watch = setupWatch(opts, allowed, state);

  // Built after `resolveProject`, which it takes. Nothing above it reads
  // it any more: `targets` used to ask the queue what it had run, and
  // spec 108 made the spec's own files the only answer to that.
  const push = setupPush(opts, { jobs: () => queue.list(), notify: () => watch.notifyQueueChanged(), scheduleStore });
  const queue = new QueueStore({
    mirrorPath: opts.queueMirrorPath,
    pendingModelsPath: opts.pendingModelsPath,
    pendingStepsPath: opts.pendingStepsPath,
    defaults: opts.queueDefaults ?? QUEUE_DEFAULTS,
    resolve: resolveProject,
    allowCreateProject: (project) => allowed.has(project),
    onChange: () => {
      watch.notifyQueueChanged();
      push.observe();
    },
  });

  // The runner exists only when a binary is configured. Spawned
  // DETACHED, in its own process group: measured on the mini, such a
  // child survives `launchctl bootout`, so a redeploy does not kill a
  // run — and the group is what SIGTERM must reach, since claude spawns
  // children of its own.
  const notifier = new Notifier({ command: opts.queueNotifyCommand });

  // The models configured for one tool, and the tools any model is
  // configured for — read live, since Settings can change them.
  const modelsFor = (tool: CheckableTool): string[] =>
    Object.values(queue.defaults.modelChoices ?? {})
      .filter((choice) => (choice.tool ?? "claude") === tool)
      .map((choice) => choice.model)
      .filter((model): model is string => typeof model === "string" && model.length > 0);
  const configuredTools = (): CheckableTool[] => [
    ...new Set(Object.values(queue.defaults.modelChoices ?? {}).map((choice) => (choice.tool ?? "claude") as CheckableTool)),
  ];
  const schedules = setupSchedules(opts, state, {
    machineryProjectDir: resolution.machineryProjectDir,
    branchStatus,
    targets,
    allowed,
    scheduleStore,
    ensureCheckout,
    queue,
    specRoots: resolution.specRoots,
    checkoutEnsurer: resolution.checkoutEnsurer,
    gitRun,
    notifyQueueChanged: watch.notifyQueueChanged,
    specsRoot: resolution.specsRoot,
    // Behind the same one flag as the check at start-up: a server nobody
    // asked to check anything never spawns a CLI to do it.
    recheckTools: opts.checkToolsOnStart ? toolRechecker(modelsFor) : undefined,
  });
  resolution.attachBranchFileSteps(schedules.branchFileSteps);

  // The board registry (spec 388) — built before `land`, which needs it
  // to stop a spec's board once its archive actually lands (REQ-7).
  const { testServerStore, testServersCtx } = setupTestServers(state, {
    testServersPath: opts.testServersPath,
    machineryProjectDir: resolution.machineryProjectDir,
    gitRun,
    testServersAvailable: opts.testServersAvailable,
    testServersSpawn: opts.testServersSpawn,
    testServersIsAlive: opts.testServersIsAlive,
    testServersPortProbe: opts.testServersPortProbe,
    testServersOnPort: opts.testServersOnPort,
    testServersPortExposed: opts.testServersPortExposed,
    port: opts.port,
  });

  const land = setupLand(state, {
    machineryProjectDir: resolution.machineryProjectDir,
    displayProjectDir: resolution.displayProjectDir,
    codeLanding: resolution.codeLanding,
    queue,
    store,
    mergeLock: schedules.mergeLock,
    gitRun,
    branchStatus,
    warmSpec: schedules.warmSpec,
    machinerySpecsRoot: resolution.machinerySpecsRoot,
    specsRoot: resolution.specsRoot,
    workflowHistory: schedules.workflowHistory,
    specCreatedAt: schedules.specCreatedAt,
    freshness: schedules.freshness,
    branchFileSteps: schedules.branchFileSteps,
    rootsStillHolding: resolution.rootsStillHolding,
    queueInstallTimeoutMs: opts.queueInstallTimeoutMs,
    restart: opts.restart ?? createLaunchdRestart(),
    restartPollMs: opts.restartPollMs,
    restartDeferTimeoutMs: opts.restartDeferTimeoutMs,
    dashboardRoot: opts.dashboardRoot ?? resolve(import.meta.dir, "..", "..", ".."),
    landingGate:
      opts.landingGate ??
      ((root, job, branch) =>
        runProjectSuiteBeforePush(root, job, branch, {
          scriptDir: opts.queueRunnerBin ? dirname(opts.queueRunnerBin) : undefined,
        })),
    // The script that numbers a landed create lives beside the runner
    // this server was started with, so a board serving a branch numbers
    // with that branch's own copy.
    finalizeCreateSpec:
      opts.finalizeCreateSpec ??
      ((work, root, specs, folder) =>
        assignSpecNumberAfterMerge(work, root, specs, folder, {
          scriptDir: opts.queueRunnerBin ? dirname(opts.queueRunnerBin) : undefined,
        })),
    testServers: testServersCtx,
  });

  const runnerSetupCtx: RunnerSetupContext = {
    store: queue,
    startsHeld: () => state.restartWaiting,
    machineryProjectDir: resolution.machineryProjectDir,
    machinerySpecsRoot: resolution.machinerySpecsRoot,
    queueRunnerBin: opts.queueRunnerBin,
    queueResultDir: opts.queueResultDir,
    scheduleOutputRoot: opts.scheduleOutputRoot,
    queueConcurrency: opts.queueConcurrency,
    // `state.server` is not set yet — see state.ts's own doc comment.
    readServerPort: () => state.server?.port,
    codeLanding: resolution.codeLanding,
    queuePush: opts.queuePush,
    promptFileFor: resolution.promptFileFor,
    notifier,
    landNewSpec: land.landNewSpec,
    landStepBranch: land.landStepBranch,
    landArchivedSpec: land.landArchivedSpec,
    landClosedSpec: land.landClosedSpec,
    landStoppedStepBranch: land.landStoppedStepBranch,
    specDir: resolution.specDir,
    peekMachinerySpecDir: resolution.peekMachinerySpecDir,
    forgetSpecCaches: (dir, folder) => {
      schedules.workflowHistory.forget(dir, folder);
      schedules.branchFileSteps.forget(dir, folder);
    },
    // A macrotask, not now: the step's own result is written right
    // after this is asked for, and a read stamped before that write
    // would never count as having seen the step.
    rereadSpecCaches: (dir, folder) => {
      setTimeout(() => void schedules.rereadSpec(dir, folder).catch(() => {}), 0);
    },
  };
  const runner = createQueueRunner(runnerSetupCtx);
  state.runner = runner;

  // And on boot, before anything is queued: an already-added project
  // meets this spec for the first time on some restart, and the clone
  // it needs should not land in the middle of the first request that
  // wants it. Fire and forget — a clone that fails says so on the
  // project's own readiness line, and the server serves either way.
  for (const project of allowed) void ensureCheckout(project);

  // On boot, resolve every job left `running` by the last restart
  // before anything new is started.
  // Primed first, so the jobs the store already holds are not news.
  push.prime();
  runner?.reconcile();
  const growth = watch.streamGrowth(() => queue.list());
  const timer = runner
    ? setInterval(() => {
        runner.poll();
        growth.tick();
        void schedules.tickRunner();
      }, 2000)
    : null;
  timer?.unref?.();

  // Bun cuts a connection that has said nothing for `idleTimeout` (120
  // seconds, set on `Bun.serve` below for slow git work), and a page
  // watching a quiet queue is exactly such a connection. A comment
  // every 45 seconds keeps it open and costs the page nothing.
  const keepAlive = setInterval(() => {
    for (const c of [...watch.watchers]) watch.writeTo(c, ": ping\n\n");
  }, 45_000);
  keepAlive.unref?.();

  // `state.server` is not set yet — see state.ts's own doc comment, and
  // `runnerSetupCtx.readServerPort` above for the identical shape.
  const currentPort = () => state.server?.port ?? opts.port;
  const hosts = createHostAllowlist({ extra: opts.allowedHosts ?? [], lookup: opts.tailscaleName });

  const projectActionsCtx: ProjectActionsContext = { queueConfigFile: opts.queueConfigFile, allowed };
  function persistAllowlist(what: string) {
    return persistAllowlistImpl(projectActionsCtx, what);
  }

  // Built once, from the same locals the view builders in spec-views.ts
  // used to close over directly — `readPrOpen`/`readScan` ride as
  // getters because `state.prOpen`/`state.scan` are reassigned after
  // this context is built.
  const specViewsCtx: SpecViewsContext = {
    projectRoot: opts.projectRoot,
    targets,
    peekUnlanded: resolution.peekUnlanded,
    peekUnlandedCheckedAt: resolution.peekUnlandedCheckedAt,
    readPrOpen: () => state.prOpen,
    readScan: () => state.scan,
    queue,
    specDir: resolution.specDir,
    specRef: resolution.specRef,
    peekMachinerySpecDir: resolution.peekMachinerySpecDir,
    machinerySpecDir: resolution.machinerySpecDir,
    dependencyFolders: resolution.dependencyFolders,
    gitRun,
    withFreshness: land.withFreshness,
    jobRow: land.jobRow,
    specFileCommits: schedules.specFileCommits,
    branchStatus,
    specsRoot: resolution.specsRoot,
    specCreatedAt: schedules.specCreatedAt,
    pdfToolAvailable,
    testServers: testServersCtx,
  };
  const { archivedSpecRows, specPageView, jobDetailView } = setupSpecViews(specViewsCtx);

  // Built last, from every earlier stage's own pieces — see
  // `RoutesContext`'s own doc comment for why `scan` rides as a
  // getter/invalidator pair instead of a value.
  const routesCtx: RoutesContext = setupQueueContext(state, {
    opts,
    nav,
    allowed,
    scheduleStore,
    branchFileSteps: schedules.branchFileSteps,
    rereadSpec: schedules.rereadSpec,
    targets,
    withFreshness: land.withFreshness,
    specDir: resolution.specDir,
    specRef: resolution.specRef,
    specsRoot: resolution.specsRoot,
    machinerySpecDir: resolution.machinerySpecDir,
    watchers: watch.watchers,
    phaseWatchers: watch.phaseWatchers,
    writeTo: watch.writeTo,
    queue,
    displayProjectDir: resolution.displayProjectDir,
    machineryProjectDir: resolution.machineryProjectDir,
    ownedSpecsRoot: resolution.ownedSpecsRoot,
    ensureCheckout,
    gitRun,
    branchStatus,
    mergeLock: schedules.mergeLock,
    runner,
    tickRunner: schedules.tickRunner,
    serverPort: currentPort,
    jobRow: land.jobRow,
    deploy: land.deploy,
    persistAllowlist,
    answerProjectChange,
    archivedSpecRows,
    specPageView,
    jobDetailView,
    pdfCacheDir,
    pdfGeneratorBin,
    pdfToolAvailable,
    testServers: testServersCtx,
    push,
  });

  const coreCtx: CoreRoutesContext = {
    store, notifyQueueChanged: watch.notifyQueueChanged,
    readServingSha: () => state.servingSha,
  };

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.bindHost ?? "0.0.0.0",
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

      const response = isQueuePath(path)
        ? await handleRoutes(routesCtx, req, url, path)
        : await handleCore(coreCtx, req, url, path);

      return compressResponse(req, response);
    },
  });
  state.server = server;

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
  if (opts.checkToolsOnStart) {
    setConfiguredTools(configuredTools);
    void checkAllTools(modelsFor).catch(() => {
      // Same best effort: a check that could not run leaves the tab
      // reading "not checked yet", which is true.
    });
  }

  return {
    port: server.port,
    /** How many specs roots are being watched right now (spec 204).
     *  Here for one question nothing else can answer: that `stop()` let
     *  the handles go. A watcher nobody closes outlives the server for
     *  the life of the process, and the directories it points at are
     *  removed underneath it. */
    specWatchCount: () => watch.specWatchers.size,
    phaseWatchCount: () => watch.phaseWatchers.size,
    /** The board registry itself (spec 425) — here for the same reason
     *  `specWatchCount` above is: a question a test needs answered (or,
     *  here, a fixture needs to seed directly — an archived spec whose
     *  board is already tracked, without spawning a real round to get
     *  there) that nothing else exposes. */
    testServersStore: () => testServerStore,
    settle: makeSettle(state, schedules.refreshSpecCaches),
    // `server.stop` resolves once the last connection is closed. Nothing
    // here waits for that — the caller is shutting down — so the promise
    // is dropped on purpose rather than by accident.
    stop: () => {
      if (timer) clearInterval(timer);
      if (schedules.driftTimer) clearInterval(schedules.driftTimer);
      if (schedules.specCacheTimer) clearInterval(schedules.specCacheTimer);
      if (schedules.scheduleTimer) clearInterval(schedules.scheduleTimer);
      clearInterval(keepAlive);
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
      // The checkout faults are this board's, so the next board in the
      // process does not inherit them (`render/ui/checkout-faults.ts`).
      clearCheckoutFaults();
      void server.stop(true);
    },
  };
}

if (import.meta.main) {
  const { installTimestampedConsole } = await import("./serve-helpers/timestamped-console.ts");
  installTimestampedConsole();
  const { runCli } = await import("./cli.ts");
  runCli();
}
