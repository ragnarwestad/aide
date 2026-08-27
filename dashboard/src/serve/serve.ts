// The aide-dashboard server (spec 80): serves the generated static
// site, receives aide-run events (POST /api/aide-run), and renders
// /live through the generator's layout, enriched lazily from
// claude-usage's /api/live. Replaces the python3 static server on the
// serving host — same port, same launchd label.
//
// CLI: serve --site DIR [--port N] [--claude-usage URL] [--mirror FILE]

import { watch } from "node:fs";
import { AideRunStore, parseAideRun } from "../queue/aide-run-store.ts";
import {
  BranchStatusChecker, createGitRunner, DEFAULT_TTL_MS,
  type GitRunner,
} from "../git/branch-status.ts";
import {
  DescriptionFreshnessChecker,
  SpecCreatedAtChecker,
  SpecFileCommitChecker,
} from "../git/description-freshness.ts";
import { WorkflowHistoryChecker } from "../git/workflow-history.ts";
import type { RepoMergeResult } from "../git/branch-merge.ts";
import {
  CheckoutEnsurer,
  DEFAULT_DASHBOARD_CHECKOUT_ROOT,
  ensureDashboardCheckout,
  type DashboardCheckout,
} from "../git/dashboard-checkout.ts";
import { LiveEnricher } from "../integrations/live.ts";
import {
  discoverProjects,
  type SpecRef,
} from "../project/discover.ts";
import { Notifier } from "../integrations/notify.ts";
import { MergeEventReporter } from "../integrations/merge-event.ts";
import {
  QueueStore,
  type Job, type QueueDefaults, type ProjectResolver,
  type WorkflowStep,
} from "../queue/queue.ts";
import type { StepOutcome } from "../queue/runner.ts";
import {
  type NavEntry,
  type QueueTarget,
} from "../render.ts";

import {
  QUEUE_DEFAULTS,
  json, readBounded, createRootLock,
  navFromSite,
  serveStatic,
  parseArgs,
  servePwaAsset,
} from "./serve-helpers.ts";
export * from "./serve-helpers.ts";
import { handleQueue, type HandleQueueContext } from "./handle-queue.ts";
import {
  archivedSpecRows as archivedSpecRowsImpl,
  specPageView as specPageViewImpl,
  jobDetailView as jobDetailViewImpl,
  type SpecViewsContext,
} from "./spec-views.ts";
import {
  landNewSpec as landNewSpecImpl,
  landStepBranch as landStepBranchImpl,
  landStoppedStepBranch as landStoppedStepBranchImpl,
  landArchivedSpec as landArchivedSpecImpl,
  installAfterMerge as installAfterMergeImpl,
  withFreshness as withFreshnessImpl,
  type LandContext,
} from "./land-branch.ts";
import {
  refreshDrift as refreshDriftImpl,
  warmSpec as warmSpecImpl,
  refreshSpecCaches as refreshSpecCachesImpl,
  refreshSchedules as refreshSchedulesImpl,
  tickRunner as tickRunnerImpl,
  type ScheduleContext,
} from "./schedules.ts";
import { isQueuePath, queueGuard as queueGuardImpl } from "./queue-guard.ts";
import { jobRow as jobRowImpl, type JobRowContext } from "./job-row.ts";
import {
  persistAllowlist as persistAllowlistImpl, answerProjectChange, type ProjectActionsContext,
} from "./project-actions.ts";
import {
  targets as targetsImpl,
  specRoots as specRootsImpl,
  rootsStillHolding as rootsStillHoldingImpl,
  peekUnlanded as peekUnlandedImpl,
  peekUnlandedCheckedAt as peekUnlandedCheckedAtImpl,
  specDir as specDirImpl,
  specRef as specRefImpl,
  dependencyFolders as dependencyFoldersImpl,
  specsRoot as specsRootImpl,
  machinerySpecDir as machinerySpecDirImpl,
  peekMachinerySpecDir as peekMachinerySpecDirImpl,
  type SpecLookupContext,
} from "./spec-lookup.ts";
import {
  writeTo as writeToImpl,
  notifyQueueChanged as notifyQueueChangedImpl,
  scheduleNotify as scheduleNotifyImpl,
  closeSpecWatchers as closeSpecWatchersImpl,
  type SseWatchersContext,
} from "./sse-watchers.ts";
import {
  displayProjectDir as displayProjectDirImpl,
  machineryProjectDir as machineryProjectDirImpl,
  codeLanding as codeLandingImpl,
  promptFileFor as promptFileForImpl,
  ownedSpecsRoot as ownedSpecsRootImpl,
  machinerySpecsRoot as machinerySpecsRootImpl,
  complain as complainImpl,
  type ProjectCheckoutContext,
} from "./project-checkout.ts";
import { createQueueRunner, type RunnerSetupContext } from "./runner-setup.ts";

export interface ServerOptions {
  siteDir: string;
  port: number;
  claudeUsageUrl?: string;
  claudeUsageFetch?: typeof fetch;
  mirrorPath?: string;
  // Nav entries for /live: derived from --root's manifests when given,
  // else from the site dir's project pages.
  navEntries?: NavEntry[];
  /** Where to listen. Default 0.0.0.0; the mini pins its Tailscale
   *  address, the way claude-usage's plist does. */
  bindHost?: string;
  /** Without it the queue surface answers 503: off loudly, rather than
   *  open quietly. */
  queueToken?: string;
  queueMirrorPath?: string;
  /** Root scanned for `.aide/project.yaml` — the queue resolves project
   *  NAMES against it, so a request never carries a path. */
  projectRoot?: string;
  /** The allowlist. Empty or absent means no project may be queued.
   *  Seeded from `--queue-projects` on a first install and from
   *  `queue-config.json`'s `projects` field after that; mutated live by
   *  the Add/Remove routes (spec 112). */
  queueProjects?: string[];
  /** Where that allowlist is PERSISTED — the `--queue-config` file.
   *  Threaded through from `parseArgs` because the routes that change
   *  the allowlist have to write it back, and a config path that stops
   *  at `parseArgs` leaves them with nowhere to write (spec 112). */
  queueConfigFile?: string;
  queueDefaults?: QueueDefaults;
  /** Path to `aide-run-spec`. Without it the queue only stores jobs —
   *  nothing is ever started, and the page says so. */
  queueRunnerBin?: string;
  /** Where each allowlisted project is checked out on this machine —
   *  the checkout a PERSON edits. Read for display; never written to
   *  since spec 205. */
  queueProjectRoot?: string;
  /** Where the dashboard keeps the clones it works in (spec 205). One
   *  per project, made the first time it is needed. Defaults to
   *  `~/aide-dashboard-checkouts`; named here so a test can put them
   *  somewhere it owns. */
  dashboardCheckoutRoot?: string;
  queueResultDir?: string;
  /** How far a finished step publishes its work: none, branch or pr.
   *  From the queue config; `branch` when unset. */
  queuePush?: string;
  /** How many steps may run at once. From the queue config's
   *  `concurrency`; two when unset. */
  queueConcurrency?: number;
  /** argv for the gate notifier — claude-usage's contract, run with no
   *  shell. Absent means no notifications are sent. */
  queueNotifyCommand?: string[];
  /** Where to report a landed branch, so claude-usage's ledger can see a
   *  merge no transcript records (spec 158). From the queue config's
   *  `mergeEventUrl`. Absent means nothing is ever sent — and absent it
   *  must stay absent, unlike `claudeUsageUrl`, which `createServer`
   *  always resolves to a default and so can never be off. */
  mergeEventUrl?: string;
  /** How that report is sent. A test seam, like `gitRun`. */
  mergeEventFetch?: typeof fetch;
  /** How the merge check runs git. A test seam: the real one spawns a
   *  subprocess, which no test should. */
  gitRun?: GitRunner;
  /** How long the project's own install command may run after its code
   *  merged. A test seam above all — the default is a bound, not a
   *  setting anybody is expected to tune. */
  queueInstallTimeoutMs?: number;
  /** How often the drift check asks origin how far each project's
   *  checkout has fallen behind (spec 203). It is a SCHEDULE, not a
   *  cache window: the page render reads the last answer and never
   *  takes one itself. `0` turns the schedule off entirely — a test
   *  seam, for observing the never-checked row without racing a timer.
   *  Omitted, it is the checker's own TTL, which is the window the
   *  answer was already considered current for. */
  driftPollMs?: number;
  /** How often the spec caches are refilled (spec 208). Like
   *  `driftPollMs` it is a SCHEDULE, not a cache window: every page
   *  render reads the last answer and never takes one itself. `0` turns
   *  the schedule off entirely — a test seam, for observing a page that
   *  has never been warmed without racing a timer. Omitted, it is the
   *  checkers' own TTL, which is the window each answer was already
   *  considered current for. */
  specCachePollMs?: number;
  /** How often each project's own `schedule:` entries are checked for a
   *  due fire (spec 259). It is a SCHEDULE, not a cache window, like
   *  `driftPollMs` and `specCachePollMs`: nothing but this timer ever
   *  asks the question, and a manual "run now" goes through the ordinary
   *  queue form instead. `0` turns it off entirely — a test seam, for
   *  observing a schedule that has never been polled without racing a
   *  timer. Omitted, it is `DEFAULT_TTL_MS`, the same default the other
   *  two schedules share. */
  scheduleCheckMs?: number;
  runnerAvailable?: boolean;
}

export function createServer(opts: ServerOptions) {
  const store = new AideRunStore({ mirrorPath: opts.mirrorPath });
  const enricher = new LiveEnricher({
    baseUrl: opts.claudeUsageUrl ?? "http://localhost:8787",
    fetch: opts.claudeUsageFetch,
  });
  const nav = () => opts.navEntries ?? navFromSite(opts.siteDir);

  // Project names resolve through a short-lived scan: fresh enough that
  // a new spec shows up, cheap enough for a page that refreshes.
  const allowed = new Set(opts.queueProjects ?? []);
  let scan:
    | {
        at: number;
        targets: QueueTarget[];
        archived: string[];
        dirs: Map<string, string>;
        refs: Map<string, SpecRef>;
        /** Where each project's specs are checked out (spec 193). Off
         *  the same walk, because the landing's verification and the
         *  archived-with-an-open-branch set both ask origin about the
         *  specs repo as well as the code one — and re-walking the
         *  projects root to learn a path this scan already read would
         *  be a second answer to a settled question. */
        specsRoots: Map<string, string>;
      }
    | null = null;
  /** `project/folder` of every ARCHIVED spec whose own `aide/<folder>`
   *  is STILL on origin in one of its two roots (spec 193).
   *
   *  Being archived used to answer "did this spec finish" with
   *  certainty. It does not: three specs reached the archive with their
   *  code sitting on a branch and every row saying done. This is the
   *  exception, and the same set answers both halves of it — which rows
   *  survive archiving on the specs list, and which archive rows carry
   *  the not-landed mark. One source, two readers.
   *
   *  Refreshed by `refreshSpecCaches` on a schedule of its own (spec
   *  208) — never inside a request, and never on the enqueue path. It
   *  used to be rebuilt by the two routes that already awaited git, and
   *  that is precisely how a network `ls-remote` per project root came
   *  to sit inside `GET /`. A root the schedule has not reached yet
   *  contributes NOTHING, exactly as an unanswerable one does, so a
   *  re-run enqueued against an unwarmed set still fails CLOSED.
   *
   *  The filter is the BRANCH, deliberately, and not the job's
   *  `errorReason`: 146 carried no reason at all, and a stale reason on
   *  an old job would resurrect a row for a spec that is genuinely
   *  finished. */
  let unlanded: string[] = [];

  /** The SUBSET of `unlanded` that is open on purpose (spec 220): a
   *  project whose manifest says `codeLanding: pr` archives with its
   *  code branch still on origin, for as long as the review takes.
   *
   *  A subset, not a set of its own, and deliberately: every existing
   *  reader of `unlanded` goes on seeing exactly what it saw — the row
   *  stays on the specs list, and `archive` stays enqueueable for it —
   *  and what splits is only what the two pages CALL it. `NOT_LANDED`
   *  reads as an instruction to run archive again; this state is an
   *  instruction to go and review something, and a page that says the
   *  first about the second is worse than saying nothing.
   *
   *  Only when the branch is open in the CODE root alone. A specs root
   *  that still holds it is a landing that genuinely did not finish —
   *  the specs merge is never gated, in any mode — and calling that a
   *  review would hide the one failure this whole check exists to
   *  catch. */
  let prOpen: string[] = [];


  const resolveProject: ProjectResolver = (project) => {
    if (!allowed.has(project)) return null;
    const folders = targets().filter((t) => t.project === project).map((t) => t.specFolder);
    // The way out (spec 193). An archived spec whose branch is still on
    // origin can have `archive` enqueued again — the runner hands that
    // step the open merge, the skill resolves it, and the landing that
    // follows merges cleanly. Nothing else about an archived spec
    // changes: edit and save stay refused by name, and a spec whose
    // branch is gone is refused exactly as before.
    const prefix = `${project}/`;
    for (const key of unlanded) {
      if (key.startsWith(prefix)) folders.push(key.slice(prefix.length));
    }
    // The second way out (spec 198). An archived spec can be REOPENED,
    // and the control for it is on the archived spec's own page — so the
    // resolver has to name a folder `targets()` deliberately drops.
    //
    // In a list of its OWN, never appended to `specFolders`: that list
    // is what every step is checked against, and widening it would take
    // spec 193's guarantee with it — an archived spec whose branch has
    // been landed is refused, and has to stay refused, for `archive`.
    // `parseJobRequest` admits this list for `reopen` alone.
    //
    // `scan` is filled by the `targets()` call above, so this never
    // reads a stale set.
    const archived: string[] = [];
    for (const key of scan?.archived ?? []) {
      if (key.startsWith(prefix)) archived.push(key.slice(prefix.length));
    }
    return folders.length > 0 || archived.length > 0
      ? { specFolders: folders, archivedFolders: archived }
      : null;
  };
  // --- spec 189: the pages that are watching --------------------------------
  //
  // One held-open response per open tab. The event is a SIGNAL and
  // carries nothing: the browser already knows how to fetch a fresh
  // `#jobrows`, so `renderQueueRows` stays the one place a row is
  // described and there is no second format to keep in step with it.
  // What travels the wire is "go and look".
  const encoder = new TextEncoder();
  const watchers = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const sseWatchersCtx: SseWatchersContext = {
    encoder,
    watchers,
    get specWatchers() {
      return specWatchers;
    },
    readNotifySoon: () => notifySoon,
    writeNotifySoon: (v) => {
      notifySoon = v;
    },
    invalidateScan: () => {
      scan = null;
    },
  };
  function writeTo(c: ReadableStreamDefaultController<Uint8Array>, text: string) {
    return writeToImpl(sseWatchersCtx, c, text);
  }
  function notifyQueueChanged() {
    return notifyQueueChangedImpl(sseWatchersCtx);
  }
  function scheduleNotify() {
    return scheduleNotifyImpl(sseWatchersCtx);
  }
  function closeSpecWatchers() {
    return closeSpecWatchersImpl(sseWatchersCtx);
  }

  // --- spec 204: a spec is a folder, and a folder changes no job -----------
  //
  // The two callers above are both the queue's own: a job moving, and
  // `POST /api/aide-run`. A spec created any other way — a `git pull`,
  // a hand-run `/aide-create`, a headless run's commit landing — writes
  // a directory and touches no job at all, so nothing was told and the
  // page stayed as it was until somebody reloaded it. Four specs added
  // on 2026-08-23 spent the day invisible that way.
  //
  // Each allowed project's specs root, and nothing wider: a recursive
  // watch on the projects root would fire on every `.git` internal,
  // `node_modules` entry and build artefact in every checked-out
  // project — the ground moving under the reader constantly, which is
  // the cost spec 189 already removed once.
  //
  // One echo comes with it, and is deliberately left alone: FSEvents
  // hands a fresh recursive watcher the changes made in the
  // milliseconds before it opened, so a server started right after
  // something wrote in a specs root broadcasts once at start-up. A page
  // open at that moment redraws once — which a reconnect already does —
  // and a page opened afterwards never hears it.
  const specWatchers = new Map<string, ReturnType<typeof watch>>();
  let notifySoon: ReturnType<typeof setTimeout> | null = null;
  if (opts.projectRoot) {
    for (const p of discoverProjects(opts.projectRoot)) {
      if (!allowed.has(p.name)) continue;
      try {
        specWatchers.set(p.name, watch(p.specsRoot, { recursive: true }, scheduleNotify));
      } catch {
        // A specs root that is missing or cannot be watched: the same
        // fail-open the git checks in this file already keep. The
        // five-second scan still catches up on the next redraw anything
        // else causes — only the "no reload needed" promise degrades.
      }
    }
  }
  // Built after `resolveProject`, which it takes. Nothing above it reads
  // it any more: `targets` used to ask the queue what it had run, and
  // spec 108 made the spec's own files the only answer to that.
  const queue = new QueueStore({
    mirrorPath: opts.queueMirrorPath,
    defaults: opts.queueDefaults ?? QUEUE_DEFAULTS,
    resolve: resolveProject,
    // The RAW allowlist, and only for creating (spec 93).
    // `resolveProject` requires a spec that already exists, which a
    // project's first spec by definition does not have — but that
    // requirement is right for every other route, so it is left exactly
    // as it is rather than widened for all of them.
    allowCreateProject: (project) => allowed.has(project),
    // Every write to a job passes through this store, so one hook here
    // covers the runner's step transitions, the page's own presses and
    // the API's alike (spec 189).
    onChange: notifyQueueChanged,
  });

  // The runner exists only when a binary is configured. Spawned
  // DETACHED, in its own process group: measured on the mini, such a
  // child survives `launchctl bootout`, so a redeploy does not kill a
  // run — and the group is what SIGTERM must reach, since claude spawns
  // children of its own.
  const notifier = new Notifier({ command: opts.queueNotifyCommand });
  // What tells claude-usage a branch landed (spec 158). Inert without a
  // URL, and never given a default one: a dashboard nobody has pointed
  // at a claude-usage makes no request at all.
  const mergeEvents = new MergeEventReporter({ url: opts.mergeEventUrl, fetch: opts.mergeEventFetch });
  // Two resolutions since spec 205, and every caller picks one
  // deliberately. `displayProjectDir` is the checkout a PERSON edits —
  // what the spec list, the project pages and the manifests are read
  // from, and the only thing it is ever used for. Nothing here writes to
  // it: a run that branched, merged and pushed from the directory
  // somebody was working in is what stranded three specs' code on
  // 2026-08-23.
  // Where the dashboard's OWN clones live. Named as an option so a test
  // can put them in a temp directory; there is no other reason to move
  // them.
  const checkoutBase = opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT;
  /** What `ensureCheckout` last worked out, so the SYNC readers can ask
   *  where a project's own specs are without awaiting a clone. Empty
   *  until the first ensure settles, which is what the fallback below is
   *  for. */
  const resolvedCheckouts = new Map<string, DashboardCheckout>();
  /** The last thing said about each project, so a refusal that has not
   *  changed is not said again. Every tick asks, and a project whose
   *  origin is unreachable would otherwise fill the log with one line
   *  every two seconds for as long as the server runs. */
  const saidAbout = new Map<string, string>();

  const projectCheckoutCtx: ProjectCheckoutContext = {
    queueProjectRoot: opts.queueProjectRoot,
    checkoutBase,
    resolvedCheckouts,
    saidAbout,
    targets,
    readScan: () => scan,
  };
  function displayProjectDir(project: string) {
    return displayProjectDirImpl(projectCheckoutCtx, project);
  }
  function machineryProjectDir(project: string) {
    return machineryProjectDirImpl(projectCheckoutCtx, project);
  }
  function codeLanding(project: string) {
    return codeLandingImpl(projectCheckoutCtx, project);
  }
  function promptFileFor(job: Job, step: string) {
    return promptFileForImpl(projectCheckoutCtx, job, step);
  }
  function ownedSpecsRoot(project: string) {
    return ownedSpecsRootImpl(projectCheckoutCtx, project);
  }
  function machinerySpecsRoot(project: string) {
    return machinerySpecsRootImpl(projectCheckoutCtx, project);
  }
  function complain(project: string, said: string) {
    return complainImpl(projectCheckoutCtx, project, said);
  }
  const checkoutEnsurer = new CheckoutEnsurer((project) =>
    ensureDashboardCheckout(gitRun, {
      base: checkoutBase,
      project,
      personDir: displayProjectDir(project),
    })
      .then((result) => {
        if (result.ok) saidAbout.delete(project);
        else complain(project, result.error ?? "it could not be made");
        if (result.checkout) resolvedCheckouts.set(project, result.checkout);
        return result.checkout;
      })
      .catch((err) => {
        complain(project, String(err));
        return undefined;
      }),
  );
  /** Make the dashboard's own checkout if it is not there, and answer
   *  where it is. One promise per project at a time: two requests
   *  arriving together must not run two `git clone`s into one directory.
   *
   *  A project whose clone CANNOT be made — no origin, an unreachable
   *  one — answers `undefined`, and every caller falls back to the
   *  checkout it used before this spec. That keeps a project the
   *  dashboard cannot clone working exactly as it always did instead of
   *  losing Save and Update outright; the readiness check is where that
   *  state is reported, by name, on the project's own page. */
  const ensureCheckout = (project: string): Promise<DashboardCheckout | undefined> => checkoutEnsurer.get(project);
  // One runner, two users now: the read path asks whether a branch
  // landed, the write path lands it.
  const gitRun: GitRunner = opts.gitRun ?? createGitRunner();
  const branchStatus = new BranchStatusChecker({ run: gitRun });

  const specLookupCtx: SpecLookupContext = {
    machineryProjectDir,
    machinerySpecsRoot,
    branchStatus,
    codeLanding,
    targets,
    readScan: () => scan,
    writeScan: (s) => {
      scan = s;
    },
    projectRoot: opts.projectRoot,
    allowed,
    ownedSpecsRoot,
    gitRun,
    resolvedCheckouts,
    ensureCheckout,
  };
  function targets() {
    return targetsImpl(specLookupCtx);
  }
  function specRoots(project: string) {
    return specRootsImpl(specLookupCtx, project);
  }
  function rootsStillHolding(project: string, branch: string, fresh: boolean) {
    return rootsStillHoldingImpl(specLookupCtx, project, branch, fresh);
  }
  function peekUnlanded(): string[] {
    const result = peekUnlandedImpl(specLookupCtx);
    unlanded = result.unlanded;
    prOpen = result.prOpen;
    return unlanded;
  }
  function peekUnlandedCheckedAt() {
    return peekUnlandedCheckedAtImpl(specLookupCtx);
  }
  function specDir(project: string, specFolder: string) {
    return specDirImpl(specLookupCtx, project, specFolder);
  }
  function specRef(project: string, specFolder: string) {
    return specRefImpl(specLookupCtx, project, specFolder);
  }
  function dependencyFolders(project: string, dir: string) {
    return dependencyFoldersImpl(specLookupCtx, project, dir);
  }
  function specsRoot(dir: string) {
    return specsRootImpl(specLookupCtx, dir);
  }
  function machinerySpecDir(project: string, dir: string) {
    return machinerySpecDirImpl(specLookupCtx, project, dir);
  }
  function peekMachinerySpecDir(project: string, dir: string) {
    return peekMachinerySpecDirImpl(specLookupCtx, project, dir);
  }

  // How long ONE spec answer stands, and how often it is retaken, are
  // the same number since spec 208 — because nothing but the schedule
  // takes them any more. Two numbers here is how a fast schedule
  // starves: every tick inside the window finds the entry still current
  // and asks git nothing, so the answer never moves.
  //
  // `0` means the schedule is OFF, which is a test seam and not a
  // window — the checkers keep their own default there, so an answer
  // put in by hand still stands.
  const specCachePollMs = opts.specCachePollMs ?? DEFAULT_TTL_MS;
  const specCacheTtlMs = specCachePollMs > 0 ? specCachePollMs : DEFAULT_TTL_MS;
  // Spec 203: the drift check runs on a schedule of its own, and the
  // page render reads whatever it last found. This loop IS the loop
  // that used to sit inside the `GET /projects` handler — nothing about
  // its logic changed, only when it runs. It ran there on every cache
  // miss, which is every project on boot and every project again each
  // time the window expired, and a page load waited on a `git fetch`
  // against GitHub per project: /projects measured 1.83 s against 0.04 s
  // for the pages beside it, and got slower with every project added.
  //
  // Asked only of the projects that expect an install to have happened
  // — deploying is a known hand step where none is configured, and a
  // banner there would be noise on every row forever.
  // Built once, from the same locals the schedules in schedules.ts used
  // to close over directly. Five fields ride as getters rather than
  // values — see `ScheduleContext`'s own doc comment — because this is
  // built here, before the checkers and the runner it reads are
  // constructed a little further down, so that `refreshDrift`'s wrapper
  // can be called immediately below, exactly where the inline function
  // used to be called.
  let warming = false;
  const scheduleCtx: ScheduleContext = {
    projectRoot: opts.projectRoot,
    machineryProjectDir,
    branchStatus,
    readWorkflowHistory: () => workflowHistory,
    readFreshness: () => freshness,
    readSpecCreatedAt: () => specCreatedAt,
    readSpecFileCommits: () => specFileCommits,
    targets,
    readScan: () => scan,
    allowed,
    ensureCheckout,
    getWarming: () => warming,
    setWarming: (v) => {
      warming = v;
    },
    queue,
    specRoots,
    readRunner: () => runner,
    checkoutEnsurer,
  };
  function refreshDrift() {
    return refreshDriftImpl(scheduleCtx);
  }
  function warmSpec(t: { dir?: string; specFolder: string; reopenedAfter?: string }) {
    return warmSpecImpl(scheduleCtx, t);
  }
  function refreshSpecCaches() {
    return refreshSpecCachesImpl(scheduleCtx);
  }
  function refreshSchedules() {
    return refreshSchedulesImpl(scheduleCtx);
  }
  function tickRunner() {
    return tickRunnerImpl(scheduleCtx);
  }
  // The checker's own TTL by default: the window the answer was already
  // considered current for is the window worth re-taking it in.
  const driftPollMs = opts.driftPollMs ?? DEFAULT_TTL_MS;
  // `.unref()`'d and cleared in `stop()`, like the runner's tick and the
  // SSE keep-alive below — `bun test` runs many suites in one process,
  // and a timer from a stopped test's server would go on firing into
  // the next one.
  const driftTimer =
    driftPollMs > 0
      ? (() => {
          void refreshDrift();
          return setInterval(() => void refreshDrift(), driftPollMs);
        })()
      : null;
  driftTimer?.unref?.();
  // One merge at a time per repo. Every spec shares the specs root, and
  // two specs in one project share that repo too, so two presses a few
  // milliseconds apart were two git sequences in one working tree.
  const mergeLock = createRootLock();
  // A third user of the same runner: has the description moved on since
  // the plan was written?
  const freshness = new DescriptionFreshnessChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // And a fourth: which steps this spec has actually had (spec 154).
  const workflowHistory = new WorkflowHistoryChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // A fifth: when the spec was MADE (spec 199). Git rather than the
  // queue, because the job store forgets a job once two hundred newer
  // ones exist and the folder's first commit is still there years on.
  const specCreatedAt = new SpecCreatedAtChecker({ run: gitRun, ttlMs: specCacheTtlMs });
  // And a sixth (spec 208): which commit last touched each spec file.
  // The spec page asked this four times per view with no cache of its
  // own — the one question here that was added without the treatment
  // every sibling already had.
  const specFileCommits = new SpecFileCommitChecker({ run: gitRun, ttlMs: specCacheTtlMs });

  // `.unref()`'d and cleared in `stop()` like every other timer in this
  // file — `bun test` runs many suites in one process, and a timer from
  // a stopped test's server would go on firing into the next one.
  const specCacheTimer =
    specCachePollMs > 0
      ? (() => {
          void refreshSpecCaches();
          return setInterval(() => void refreshSpecCaches(), specCachePollMs);
        })()
      : null;
  specCacheTimer?.unref?.();

  /** Spec 259: does any project's own `schedule:` entry have a fire due
   *  right now, and if so enqueue it. `refreshDrift`'s shape again — a
   *  SCHEDULE, not a cache window, and nothing but this timer ever asks
   *  the question (a manual "run now" goes through the ordinary queue
   *  form instead, `POST /api/queue`, and is unaffected by this).
   *
   *  Each project's manifest is read fresh on every tick
   *  (`resolveSchedule`, off the MACHINERY checkout), never cached: an
   *  operator who edits a cron expression sees the next tick honour it,
   *  not the next restart. Due-ness is `isDue`'s alone (acceptance
   *  criteria 1-3) — this loop supplies it the queue's own job history
   *  for the entry's tracking key and nothing else. `queue.enqueue`'s
   *  own refusal (an unknown project, a clash, a cap) is swallowed: a
   *  poll that cannot start a job this tick tries again next tick, the
   *  same as every other best-effort schedule in this file. */
  // The checker's own default TTL, the same as `driftPollMs`'s.
  const scheduleCheckMs = opts.scheduleCheckMs ?? DEFAULT_TTL_MS;
  // `.unref()`'d and cleared in `stop()`, like every other timer here.
  const scheduleTimer =
    scheduleCheckMs > 0
      ? (() => {
          void refreshSchedules();
          return setInterval(() => void refreshSchedules(), scheduleCheckMs);
        })()
      : null;
  scheduleTimer?.unref?.();

  const runnerSetupCtx: RunnerSetupContext = {
    store: queue,
    machineryProjectDir,
    queueRunnerBin: opts.queueRunnerBin,
    queueResultDir: opts.queueResultDir,
    queueConcurrency: opts.queueConcurrency,
    // `server` does not exist yet — see runner-setup.ts's file-level
    // comment for why this has to be a getter rather than a value.
    readServerPort: () => server.port,
    codeLanding,
    queuePush: opts.queuePush,
    promptFileFor,
    notifier,
    landNewSpec,
    landStepBranch,
    landArchivedSpec,
    landStoppedStepBranch,
  };
  const runner = createQueueRunner(runnerSetupCtx);

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
        void tickRunner();
      }, 2000)
    : null;
  timer?.unref?.();

  // Bun cuts a connection that has said nothing for `idleTimeout` (120
  // seconds, set on `Bun.serve` below for slow git work), and a page
  // watching a quiet queue is exactly such a connection. A comment
  // every 45 seconds keeps it open and costs the page nothing: an SSE
  // client ignores a line that starts with a colon.
  //
  // `.unref()` like the runner's timer, so it never holds the process
  // up — and cleared in `stop()` besides, because `bun test` runs many
  // suites in one process and a timer from a stopped test's server
  // would go on firing into the next one.
  const keepAlive = setInterval(() => {
    for (const c of [...watchers]) writeTo(c, ": ping\n\n");
  }, 45_000);
  keepAlive.unref?.();

  const queueToken = opts.queueToken;
  function queueGuard(req: Request, url: URL): Response | null {
    return queueGuardImpl(req, url, queueToken);
  }

  // Built once, from the same locals `handleQueue` always closed over
  // directly — see `HandleQueueContext`'s own doc comment for why
  // `scan` rides as a getter/invalidator pair instead of a value.
  const queueCtx: HandleQueueContext = {
    opts,
    nav,
    allowed,
    readScan: () => scan,
    invalidateScan: () => {
      scan = null;
    },
    targets,
    withFreshness,
    specDir,
    specRef,
    specsRoot,
    machinerySpecDir,
    watchers,
    writeTo,
    queue,
    displayProjectDir,
    machineryProjectDir,
    ownedSpecsRoot,
    ensureCheckout,
    gitRun,
    branchStatus,
    mergeLock,
    runner,
    tickRunner,
    queueToken,
    jobRow,
    installAfterMerge,
    persistAllowlist,
    answerProjectChange,
    archivedSpecRows,
    specPageView,
    jobDetailView,
  };

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.bindHost ?? "0.0.0.0",
    // Bun cuts an idle connection after 10 seconds when this is unset,
    // and a two-repo merge under load takes longer than that: the
    // browser got an empty reply and its own error page while the merge
    // itself completed. Every other route here answers in well under a
    // second, so raising the ceiling costs them nothing.
    idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (isQueuePath(path)) {
        const denied = queueGuard(req, url);
        if (denied) return denied;
        return handleQueue(queueCtx, req, url, path);
      }

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
        const stored = store.put(parsed.run, new Date().toISOString());
        // The second source a row reads (spec 189). Cost, subagent
        // count and live state arrive here and nowhere near the queue's
        // own store, so a push driven by that store alone would let
        // them sit still for the whole of a long step.
        notifyQueueChanged();
        return json({ ok: true, sessionId: stored.sessionId });
      }

      if (path === "/api/aide-runs") {
        if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
        const { rows, enriched } = await enricher.rows(store);
        return json({ generatedAt: new Date().toISOString(), enriched, rows });
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("method not allowed", { status: 405 });
      }

      const pwaAsset = servePwaAsset(path);
      if (pwaAsset) return pwaAsset;

      return serveStatic(opts.siteDir, path);
    },
  });

  const jobRowCtx: JobRowContext = { machineryProjectDir, displayProjectDir, queue, store };
  function jobRow(job: Job) {
    return jobRowImpl(jobRowCtx, job);
  }

  // Built once, from the same locals landBranch and its helpers in
  // land-branch.ts used to close over directly — `invalidateScan` is
  // the same getter/invalidator shape `queueCtx.invalidateScan` uses,
  // closing over the same `scan` `let`.
  const landCtx: LandContext = {
    machineryProjectDir,
    codeLanding,
    queue,
    mergeLock,
    gitRun,
    branchStatus,
    mergeEvents,
    warmSpec,
    machinerySpecsRoot,
    specsRoot,
    jobRow,
    workflowHistory,
    specCreatedAt,
    freshness,
    rootsStillHolding,
    invalidateScan: () => {
      scan = null;
    },
    queueInstallTimeoutMs: opts.queueInstallTimeoutMs,
  };
  function landNewSpec(job: Job, outcome: Partial<StepOutcome>) {
    return landNewSpecImpl(landCtx, job, outcome);
  }
  function landStepBranch(job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>) {
    return landStepBranchImpl(landCtx, job, step, outcome);
  }
  function landStoppedStepBranch(job: Job, step: WorkflowStep, outcome: Partial<StepOutcome>) {
    return landStoppedStepBranchImpl(landCtx, job, step, outcome);
  }
  function landArchivedSpec(job: Job, outcome: Partial<StepOutcome>) {
    return landArchivedSpecImpl(landCtx, job, outcome);
  }
  function installAfterMerge(result: RepoMergeResult) {
    return installAfterMergeImpl(landCtx, result);
  }
  function withFreshness(list: QueueTarget[]) {
    return withFreshnessImpl(landCtx, list);
  }

  const projectActionsCtx: ProjectActionsContext = { queueConfigFile: opts.queueConfigFile, allowed };
  function persistAllowlist(what: string) {
    return persistAllowlistImpl(projectActionsCtx, what);
  }

  // Built once, from the same locals the view builders in
  // spec-views.ts used to close over directly — `readScan` and
  // `readPrOpen` ride as getters for the same reason `queueCtx.readScan`
  // does: both are `let`s reassigned after this context is built.
  const specViewsCtx: SpecViewsContext = {
    projectRoot: opts.projectRoot,
    targets,
    peekUnlanded,
    peekUnlandedCheckedAt,
    readPrOpen: () => prOpen,
    readScan: () => scan,
    queue,
    specDir,
    specRef,
    peekMachinerySpecDir,
    machinerySpecDir,
    dependencyFolders,
    gitRun,
    withFreshness,
    jobRow,
    queueToken,
    specFileCommits,
  };
  function archivedSpecRows(state: string | undefined) {
    return archivedSpecRowsImpl(specViewsCtx, state);
  }
  function specPageView(project: string, specFolder: string, tab?: string) {
    return specPageViewImpl(specViewsCtx, project, specFolder, tab);
  }
  function jobDetailView(job: Job) {
    return jobDetailViewImpl(specViewsCtx, job);
  }

  return {
    port: server.port,
    /** How many specs roots are being watched right now (spec 204).
     *  Here for one question nothing else can answer: that `stop()` let
     *  the handles go. A watcher nobody closes outlives the server for
     *  the life of the process, and the directories it points at are
     *  removed underneath it. */
    specWatchCount: () => specWatchers.size,
    // `server.stop` resolves once the last connection is closed. Nothing
    // here waits for that — the caller is shutting down — so the promise
    // is dropped on purpose rather than by accident.
    stop: () => {
      if (timer) clearInterval(timer);
      if (driftTimer) clearInterval(driftTimer);
      if (specCacheTimer) clearInterval(specCacheTimer);
      if (scheduleTimer) clearInterval(scheduleTimer);
      clearInterval(keepAlive);
      closeSpecWatchers();
      // Every watching page, let go of deliberately: `server.stop(true)`
      // cuts the sockets, and a controller left in the set would be
      // written to by nothing but would still be held.
      for (const c of [...watchers]) {
        try {
          c.close();
        } catch {
          // already gone, which is the outcome either way
        }
      }
      watchers.clear();
      void server.stop(true);
    },
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] !== "serve") {
    console.error(
      "usage: serve.ts serve --site DIR [--port N] [--bind ADDR] [--claude-usage URL]\n" +
        "                     [--mirror FILE] [--root DIR] [--token-file FILE]\n" +
        "                     [--queue-mirror FILE] [--queue-projects a,b]\n" +
        "                     [--runner-bin PATH] [--result-dir DIR] [--queue-config FILE]",
    );
    process.exit(2);
  }
  const opts = parseArgs(argv.slice(1));
  const s = createServer(opts);
  console.log(`aide-dashboard serving ${opts.siteDir} on :${s.port}`);
}
