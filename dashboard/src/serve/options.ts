// createServer's own configuration surface — a pure type with no
// closure state, so moving it carries no risk the rest of that file's
// wiring does.

import type { NavEntry } from "../render.ts";
import type { Sentence } from "../i18n/message.ts";
import type { QueueDefaults } from "../queue/queue.ts";
import type { GitRunner } from "../git/branch-status.ts";
import type { RestartHook } from "./land-branch.ts";
import type { Spawner } from "./boards/lifecycle.ts";

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
  /** Where a model picked for a phase before any job exists survives to
   *  (spec 308) — the `pending-models.json` sibling of the queue
   *  mirror. Absent means such a pick is never durable, exactly as
   *  before this existed. */
  pendingModelsPath?: string;
  /** The sibling of `pendingModelsPath`, for an effort level picked
   *  before any job exists (spec 364) — the `pending-effort.json`
   *  sibling of the queue mirror. Absent means such a pick is never
   *  durable, exactly as before this existed. */
  pendingEffortPath?: string;
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
  /** Where a `schedule` step's own output lives, outside any worktree so
   *  it survives past the run (spec 272). Read by both the spawn (which
   *  writes the env var naming it) and the `/schedule-output/` route
   *  (which serves whatever landed there). Defaults to
   *  `DEFAULT_SCHEDULE_OUTPUT_ROOT`; named here so a test can put it
   *  somewhere it owns, the same reason `dashboardCheckoutRoot` is. */
  scheduleOutputRoot?: string;
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
  /** What restarts the dashboard server once a code-root install has
   *  succeeded, and how long that restart waits for other landings to
   *  clear first (spec 287). A test seam above all: every queue-route
   *  test reaches the real launchd calls otherwise, which is harmless
   *  on a machine with no job registered but a genuine hazard on one
   *  that has. Defaults to `createLaunchdRestart()`. */
  restart?: RestartHook;
  restartPollMs?: number;
  restartDeferTimeoutMs?: number;
  /** The checkout the running dashboard was started from. Only a landing
   *  into THIS root restarts the dashboard; another project's install is
   *  that project's own business. Defaults to the repo this file lives in. */
  dashboardRoot?: string;
  /** The landing's test gate; the real one runs the project's suite through
   *  aide-resolve-test-cmd and aide-record-test-run. Tests pass a stub. */
  landingGate?: (root: string, job: { project: string; specFolder: string }) => Promise<{ ok: boolean; error?: Sentence; detail?: string }>;
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
  /** Where `aide-generate-pdf` writes the PDF it makes (spec 358), keyed
   *  by project/specFolder/commit — outside every checkout, so a press
   *  never leaves an untracked file behind (REQ-4). Defaults to
   *  `DEFAULT_PDF_CACHE_DIR`; named here so a test can put it somewhere
   *  it owns, the same reason `dashboardCheckoutRoot` is. */
  pdfCacheDir?: string;
  /** Path to `aide-generate-pdf` — the same script `/aide-to-pdf` runs
   *  (REQ-3). A test seam: the test harness spawns a real filesystem and
   *  real git with no subprocess-mocking layer, and no test should
   *  depend on the real script actually running `md-to-pdf`. */
  pdfGeneratorBin?: string;
  /** Whether `md-to-pdf` is resolvable on this host, overriding the
   *  boot-time `Bun.which` check the same way `runnerAvailable` overrides
   *  its own live check (REQ-7) — a test seam, for the same reason
   *  `pdfGeneratorBin` is one: no test should depend on `md-to-pdf`
   *  actually being installed on the machine running `bun test`. */
  pdfToolAvailable?: boolean;
  /** A request header a proxy in front of this server sets to the
   *  signed-in user's name (spec 363) — the tailnet proxy's own header
   *  is the worked example in `deploying.md`. When a request's `header`
   *  carries one of `users`, it is admitted with no token and no
   *  cookie. Off unless set; refused at start-up unless `bindHost` is
   *  loopback (`127.0.0.1` or `::1`), since a header from anywhere else
   *  can be forged by anyone who can reach the port. */
  headerAuth?: { header: string; users: string[] };
  /** Where the board registry persists (spec 388) — the `boards.json`
   *  sibling of the queue mirror. Absent means a tracked board is never
   *  durable across a restart, exactly as `pendingModelsPath` absent
   *  behaves for a pending model pick. */
  boardsPath?: string;
  /** Overrides the boot-time "is the round available on this host" check
   *  (REQ-1), the same test-seam shape `pdfToolAvailable` already is: no
   *  test should depend on a real checkout carrying
   *  `dashboard/test/round/run`. */
  boardsAvailable?: boolean;
  /** Spawns the round script for a board (spec 388). A test seam: the
   *  real one is `Bun.spawn(..., { detached: true })` + `.unref()`, and
   *  no test should start a real round, which takes minutes and real
   *  model spend. */
  boardsSpawn?: Spawner;
  /** Polls whether a tracked board's own wrapper process is still alive
   *  (spec 388). A test seam, like `boardsSpawn`. */
  boardsIsAlive?: (pid: number) => boolean;
}
