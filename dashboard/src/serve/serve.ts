import { resolve } from "node:path";
import { runProjectSuiteBeforePush } from "./land-branch/test-gate.ts";
// The aide-dashboard server (spec 80): serves the generated static
// site, receives aide-run events (POST /api/aide-run), and renders
// /live through the generator's layout. Replaces the python3 static
// server on the serving host — same port, same launchd label.
//
// CLI: serve --site DIR [--port N] [--mirror FILE]
//
// `createServer` is a staged assembly, not one long body: each of the
// setup-*.ts files it calls builds one cluster of wiring that used to
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

import { QUEUE_DEFAULTS, navFromSite, compressResponse } from "./serve-helpers.ts";
export * from "./serve-helpers.ts";
export type { ServerOptions } from "./options.ts";
import type { ServerOptions } from "./options.ts";
import { handleCore, type CoreRoutesContext } from "./core-routes.ts";
import { handleQueue, type HandleQueueContext } from "./handle-queue.ts";
import { DEFAULT_PDF_CACHE_DIR } from "./handle-queue/spec-pdf.ts";
import { type SpecViewsContext } from "./spec-views.ts";
import { isLoopbackBind, isQueuePath, queueGuard as queueGuardImpl } from "./queue-guard.ts";
import { answerProjectChange, persistAllowlist as persistAllowlistImpl, type ProjectActionsContext } from "./project-actions.ts";
import { createServerState } from "./state.ts";
import { setupWatch } from "./setup-watch.ts";
import { setupProjectResolution } from "./setup-project-resolution.ts";
import { setupSchedules } from "./setup-schedules.ts";
import { setupLand } from "./setup-land.ts";
import { setupBoards } from "./setup-boards.ts";
import { setupSpecViews } from "./setup-spec-views.ts";
import { setupQueueContext } from "./setup-queue-context.ts";
import { createLaunchdRestart } from "./land-branch.ts";
import { createQueueRunner, type RunnerSetupContext } from "./runner-setup.ts";
import { recoverBoards, sweepDeadBoards } from "./boards/recover.ts";
import { setBoardInfo } from "../render/ui/board-info.ts";

export function createServer(opts: ServerOptions) {
  // Spec 363: a header this process trusts without a token is only
  // trustworthy because nothing OTHER than the proxy in front of it can
  // reach the port carrying it. Checked once, here, before anything
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
  const nav = () => opts.navEntries ?? navFromSite(opts.siteDir);
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

  const resolution = setupProjectResolution(opts, allowed, state);
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

  const resolveProject: ProjectResolver = (project) => {
    if (!allowed.has(project)) return null;
    const folders = targets().filter((t) => t.project === project).map((t) => t.specFolder);
    // The way out (spec 193). An archived spec whose branch is still on
    // origin can have `archive` enqueued again — the runner hands that
    // step the open merge, the skill resolves it, and the landing that
    // follows merges cleanly.
    const prefix = `${project}/`;
    for (const key of state.unlanded) {
      if (key.startsWith(prefix)) folders.push(key.slice(prefix.length));
    }
    // The second way out (spec 198). An archived spec can be REOPENED,
    // in a list of its OWN, never appended to `specFolders` — widening
    // that list would take spec 193's guarantee with it.
    const archived: string[] = [];
    // The CLOSED subset of the same list (spec 406, REQ-7): read off
    // the scan's own `refs` rather than a second walk — `archived`,
    // above, is already the exact key set this filters, and `SpecRef`
    // already carries `closed` for every one of them.
    const closed: string[] = [];
    for (const key of state.scan?.archived ?? []) {
      if (!key.startsWith(prefix)) continue;
      archived.push(key.slice(prefix.length));
      if (state.scan?.refs.get(key)?.closed) closed.push(key.slice(prefix.length));
    }
    return folders.length > 0 || archived.length > 0
      ? { specFolders: folders, archivedFolders: archived, closedFolders: closed }
      : null;
  };

  const watch = setupWatch(opts, allowed, state);

  // Built after `resolveProject`, which it takes. Nothing above it reads
  // it any more: `targets` used to ask the queue what it had run, and
  // spec 108 made the spec's own files the only answer to that.
  const queue = new QueueStore({
    mirrorPath: opts.queueMirrorPath,
    pendingModelsPath: opts.pendingModelsPath,
    pendingEffortPath: opts.pendingEffortPath,
    pendingStepsPath: opts.pendingStepsPath,
    defaults: opts.queueDefaults ?? QUEUE_DEFAULTS,
    resolve: resolveProject,
    allowCreateProject: (project) => allowed.has(project),
    onChange: watch.notifyQueueChanged,
  });

  // The runner exists only when a binary is configured. Spawned
  // DETACHED, in its own process group: measured on the mini, such a
  // child survives `launchctl bootout`, so a redeploy does not kill a
  // run — and the group is what SIGTERM must reach, since claude spawns
  // children of its own.
  const notifier = new Notifier({ command: opts.queueNotifyCommand });

  const schedules = setupSchedules(opts, state, {
    machineryProjectDir: resolution.machineryProjectDir,
    branchStatus,
    targets,
    allowed,
    ensureCheckout,
    queue,
    specRoots: resolution.specRoots,
    checkoutEnsurer: resolution.checkoutEnsurer,
    gitRun,
    notifyQueueChanged: watch.notifyQueueChanged,
    specsRoot: resolution.specsRoot,
  });
  resolution.attachBranchFileSteps(schedules.branchFileSteps);

  // The board registry (spec 388) — built before `land`, which needs it
  // to stop a spec's board once its archive actually lands (REQ-7).
  const { boardStore, boardsCtx } = setupBoards(state, {
    boardsPath: opts.boardsPath,
    machineryProjectDir: resolution.machineryProjectDir,
    gitRun,
    boardsAvailable: opts.boardsAvailable,
    boardsSpawn: opts.boardsSpawn,
    boardsIsAlive: opts.boardsIsAlive,
    boardsPortProbe: opts.boardsPortProbe,
    boardsOnPort: opts.boardsOnPort,
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
    landingGate: opts.landingGate ?? runProjectSuiteBeforePush,
    boards: boardsCtx,
  });

  const runnerSetupCtx: RunnerSetupContext = {
    store: queue,
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
  runner?.reconcile();
  const timer = runner
    ? setInterval(() => {
        runner.poll();
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

  const queueToken = opts.queueToken;
  // `state.server` is not set yet — see state.ts's own doc comment, and
  // `runnerSetupCtx.readServerPort` above for the identical shape.
  const currentPort = () => state.server?.port ?? opts.port;
  function queueGuard(req: Request, url: URL): Response | null {
    return queueGuardImpl(req, url, queueToken, currentPort(), opts.headerAuth);
  }

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
    queueToken,
    specFileCommits: schedules.specFileCommits,
    branchStatus,
    specsRoot: resolution.specsRoot,
    specCreatedAt: schedules.specCreatedAt,
    pdfToolAvailable,
    boards: boardsCtx,
  };
  const { archivedSpecRows, specPageView, jobDetailView } = setupSpecViews(specViewsCtx);

  // Built last, from every earlier stage's own pieces — see
  // `HandleQueueContext`'s own doc comment for why `scan` rides as a
  // getter/invalidator pair instead of a value.
  const queueCtx: HandleQueueContext = setupQueueContext(state, {
    opts,
    nav,
    allowed,
    branchFileSteps: schedules.branchFileSteps,
    targets,
    withFreshness: land.withFreshness,
    specDir: resolution.specDir,
    specRef: resolution.specRef,
    specsRoot: resolution.specsRoot,
    machinerySpecDir: resolution.machinerySpecDir,
    watchers: watch.watchers,
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
    queueToken,
    serverPort: currentPort,
    jobRow: land.jobRow,
    installAfterMerge: land.installAfterMerge,
    persistAllowlist,
    answerProjectChange,
    archivedSpecRows,
    specPageView,
    jobDetailView,
    pdfCacheDir,
    pdfGeneratorBin,
    pdfToolAvailable,
    boards: boardsCtx,
  });

  const coreCtx: CoreRoutesContext = {
    store, notifyQueueChanged: watch.notifyQueueChanged, siteDir: opts.siteDir,
    readServingSha: () => state.servingSha,
  };

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.bindHost ?? "0.0.0.0",
    // Bun cuts an idle connection after 10 seconds when this is unset,
    // and a two-repo merge under load takes longer than that.
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      const response = isQueuePath(path)
        ? (queueGuard(req, url) ?? (await handleQueue(queueCtx, req, url, path)))
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
  void recoverBoards(boardsCtx, [...allowed])
    .then(async (found) => {
      for (const e of found) console.log(`boards: ${e.branch} is still running on :${e.port}`);
      // And the other half: a test server that did NOT survive leaves
      // its worktree registered, and that registration refuses the next
      // checkout of its branch — which is the next click on that spec's
      // own link.
      for (const path of await sweepDeadBoards(boardsCtx, [...allowed])) {
        console.log(`boards: removed the worktree of a test server that is gone — ${path}`);
      }
    })
    .catch(() => {
      // Best effort: a dashboard that could not ask still serves.
    });

  return {
    port: server.port,
    /** How many specs roots are being watched right now (spec 204).
     *  Here for one question nothing else can answer: that `stop()` let
     *  the handles go. A watcher nobody closes outlives the server for
     *  the life of the process, and the directories it points at are
     *  removed underneath it. */
    specWatchCount: () => watch.specWatchers.size,
    /** The board registry itself (spec 425) — here for the same reason
     *  `specWatchCount` above is: a question a test needs answered (or,
     *  here, a fixture needs to seed directly — an archived spec whose
     *  board is already tracked, without spawning a real round to get
     *  there) that nothing else exposes. */
    boardsStore: () => boardStore,
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
      void server.stop(true);
    },
  };
}

if (import.meta.main) {
  const { runCli } = await import("./cli.ts");
  runCli();
}
