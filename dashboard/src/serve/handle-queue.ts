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
// files under `handle-queue/` (split of split serve.ts, step 3). The
// chain order matches the ORIGINAL route-match order exactly — several
// routes only work because a more specific route was tried first
// (`job-detail.ts`'s single-segment id regex would otherwise swallow
// `/api/queue/create` and friends), so the order is never to be
// changed without re-checking every regex for overlap.
import type { GitRunner } from "../git/branch-status.ts";
import type { BranchStatusChecker } from "../git/branch-status.ts";
import type { RepoMergeResult } from "../git/branch-merge.ts";
import type { DashboardCheckout } from "../git/dashboard-checkout.ts";
import type { SpecRef } from "../project/discover.ts";
import type {
  Job, QueueStore,
} from "../queue/queue.ts";
import type {
  ProjectReadiness,
  ProjectStep,
} from "../project/project-admin.ts";
import type { Runner } from "../queue/runner.ts";
import type {
  ArchivedSpecView,
  JobDetailView,
  NavEntry,
  QueueRowView,
  QueueTarget,
  SpecPageView,
} from "../render.ts";
import type { createRootLock } from "./serve-helpers.ts";
import type { ServerOptions } from "./options.ts";
import type { BoardsContext } from "./boards/lifecycle.ts";
import { handlePageRoutes } from "./handle-queue/page-routes.ts";
import { handleQueueEvents } from "./handle-queue/sse.ts";
import { handleQueueAdminRoutes } from "./handle-queue/queue-admin.ts";
import { handleJobActionRoutes } from "./handle-queue/job-actions.ts";
import { handleSpecEditRoutes } from "./handle-queue/spec-edit.ts";
import { handleSpecPdfRoute } from "./handle-queue/spec-pdf.ts";
import { handleScheduleAdminRoutes } from "./handle-queue/schedule-admin-routes.ts";
import { handleJobDetailRoute } from "./handle-queue/job-detail.ts";

/** Everything `handleQueue` used to read off `createServer`'s own
 *  closure, bundled so the function can live outside it. `createServer`
 *  builds one of these once, from the exact same locals it always had,
 *  and hands it to every call. `scan` is the one piece of MUTABLE
 *  closure state this function touches (it reads the current scan and
 *  invalidates it after a save/tick/create), so it is threaded through
 *  as a getter/invalidator pair rather than a value — a plain field
 *  would have captured whatever `scan` was at context-build time and
 *  never seen a later refresh. */
export interface HandleQueueContext {
  opts: ServerOptions;
  nav: () => NavEntry[];
  allowed: Set<string>;
  readScan: () => { archived: string[] } | null;
  invalidateScan: () => void;
  /** Drop the cached branch answer for one spec (`dir`, `specFolder`),
   *  after a write that changed the file it caches. */
  forgetBranchFileSteps?: (dir: string, specFolder: string) => void;
  targets: () => QueueTarget[];
  withFreshness: (list: QueueTarget[]) => QueueTarget[];
  specDir: (project: string, specFolder: string) => string | undefined;
  specRef: (project: string, specFolder: string) => SpecRef | undefined;
  specsRoot: (dir: string) => Promise<string>;
  machinerySpecDir: (project: string, dir: string) => Promise<string>;
  watchers: Set<ReadableStreamDefaultController<Uint8Array>>;
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
  queueToken: string | undefined;
  /** The port this server actually listens on (spec 363), read lazily
   *  the same way `runner-setup.ts`'s `readServerPort` is: `Bun.serve()`
   *  has not returned yet when this context is first assembled, so a
   *  captured value would be `undefined` for the request that fires
   *  before it does. Names the port-scoped token/sort/state cookies. */
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
  specPageView: (project: string, specFolder: string, tab?: string) => Promise<SpecPageView | null>;
  jobDetailView: (job: Job) => Promise<JobDetailView>;
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
  /** The board registry and everything `startBoard`/`stopBoard`
   *  (spec 388) need to reach the round without a second copy of its
   *  own worktree/checkout logic. */
  boards: BoardsContext;
}

export async function handleQueue(ctx: HandleQueueContext, req: Request, url: URL, path: string): Promise<Response> {
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");

  return (
    (await handlePageRoutes(ctx, req, url, path)) ??
    handleQueueEvents(ctx, req, path) ??
    (await handleQueueAdminRoutes(ctx, req, path, wantsJson)) ??
    (await handleJobActionRoutes(ctx, req, path, wantsJson)) ??
    (await handleSpecEditRoutes(ctx, req, url, path, wantsJson)) ??
    (await handleSpecPdfRoute(ctx, req, path)) ??
    (await handleScheduleAdminRoutes(ctx, req, url, path, wantsJson)) ??
    (await handleJobDetailRoute(ctx, req, url, path)) ??
    new Response("not found", { status: 404 })
  );
}
