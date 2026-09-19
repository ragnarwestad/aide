// The route handler for every /queue and /api/queue path, and the
// pages that live beside it ("New spec", Settings, Add/Remove
// project, a spec's own save/tick/reset routes). Extracted from
// `createServer` (spec: split serve.ts, step 2) — it is the single
// largest piece of that closure, and unlike `serve-helpers.ts` it is
// NOT closure-free: everything it used to read off `createServer`'s
// local scope now arrives explicitly through `ctx`, built once by
// `createServer` itself.
//
// The dispatcher body below is a short `??`-chain over themed route
// files under `routes/` (split of split serve.ts, step 3). The
// chain order matches the ORIGINAL route-match order exactly — several
// routes only work because a more specific route was tried first
// (`job-detail.ts`'s single-segment id regex would otherwise swallow
// `/api/queue/create` and friends), so the order is never to be
// changed without re-checking every regex for overlap.
import type { LogFilter } from "../../queue/parse-stream";
import type { GitRunner } from "../../git/branch-status.ts";
import type { BranchStatusChecker } from "../../git/branch-status.ts";
import type { RepoMergeResult } from "../../git/branch-merge.ts";
import type { DashboardCheckout } from "../../git/dashboard-checkout.ts";
import type { SpecRef } from "../../project/discover";
import type {
  Job, QueueStore,
} from "../../queue/queue.ts";
import type {
  ProjectReadiness,
  ProjectStep,
} from "../../project/project-admin";
import type { Runner } from "../../queue/runner";
import type {
  ArchivedSpecView,
  JobDetailView,
  NavEntry,
  QueueRowView,
  SpecTarget,
  SpecPageView,
} from "../../render";
import type { createRootLock } from "../serve-helpers";
import type { ServerOptions } from "../options.ts";
import type { TestServersContext } from "../test-servers/lifecycle.ts";
import { handlePageRoutes } from "./page-routes";
import { handleQueueEvents } from "./sse.ts";
import { handleQueueAdminRoutes } from "./queue-admin.ts";
import { handleJobActionRoutes } from "./job-actions.ts";
import { handleSpecEditRoutes } from "./spec-edit";
import { handleSpecPdfRoute } from "./spec-pdf.ts";
import { handleScheduleAdminRoutes } from "./schedule-admin-routes.ts";
import { handleJobDetailRoute } from "./job-detail.ts";
import { selfStopRoute } from "./self-stop.ts";
import { selfRunRoute } from "./self-run.ts";
import { failedCreateRoutes } from "./failed-create-routes.ts";
import { handlePushRoutes } from "./push-routes.ts";
import type { Push } from "../../push";
import type { ScheduleStore } from "../../queue/schedule-store.ts";

/** Everything `handleRoutes` used to read off `createServer`'s own
 *  closure, bundled so the function can live outside it. `createServer`
 *  builds one of these once, from the exact same locals it always had,
 *  and hands it to every call. `scan` is the one piece of MUTABLE
 *  closure state this function touches (it reads the current scan and
 *  invalidates it after a save/tick/create), so it is threaded through
 *  as a getter/invalidator pair rather than a value — a plain field
 *  would have captured whatever `scan` was at context-build time and
 *  never seen a later refresh. */
export interface RoutesContext {
  opts: ServerOptions;
  nav: () => NavEntry[];
  allowed: Set<string>;
  /** Where scheduled jobs are kept: the `schedules` key of the queue config file. */
  scheduleStore: ScheduleStore;
  readScan: () => { archived: string[] } | null;
  invalidateScan: () => void;
  /** Drop the cached branch answer for one spec (`dir`, `specFolder`),
   *  after a write that changed the file it caches. */
  forgetBranchFileSteps?: (dir: string, specFolder: string) => void;
  /** Read one spec's cached answers again now, and tell the page. */
  rereadSpec?: (dir: string, specFolder: string) => Promise<void>;
  targets: () => SpecTarget[];
  withFreshness: (list: SpecTarget[]) => SpecTarget[];
  specDir: (project: string, specFolder: string) => string | undefined;
  specRef: (project: string, specFolder: string) => SpecRef | undefined;
  specsRoot: (dir: string) => Promise<string>;
  machinerySpecDir: (project: string, dir: string) => Promise<string>;
  watchers: Set<ReadableStreamDefaultController<Uint8Array>>;
  phaseWatchers: Map<ReadableStreamDefaultController<Uint8Array>, Set<string>>;
  writeTo: (c: ReadableStreamDefaultController<Uint8Array>, text: string) => void;
  queue: QueueStore;
  displayProjectDir: (project: string) => string;
  machineryProjectDir: (project: string) => string;
  ownedSpecsRoot: (project: string) => string | undefined;
  ensureCheckout: (project: string) => Promise<DashboardCheckout | undefined>;
  gitRun: GitRunner;
  branchStatus: BranchStatusChecker;
  mergeLock: ReturnType<typeof createRootLock>;
  runner: Runner | null;
  tickRunner: () => Promise<void>;
  /** The port this server actually listens on (spec 363), read lazily
   *  the same way `runner-setup.ts`'s `readServerPort` is: `Bun.serve()`
   *  has not returned yet when this context is first assembled, so a
   *  captured value would be `undefined` for the request that fires
   *  before it does. Names the port-scoped sort/state cookies. */
  serverPort: () => number;
  jobRow: (job: ReturnType<QueueStore["list"]>[number]) => Promise<QueueRowView>;
  /** Runs the install; the restart it may call for comes back as a
   *  thunk, to be fired only once the answer has been composed. */
  installAfterMerge: (result: RepoMergeResult) => Promise<{ restart?: () => void }>;
  persistAllowlist: (what: string) => ProjectStep;
  answerProjectChange: (
    action: string,
    project: string,
    steps: ProjectStep[],
    sent: unknown,
    wantsJson: boolean,
    readiness?: ProjectReadiness,
  ) => Response;
  archivedSpecRows: (state: string | undefined) => ArchivedSpecView[];
  specPageView: (project: string, specFolder: string, tab?: string, only?: LogFilter) => Promise<SpecPageView | null>;
  jobDetailView: (job: Job, only?: LogFilter) => Promise<JobDetailView>;
  /** This process's own boot-time commit and the repo it runs from
   *  (spec 269) — see `state.ts`'s own doc comment for why both fields
   *  stay `null` rather than "loading" until the boot-time read
   *  resolves. */
  readServing: () => { sha: string | null; repoRoot: string | null };
  /** The Deploy tab's own pending-restart state (spec 385) — see
   *  `state.ts`'s `pendingRestart` for what it means. */
  readPendingRestart: () => { jobs: string[] } | null;
  setPendingRestart: (jobs: string[]) => void;
  /** Where `aide-generate-pdf` writes the PDF it makes (spec 358),
   *  outside every checkout (REQ-4). */
  pdfCacheDir: string;
  /** Path to `aide-generate-pdf` — the same script `/aide-to-pdf` runs
   *  (REQ-3). */
  pdfGeneratorBin: string;
  /** Whether `md-to-pdf` is resolvable on this host (REQ-7), resolved
   *  once at boot. */
  pdfToolAvailable: boolean;
  /** The board registry and everything `startTestServer`/`stopTestServer`
   *  (spec 388) need to reach the round without a second copy of its
   *  own worktree/checkout logic. */
  testServers: TestServersContext;
  /** What the self-stop route (spec 424) calls once its response has
   *  been sent — the real one is `() => process.exit(0)`, wired once in
   *  `serve.ts`. A test seam, like `testServers.spawn`: no test should
   *  actually end the process running it. */
  selfStopExit: () => void;
  /** The push notifications (spec 501): the subscribe and unsubscribe
   *  routes, and the public key the Settings panel hands a device. */
  push: Push;
}

export async function handleRoutes(ctx: RoutesContext, req: Request, url: URL, path: string): Promise<Response> {
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");

  return (
    selfStopRoute(ctx, req, path) ??
    selfRunRoute(ctx, req, path) ??
    (await handlePageRoutes(ctx, req, url, path)) ??
    handleQueueEvents(ctx, req, path) ??
    failedCreateRoutes(ctx, req, path, wantsJson) ??
    (await handleQueueAdminRoutes(ctx, req, path, wantsJson)) ??
    (await handlePushRoutes(ctx, req, url, path)) ??
    (await handleJobActionRoutes(ctx, req, path, wantsJson)) ??
    (await handleSpecEditRoutes(ctx, req, url, path, wantsJson)) ??
    (await handleSpecPdfRoute(ctx, req, path)) ??
    (await handleScheduleAdminRoutes(ctx, req, url, path, wantsJson)) ??
    (await handleJobDetailRoute(ctx, req, url, path)) ??
    new Response("not found", { status: 404 })
  );
}
