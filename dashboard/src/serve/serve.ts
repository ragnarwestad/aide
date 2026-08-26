// The aide-dashboard server (spec 80): serves the generated static
// site, receives aide-run events (POST /api/aide-run), and renders
// /live through the generator's layout, enriched lazily from
// claude-usage's /api/live. Replaces the python3 static server on the
// serving host — same port, same launchd label.
//
// CLI: serve --site DIR [--port N] [--claude-usage URL] [--mirror FILE]

import {
  existsSync, mkdirSync, readFileSync, rmSync, watch,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { AideRunStore, parseAideRun } from "../queue/aide-run-store.ts";
import {
  BranchStatusChecker, createGitRunner, projectCheckout, specBranch, DEFAULT_TTL_MS,
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
  dashboardCheckoutRoot,
  dashboardSpecDir,
  ensureDashboardCheckout,
  type DashboardCheckout,
} from "../git/dashboard-checkout.ts";
import { LiveEnricher } from "../integrations/live.ts";
import {
  discoverProjects, resolveCodeLanding, resolveSchedule, specDependsOn,
  type CodeLanding, type SpecRef,
} from "../project/discover.ts";
import { parseManifest, type ManifestData } from "../project/parse-manifest.ts";
import { previewUrlFor } from "../git/preview-url.ts";
import {
  archiveHeldBackReason, parseStatus,
} from "../project/parse-status.ts";
import { Notifier } from "../integrations/notify.ts";
import { MergeEventReporter } from "../integrations/merge-event.ts";
import {
  QueueStore, mergeQueueDefaults, parseQueueProjects,
  persistQueueProjects,
  tailEdits,
  type BranchRef, type Job, type QueueDefaults, type ProjectResolver,
  type WorkflowStep,
} from "../queue/queue.ts";
import { type ProjectReadiness, type ProjectStep } from "../project/project-admin.ts";
import { Runner, type StepOutcome } from "../queue/runner.ts";
import {
  APPLE_TOUCH_ICON,
  APP_ICON,
  APP_ICON_MASKABLE,
  PROJECTS_ROUTE,
  navEntries,
  ADD_PROJECT_ROUTE,
  SERVICE_WORKER,
  WEBMANIFEST,
  type NavEntry,
  type QueueRowView,
  type QueueTarget,
} from "../render.ts";

import {
  QUEUE_DEFAULTS,
  json, readBounded, createRootLock,
  specsRedirect, logRefusal, navFromSite,
  serveStatic,
  resolveTimeoutSec, resolveStepModel, runnerArgv,
  DEFAULT_QUEUE_CONCURRENCY, parseQueueConcurrency, resolveDependencyFolder,
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
  const targets = (): QueueTarget[] => {
    const now = Date.now();
    if (scan && now - scan.at < 5000) return scan.targets;
    const found: QueueTarget[] = [];
    const gone: string[] = [];
    // Where every spec's four files are, ARCHIVED ONES INCLUDED (spec
    // 150). `targets` deliberately drops an archived spec — a ghost row
    // outliving the spec is what that costs — but the archive job that
    // moved it still has a page, and that page's whole content is the
    // stamp in the folder it moved to.
    const dirs = new Map<string, string>();
    // And WHAT each of them is, from the same walk (spec 163). `targets`
    // is live-only by design, so the page of an ARCHIVED spec looked its
    // title up in a list that could not hold it and rendered no
    // description line at all — silently, because the H1 comes from the
    // folder name. One lookup answers the title and whether the spec is
    // archived, for every spec there is.
    const refs = new Map<string, SpecRef>();
    const specsRoots = new Map<string, string>();
    if (opts.projectRoot) {
      for (const p of discoverProjects(opts.projectRoot, ownedSpecsRoot)) {
        if (!allowed.has(p.name)) continue;
        specsRoots.set(p.name, p.specsRoot);
        for (const s of p.specs) {
          dirs.set(`${p.name}/${s.folder}`, s.dir);
          refs.set(`${p.name}/${s.folder}`, s);
          // Remembered by key: a create job keeps its group visible
          // while its spec has not landed, and "archived" is the one
          // proof that it HAS — without it the ghost row outlives the
          // spec (seen with 111/112 on 2026-08-19).
          if (s.archived) {
            gone.push(`${p.name}/${s.folder}`);
            continue;
          }
          // What a reader needs to CHOOSE a spec: what it is called and
          // how far it has got. Both are already on disk.
          let statusText = "";
          try {
            statusText = readFileSync(join(s.dir, "4-status.md"), "utf-8");
          } catch {
            statusText = "";
          }
          const status = statusText ? parseStatus(statusText) : null;
          // Read from the SAME content, not a second pass over the file:
          // both answers come out of `4-status.md` and there is no
          // reason for the page to open it twice.
          const heldBack = statusText ? archiveHeldBackReason(statusText) : null;
          found.push({
            project: p.name,
            specFolder: s.folder,
            // Where the freshness check runs git. Never rendered — the
            // page has no use for an absolute path, and `targets` is
            // server-side only.
            dir: s.dir,
            title: s.title ?? undefined,
            description: s.description ?? undefined,
            // What its own 1-description.md says it builds on (spec 92),
            // shown on its row in the same words the run's dependency
            // refusal uses.
            dependsOn: s.dependsOn,
            phase: status?.phase ?? undefined,
            // The FILES, and nothing else (spec 108). It used to be
            // unioned with the queue's own record of what it ran, so
            // either one being true was enough — which is how an
            // archive job that finished without moving anything counted
            // as an archived spec, and how a phase could read "done" on
            // a row whose files said otherwise. What a job reported is
            // still shown, as a qualifier — in the row's own panel since
            // spec 195, not on the phase's line.
            //
            // One line of that file, and no inference from any other
            // (spec 139): each step writes its own name into
            // `4-status.md` once it has succeeded. The three heuristics
            // this replaces — the size of 2-analysis.md, a heading in
            // 3-solution.md, and 4-status.md's own progress percentage,
            // which used to be read on this line — each answered a
            // question next to the one being asked, and the first of
            // them marked spec 138 analysed before any analyze had run.
            // The percentage left the row entirely in spec 167.
            //
            // Since spec 154 the line is no longer the ANSWER, only a
            // claim: a model has to reach its last instruction to write
            // it and a copied folder brings a sibling's version along.
            // `withFreshness` fills `done` in from the runner's own
            // commits, and this is what it compares them against.
            fileSteps: status?.workflowSteps ?? [],
            // Where this spec's history starts, when it has been
            // reopened (spec 198). Read off the same content as
            // `fileSteps` and `heldBack`, for the same reason: three
            // answers out of `4-status.md` and no second pass over the
            // file.
            reopenedAfter: status?.reopenedAfter,
            archiveHeldBack: heldBack ? { reason: heldBack } : undefined,
          });
        }
      }
    }
    scan = { at: now, targets: found, archived: gone, dirs, refs, specsRoots };
    return found;
  };

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

  /** The two repositories a spec's work can be open in — the same pair
   *  the dependency gate asks across, and for the same reason: a spec
   *  merged in the code repo but not in the specs repo is not merged. */
  const specRoots = (project: string): string[] => {
    const code = machineryProjectDir(project);
    const specs = machinerySpecsRoot(project);
    const both = specs && resolve(specs) !== resolve(code) ? [code, specs] : [code];
    // Only roots that are THERE. A project with no specs root configured
    // resolves to `<project>/specs`, and two projects on this host have
    // never had one — asking git about a directory that does not exist
    // is not an unanswerable question, it is a question about nothing.
    return both.filter((d) => existsSync(d));
  };

  /** Which of a project's roots still have `branch` on origin. A root
   *  that cannot be ASKED contributes nothing: an unanswerable question
   *  is not evidence, either way. */
  const rootsStillHolding = async (
    project: string,
    branch: string,
    fresh: boolean,
  ): Promise<string[]> => {
    const held: string[] = [];
    for (const root of specRoots(project)) {
      const open = await branchStatus.openSpecBranches(root, fresh);
      if (open?.has(branch)) held.push(root);
    }
    return held;
  };

  /** Rebuild `unlanded` from one `ls-remote` per ROOT — never one per
   *  spec. The archived keys come off the scan the page already keeps,
   *  and the intersection is done in memory. */
  const peekUnlanded = (): string[] => {
    targets();
    const keys = scan?.archived ?? [];
    if (keys.length === 0) {
      prOpen = [];
      return (unlanded = []);
    }
    const byProject = new Map<string, string[]>();
    for (const key of keys) {
      const cut = key.indexOf("/");
      const project = key.slice(0, cut);
      const list = byProject.get(project);
      if (list) list.push(key.slice(cut + 1));
      else byProject.set(project, [key.slice(cut + 1)]);
    }
    const found: string[] = [];
    const reviewing: string[] = [];
    for (const [project, folders] of byProject) {
      const open = new Set<string>();
      // Kept apart from the union above (spec 220): which ROOT holds a
      // branch is what tells "waiting on a review" from "the landing did
      // not finish", and folding the roots together loses it.
      const elsewhere = new Set<string>();
      const codeRoot = machineryProjectDir(project);
      const pr = codeLanding(project) === "pr";
      // A specs root INSIDE the project is the same repository, so it
      // holds the same one branch and answers `ls-remote` identically —
      // `specRoots` asks it separately because it compares paths, not
      // repos. Counting that as a second root would call every
      // single-repo project's review a failed landing, and paceup and
      // atlasaurus are both shaped that way.
      const separate = (root: string): boolean =>
        root !== codeRoot && !resolve(root).startsWith(resolve(codeRoot) + sep);
      for (const root of specRoots(project)) {
        // A root nobody has asked about yet peeks `null`, and `?? []`
        // makes it contribute nothing — the same way an unanswerable
        // one already did. That is what keeps this failing closed
        // without any new logic to get wrong.
        for (const branch of branchStatus.peekOpenSpecBranches(root).open ?? []) {
          open.add(branch);
          if (separate(root)) elsewhere.add(branch);
        }
      }
      for (const folder of folders) {
        const branch = specBranch(folder);
        if (!open.has(branch)) continue;
        found.push(`${project}/${folder}`);
        if (pr && !elsewhere.has(branch)) reviewing.push(`${project}/${folder}`);
      }
    }
    prOpen = reviewing;
    return (unlanded = found);
  };

  /** When the set was last taken, for the archive page's own label: an
   *  answer this old is SHOWN with its age rather than withheld, the
   *  same treatment `driftNote` gives the commits-behind count. The
   *  OLDEST of the roots asked, because the badge speaks for all of
   *  them, and `null` where any root has never been asked at all. */
  const peekUnlandedCheckedAt = (): number | null => {
    targets();
    const keys = scan?.archived ?? [];
    let oldest: number | null = null;
    for (const key of keys) {
      for (const root of specRoots(key.slice(0, key.indexOf("/")))) {
        const { checkedAt } = branchStatus.peekOpenSpecBranches(root);
        if (checkedAt === null) return null;
        oldest = oldest === null ? checkedAt : Math.min(oldest, checkedAt);
      }
    }
    return oldest;
  };

  /** A spec's folder on this host, archived or not. Goes through
   *  `targets()` so it shares the 5-second scan rather than walking the
   *  projects root again — but what it returns is only WHERE the files
   *  are; the files themselves are read fresh on every request, which
   *  is the whole point of the Update button. */
  const specDir = (project: string, specFolder: string): string | undefined => {
    targets();
    return scan?.dirs.get(`${project}/${specFolder}`);
  };
  /** What that spec IS — its title, and whether it has been archived
   *  (spec 163). Through the same 5-second scan `specDir` goes through,
   *  and unlike `targets()` it answers for an archived spec too. */
  const specRef = (project: string, specFolder: string): SpecRef | undefined => {
    targets();
    return scan?.refs.get(`${project}/${specFolder}`);
  };
  /** What a spec's `Depends on:` line RESOLVES to, folder by folder
   *  (spec 174) — which boxes the Edit page's picker ticks.
   *
   *  Through `resolveDependencyFolder`, the same reader the save route
   *  and the runtime gate use, because the line is written by hand as
   *  often as by the page and `164` is what a person types. An
   *  identifier nothing matches simply ticks nothing: this is a form
   *  being drawn, not a run being gated, and the refusal for a typo
   *  belongs to Save and to `aide-run-spec`.
   *
   *  Not `targets()`: an entry may name an already-archived spec, which
   *  that scan drops. Such an entry ticks no box either — the picker
   *  offers live specs only — but it must not be mistaken for one that
   *  resolves to a live one. */
  const dependencyFolders = (project: string, dir: string): string[] => {
    const ids = specDependsOn(dir);
    if (ids.length === 0 || !opts.projectRoot) return [];
    const discovered = discoverProjects(opts.projectRoot).find((p) => p.name === project);
    if (!discovered) return [];
    return ids.flatMap((id) => {
      const dep = resolveDependencyFolder(discovered, id);
      return dep && !dep.archived ? [dep.folder] : [];
    });
  };

  /** The checkout a spec folder sits in — the lock key for everything
   *  that touches the specs repository (spec 162).
   *
   *  `createRootLock`'s own docstring says what it is for: "per repo
   *  ROOT, not global: two requests that touch no directory in common
   *  cannot collide." The Update button was locking on `specDir(...)`,
   *  the individual spec's subfolder, and every project and every spec
   *  in a specs checkout shares ONE `.git` — so two presses on
   *  different specs were given different keys and ran two git
   *  sequences in one working tree. Latent while the only write was a
   *  fast-forward merge; not latent beside a Save that writes, commits
   *  and pushes.
   *
   *  Read-only and outside the lock, which is where it has to be: it is
   *  what decides which lock to take. A directory git will not answer
   *  for keys on itself, which is what the routes did before and is no
   *  worse — the save's own first question refuses it by name. */
  const specsRoot = async (dir: string): Promise<string> => {
    const top = await gitRun(dir, ["rev-parse", "--show-toplevel"]);
    return top.code === 0 && top.stdout.trim() ? top.stdout.trim() : dir;
  };

  /** The dashboard's own copy of the spec folder the display found
   *  (spec 205). Save COMMITS and PUSHES, and Update merges — all three
   *  are writes, and the checkout a person edits stopped taking writes
   *  from the dashboard.
   *
   *  The translation is needed rather than a second closure because the
   *  routes do not resolve a project root at all: `specDir()` hands them
   *  a directory off the scan of the projects root, and what they need
   *  is the same folder inside the clone the dashboard owns.
   *
   *  Falls back to the person's folder when there is no such clone —
   *  see `ensureCheckout`: a project the dashboard cannot clone keeps
   *  working exactly as it did before this spec. */
  const machinerySpecDir = async (project: string, dir: string): Promise<string> => {
    // The cached answer where there is one: this runs on every spec
    // page, every edit form and every save, and `ensureDashboardCheckout`
    // spawns git twice to work out where a project's specs are. Boot,
    // the runner's tick and the Settings route all re-ensure, so a
    // specs root that moves still reaches this map.
    const checkout = resolvedCheckouts.get(project) ?? (await ensureCheckout(project));
    if (!checkout) return dir;
    targets();
    const personSpecs = scan?.specsRoots.get(project);
    const translated = personSpecs ? dashboardSpecDir(checkout, personSpecs, dir) : null;
    return translated ?? dir;
  };

  /** The same translation, without ever awaiting a clone (spec 208).
   *
   *  `ensureCheckout` is started at boot for every allowed project, but
   *  a clone of this very repo measured 4.3 s (spec 205's own analysis)
   *  — so a spec page opened during the first minutes of a restart
   *  joined that promise and held the reader for its whole duration,
   *  showing the OLD page unchanged while it did. That is the literal
   *  shape of "the app answers at once and never waits on git" stated
   *  as a bug.
   *
   *  So "not made yet" now behaves exactly as "cannot be made" already
   *  did: fall back to the person's own folder, which is what every
   *  project used before spec 205 existed and what a project the
   *  dashboard cannot clone still uses. The clone goes on in the
   *  background and the next view reads through it.
   *
   *  READ paths only, and only the ones with no form on them.
   *  `machinerySpecDir` is untouched and its other callers still await:
   *  the spec page's own Description TAB (spec 212, where `/edit` used
   *  to be) has to read through the SAME checkout Save will later write
   *  through, or Save's compare-stamp check refuses as "changed since
   *  you opened it" the first time anyone edits a spec shortly after a
   *  restart. */
  const peekMachinerySpecDir = (project: string, dir: string): string => {
    const checkout = resolvedCheckouts.get(project);
    if (!checkout) {
      // Started, not waited on — so a page opened before the boot-time
      // ensure settles still gets the clone going for the next one.
      void ensureCheckout(project);
      return dir;
    }
    targets();
    const personSpecs = scan?.specsRoots.get(project);
    return (personSpecs ? dashboardSpecDir(checkout, personSpecs, dir) : null) ?? dir;
  };

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

  /** Write to one watcher, and forget it the moment it refuses. A tab
   *  that has gone away throws on enqueue, and a broadcast that let
   *  that through would stop at the first dead page and leave every
   *  live one unaware — the same fail-open the rest of this surface
   *  keeps (`LiveEnricher`, `branch-status`). */
  const writeTo = (c: ReadableStreamDefaultController<Uint8Array>, text: string): void => {
    try {
      c.enqueue(encoder.encode(text));
    } catch {
      watchers.delete(c);
    }
  };

  /** Something a row is drawn from moved. Called from the queue's own
   *  write hook below and from `POST /api/aide-run` — the two sources a
   *  row reads, and the second is invisible to the first. A copy of the
   *  set is walked because `writeTo` removes from it. */
  const notifyQueueChanged = (): void => {
    for (const c of [...watchers]) writeTo(c, "event: changed\ndata: {}\n\n");
  };

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
  /** A `git pull` writes a hundred files; the page needs telling once. */
  const scheduleNotify = (): void => {
    if (notifySoon) clearTimeout(notifySoon);
    notifySoon = setTimeout(() => {
      notifySoon = null;
      // Before the event, never after: the page answers by asking for
      // the rows, and those come off a scan cached for five seconds.
      // Told to redraw and handed the same list it already had, it
      // would sit there with nothing further coming.
      scan = null;
      notifyQueueChanged();
    }, 300);
  };
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
  /** Every watcher opened above, closed. Called by `stop()`, which runs
   *  before a test removes the directories they point at. */
  const closeSpecWatchers = (): void => {
    if (notifySoon) clearTimeout(notifySoon);
    notifySoon = null;
    for (const w of specWatchers.values()) {
      try {
        w.close();
      } catch {
        // already gone, which is the outcome either way
      }
    }
    specWatchers.clear();
  };

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
  const displayProjectDir = (project: string) => projectCheckout(opts.queueProjectRoot, project);
  // Where the dashboard's OWN clones live. Named as an option so a test
  // can put them in a temp directory; there is no other reason to move
  // them.
  const checkoutBase = opts.dashboardCheckoutRoot ?? DEFAULT_DASHBOARD_CHECKOUT_ROOT;
  // The other resolution: the checkout a RUN is cut from, a landing
  // merges into, and Save commits in. One `existsSync`, so the readers
  // that only need to know WHERE it is — the drift poll's key, the
  // origin check's root — cost nothing and await nothing.
  //
  // FALLS BACK to the person's checkout while the dashboard has none of
  // its own. That is not a shortcut, it is the upgrade path: a project
  // added before this spec, or one whose clone cannot be made at all,
  // goes on working exactly as it did instead of losing its runs, its
  // Save and its Update the day this ships. `ensureCheckout` is what
  // moves it over, and the readiness check is where a clone that cannot
  // be made is reported by name.
  const machineryProjectDir = (project: string): string => {
    const owned = dashboardCheckoutRoot(checkoutBase, project);
    return existsSync(join(owned, ".git")) ? owned : displayProjectDir(project);
  };
  /** Whether this project's archived code merges into its default branch
   *  or waits for a pull request (spec 220), read fresh off the
   *  MACHINERY's checkout — the one a run is cut from and a landing
   *  merges in, so the answer is the one the work is actually done
   *  against.
   *
   *  Read per call rather than cached: it is one small YAML file, the
   *  same cost class as the `4-status.md` reads `targets()` already does
   *  per spec, and an operator changing the choice on the settings page
   *  should see the next job honour it rather than the next restart. */
  const codeLanding = (project: string): CodeLanding => resolveCodeLanding(machineryProjectDir(project));

  /** The file a `schedule` step's prompt is read from (spec 259),
   *  resolved fresh off the manifest at spawn time — the same
   *  per-call, off-disk reading `codeLanding` above already does, so an
   *  edit to an entry's `prompt:` path takes effect on the next run
   *  rather than the next restart. `undefined` for every step but
   *  `schedule`, and for a schedule job whose entry has since been
   *  removed from the manifest: `aide-run-spec` refuses by name when
   *  `--prompt-file` is missing or the file is gone, rather than this
   *  guessing at one. */
  const promptFileFor = (job: Job, step: string): string | undefined => {
    if (step !== "schedule") return undefined;
    if (!job.specFolder.startsWith("schedule-")) return undefined;
    const name = job.specFolder.slice("schedule-".length);
    return resolveSchedule(machineryProjectDir(job.project)).find((e) => e.name === name)?.prompt;
  };

  /** What `ensureCheckout` last worked out, so the SYNC readers can ask
   *  where a project's own specs are without awaiting a clone. Empty
   *  until the first ensure settles, which is what the fallback below is
   *  for. */
  const resolvedCheckouts = new Map<string, DashboardCheckout>();
  /** Where a project's spec folders are LISTED from (spec 218): the
   *  dashboard's own checkout once one has been resolved, and nothing
   *  otherwise — `discoverProjects` then walks the person's own, exactly
   *  as everything did before spec 205.
   *
   *  The same source a run resolves `--spec` against, which is the whole
   *  point: a folder committed in the person's checkout and never pushed
   *  used to get a row offering four steps, and every one of them
   *  refused with `unknown spec`. Sync and cache-only on purpose — a
   *  render never waits on a clone (spec 208), and `refreshSpecCaches`
   *  is what keeps the answer current.
   *
   *  Passed to every walk that lists specs FOR A READER, and to no
   *  other: the `fs.watch` loop watches the person's own checkout for
   *  local edits and must go on watching it, and `refreshDrift` reads
   *  nothing off the walk but `p.name`. */
  const ownedSpecsRoot = (project: string): string | undefined => resolvedCheckouts.get(project)?.specs;
  /** The specs root the machinery works in: the dashboard's own once it
   *  has one, and otherwise the scan's answer — the person's, which is
   *  the root everything used before this spec. */
  const machinerySpecsRoot = (project: string): string | undefined => {
    const owned = resolvedCheckouts.get(project);
    if (owned) return owned.specs;
    targets();
    return scan?.specsRoots.get(project);
  };
  /** The last thing said about each project, so a refusal that has not
   *  changed is not said again. Every tick asks, and a project whose
   *  origin is unreachable would otherwise fill the log with one line
   *  every two seconds for as long as the server runs. */
  const saidAbout = new Map<string, string>();
  const complain = (project: string, said: string): void => {
    if (saidAbout.get(project) === said) return;
    saidAbout.set(project, said);
    console.error(`queue: the dashboard's own checkout of ${project} — ${said}`);
  };
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

  const runner = opts.queueRunnerBin
    ? new Runner({
        store: queue,
        projectDir: machineryProjectDir,
        runnerBin: opts.queueRunnerBin,
        resultDir: opts.queueResultDir ?? join(homedir(), "aide-dashboard", "jobs"),
        maxConcurrent: opts.queueConcurrency ?? DEFAULT_QUEUE_CONCURRENCY,
        now: () => new Date().toISOString(),
        today: () => new Date().toISOString().slice(0, 10),
        spawn: (job, step, resultFile, sessionId, streamFile) => {
          mkdirSync(dirname(resultFile), { recursive: true });
          // Spec 222. `aide-emit-run` reports each TDD phase and is
          // inert unless `AIDE_RUN_URL` says where — so a headless step
          // reported into silence, because nothing from launchd down to
          // the spawned `claude` ever set it. This server knows its own
          // address, so it tells the step where to report, and no
          // machine needs configuring for it.
          //
          // `server` is declared further down this function, but this
          // callback is only ever CALLED from the polling
          // `runner.tick()` timer — long after `Bun.serve()` has
          // returned — so the read is never a TDZ error. It has to be
          // `server.port` and not `opts.port`: `port: 0` means "let the
          // OS pick", and every test in this suite starts that way.
          const selfRunUrl = `http://127.0.0.1:${server.port}/api/aide-run`;
          const proc = Bun.spawn({
            cmd: runnerArgv(
              job,
              step,
              resultFile,
              {
                runnerBin: opts.queueRunnerBin!,
                projectDir: machineryProjectDir(job.project),
                // Spec 220. The global setting speaks for every project
                // on this host at once; a project that reviews its code
                // says so in its own committed manifest, and that
                // answer wins. It only ever raises the mode TO `pr` —
                // `merge` is the absence of an opinion, not an
                // instruction to publish less than the host asked for.
                //
                // Both halves have to travel together: `landBranch`
                // below stops merging this project's code root, and a
                // branch left open with no pull request describing it
                // is worse than either behaviour on its own. Read per
                // spawn, off disk, the same way `projectManifest` is
                // read per render — one small YAML file, and an edit
                // takes effect on the next job rather than the next
                // deploy.
                push: codeLanding(job.project) === "pr" ? "pr" : (opts.queuePush ?? "branch"),
                promptFile: promptFileFor(job, step),
                modelChoices: queue.defaults.modelChoices,
                timeoutSec: queue.defaults.timeoutSec,
                permissionMode: queue.defaults.permissionMode,
                model: queue.defaults.model,
              },
              sessionId,
              streamFile,
            ),
            // The spread is load-bearing. `Bun.spawn`'s `env`, once
            // given at all, REPLACES the child's environment rather
            // than layering onto it, and this call passed none before —
            // so the child inherited PATH, HOME and the credentials
            // `git` and `claude` need implicitly. An operator who has
            // already pointed reporting at another sink keeps it: the
            // derived URL is a default, never an override.
            env: { ...process.env, AIDE_RUN_URL: process.env.AIDE_RUN_URL ?? selfRunUrl },
            detached: true,
            // stdout is ignored (the result FILE is the contract), but
            // stderr goes to a per-job log: when the runner died
            // mid-job the first time, nothing on this machine said why.
            stdio: ["ignore", "ignore", Bun.file(`${resultFile}.log`)],
          });
          proc.unref();
          return { pid: proc.pid, pgid: proc.pid };
        },
        isAlive: (pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        readResult: (path) => {
          try {
            return JSON.parse(readFileSync(path, "utf-8")) as unknown;
          } catch {
            return null;
          }
        },
        notify: (event) => notifier.notify(event),
        // A step's work is invisible to this page until its branch is on
        // the default branch of the checkout the page reads — so every
        // step lands the work it produced, and nobody merges by hand
        // (spec 149). `create` and `archive` already did (specs 93 and
        // 136); `analyze` writes in the specs
        // repo exactly as those two do, so the same argument covers it
        // and it was simply never given it.
        //
        // `implement` is the one exception, and it is deliberate: the
        // code stays on the pushed branch, which is where a person tests
        // it — by leaving `archive` unticked. `archive` is therefore the
        // one step that sends CODE to a default branch, which is why it
        // has a landing of its own.
        //
        // The returned promise holds the queue for as long as the
        // landing takes; see `Runner.tick()`.
        onStepDone: (job, step, outcome) => {
          if (outcome.ok) {
            if (step === "create") return landNewSpec(job, outcome);
            // `reopen` lands for exactly the reason `analyze` does, and
            // for it the argument is not an improvement but the whole
            // feature (spec 198): the un-archived folder is what makes
            // the spec active again, this page reads the MAIN checkout,
            // and a reopen left on its branch would show nowhere at all
            // — "reopening is one action" would then still end with
            // somebody in a terminal.
            if (step === "analyze" || step === "reopen" || step === "reset") {
              return landStepBranch(job, step, outcome);
            }
            if (step === "archive") return landArchivedSpec(job, outcome);
            // `implement`, `explore` and `manifest` fall through: the first
            // by design, the other two because neither leaves a spec branch
            // for anyone to land.
            return undefined;
          }
          // A step stopped by its own clock still committed and pushed
          // whatever it had written before the deadline — `aide-run-spec`'s
          // commit loop runs on every path and the push is gated on the
          // push mode, not on `ok` (spec 187). Left on the branch, that
          // work is readable only by checking it out by hand: spec 184
          // stopped with a finished analysis nothing on this page
          // mentioned.
          //
          // What decides is what the run TOUCHED, never which step it
          // was. A run that moved a code root's HEAD is left exactly
          // where a failed run is left — the code waits on its branch for
          // `archive`, whether the step ran out of time or not — and there
          // is no second list of "which steps are safe" to keep in step
          // with the first.
          //
          // The wall clock and a provider limit both stop after the
          // runner has committed the work. A cost cap and a CLI error
          // have no such safe landing promise.
          if (
            !step ||
            (outcome.terminalReason !== "timeout" && outcome.terminalReason !== "provider-limit")
          ) return undefined;
          const codeRoots = new Set([machineryProjectDir(job.project)]);
          const pushed = outcome.branchUrls ?? [];
          if (pushed.length === 0 || pushed.some((r) => codeRoots.has(r.root))) return undefined;
          return landStoppedStepBranch(job, step, outcome);
        },
        clearResult: (path) => {
          try {
            rmSync(path, { force: true });
          } catch {
            /* nothing to clear */
          }
        },
      })
    : null;

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

      // What makes this page an app you install (spec 173): five
      // answers built in `render/pwa.ts` and served from memory, the
      // same shape /api/aide-run has — a computed string, an explicit
      // content type, no file on disk. None of them is behind the
      // token, deliberately: the manifest fetch that drives the install
      // prompt does not always carry the cookie, and a worker whose
      // script answers 401 never installs at all. There is nothing in
      // any of them a reader could not already see in the page's own
      // <head>.
      if (path === "/manifest.webmanifest") {
        return new Response(WEBMANIFEST, {
          headers: { "content-type": "application/manifest+json" },
        });
      }
      if (path === "/sw.js") {
        return new Response(SERVICE_WORKER, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            // A worker the browser is holding on to is a worker a fix
            // cannot reach; this makes it revalidate first.
            "cache-control": "no-cache",
          },
        });
      }
      if (path === "/icon-512.svg" || path === "/icon-512-maskable.svg") {
        // "512" names the size a launcher asks for, not the file: the
        // mark is vector, so one SVG answers every size.
        const icon = path === "/icon-512.svg" ? APP_ICON : APP_ICON_MASKABLE;
        return new Response(icon, { headers: { "content-type": "image/svg+xml; charset=utf-8" } });
      }
      if (path === "/apple-touch-icon.png") {
        return new Response(APPLE_TOUCH_ICON, { headers: { "content-type": "image/png" } });
      }

      return serveStatic(opts.siteDir, path);
    },
  });

  // Which repos this ONE job has a branch in. A job written before spec
  // 89 has `branchUrl` and no `branchUrls`; synthesising a one-entry
  // list from it reproduces the old single-repo behaviour verbatim,
  // rather than making every pre-existing job's link vanish on deploy.
  const jobBranches = (job: Job): BranchRef[] =>
    job.branchUrls?.length
      ? job.branchUrls
      : job.branchUrl
        ? [{ root: machineryProjectDir(job.project), url: job.branchUrl }]
        : [];

  // A repo's directory basename — `aide`, `aide-specs` — which is the
  // vocabulary the problem was described in. The full path is never sent
  // to the browser: the server re-derives every root itself on a POST.
  const repoLabel = (root: string): string => root.split(sep).filter(Boolean).pop() ?? root;

  // Read FRESH, per render, not once at startup: adding
  // `deployment.preview` to a manifest is an edit to a text file, and it
  // should show on the next page load rather than the next deploy. Same
  // cost class as the `4-status.md` reads `targets()` already does per
  // spec. No manifest, or an unreadable one, is not an error worth a
  // page over — it simply means this project has nothing to preview.
  const projectManifest = (project: string): ManifestData | undefined => {
    try {
      const text = readFileSync(join(displayProjectDir(project), ".aide", "project.yaml"), "utf-8");
      const result = parseManifest(text);
      return result.ok ? result.data : undefined;
    } catch {
      return undefined;
    }
  };

  async function jobRow(job: ReturnType<QueueStore["list"]>[number]): Promise<QueueRowView> {
    // The step whose model the row is about: the one running, or the
    // last one for a job that has finished.
    const step = job.steps[job.stepIndex] ?? job.steps[job.steps.length - 1];
    // Asked of EACH repo's own checkout. Asking the project's own root
    // about a branch that lives in the specs repo was not merely a
    // missing warning: a stale remote-tracking ref of the same name in
    // the project answered it cleanly, and the page said "merged" about
    // work that was not (1-description.md, "Measured again").
    const branch = specBranch(job.specFolder);
    // Asked of the project's OWN checkout only. A spec pushes a branch
    // of the same name to the repo holding its plan, and a plan is not
    // something anyone can open and try — the same distinction the merge
    // button already draws, drawn the same way, by comparing roots.
    const codeRoot = machineryProjectDir(job.project);
    const preview = projectManifest(job.project)?.deployment?.preview;
    const branchUrls = await Promise.all(
      jobBranches(job).map(async (b) => ({
        label: repoLabel(b.root),
        url: b.url,
        ...(b.root === codeRoot && { previewUrl: previewUrlFor(preview, branch) }),
      })),
    );
    return {
      id: job.id,
      project: job.project,
      specFolder: job.specFolder,
      // What a create job's row is called while its folder is still a
      // provisional key: `new-abc123de` says nothing to anyone.
      createTitle: job.createTitle,
      steps: job.steps,
      stepIndex: job.stepIndex,
      // Spec 160: which of them the row may still be given or relieved
      // of. Asked of the queue's own module, so the box and the route
      // that takes its tick cannot disagree about where the tail
      // starts.
      editableSteps: tailEdits(job),
      state: job.state,
      landing: job.landing,
      model: step ? resolveStepModel(job, step, queue.defaults.model) : job.modelChoice,
      spentUsd: job.spentUsd,
      // The stored split is five numbers; the page shows one. Flattened
      // here, at the boundary, so no render file has to know what a
      // result file looks like (spec 118).
      spentTokens: job.spentTokens,
      // One number, for the step this row speaks for: `stateLabel` puts
      // it into words ("stopped — 45 min") and has no step to resolve
      // against of its own.
      timeoutSec: resolveTimeoutSec(job.timeoutSec, step ?? "default", queue.defaults.timeoutSec),
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      branchUrls,
      // Spec 220: stored on the job, not derived here like `branchUrls`
      // — only the run that called `gh` knows the URL, and there is
      // nothing on this machine to work it out from.
      prUrl: job.prUrl,
      prError: job.prError,
      stopReason: job.stopReason,
      error: job.error,
      // Why the landing was refused, when it was refused for something
      // the row can act on. Stored on the job (spec 149), because a
      // landing has no browser to redirect the reason to.
      errorReason: job.errorReason,
      // Which third of an implement is running (spec 210). Only for
      // `implement`, which is the one step that reports its phases, and
      // only off the job's LIVE `sessionId` — the queue clears that the
      // moment a step ends, so a finished job cannot pick up a leftover
      // row from the session it once used.
      tddPhase:
        step === "implement" && job.state === "running" && job.sessionId
          ? store.get(job.sessionId)?.phase
          : undefined,
      results: job.results.map((r) => ({
        step: r.step, ok: r.ok, costUsd: r.costUsd, tokens: r.tokens?.total,
        // When the step ENDED (spec 199). The only per-step instant
        // there is — a job has one `startedAt` however many steps it
        // ran — so it is what a phase's own duration is sliced out of.
        at: r.at,
        // Carried, not dropped: the totals the list and the overview tab
        // build out of these results have no other way to know a figure
        // they are summing was over-charged (spec 152).
        costMeasured: r.costMeasured,
      })),
    };
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

  /** Write the allowlist back to the file the server reads on the way
   *  up, so an Add or a Remove survives a restart. Derived from the
   *  live `Set` and never from a copy of the file, which is what stops
   *  two changes a millisecond apart from losing each other.
   *
   *  Never fatal: the clone already happened, and the project IS on the
   *  allowlist in this process. But it is not silent either — a change
   *  that will vanish on the next restart is exactly the thing the
   *  operator has to be told, so it comes back as a failed step with
   *  the reason in it. */
  function persistAllowlist(what: string): ProjectStep {
    if (!opts.queueConfigFile) {
      return {
        step: "allowlist",
        ok: true,
        note: `${what}; this server has no --queue-config file, so the list is not saved across a restart`,
      };
    }
    const error = persistQueueProjects(opts.queueConfigFile, [...allowed].sort());
    return error
      ? { step: "allowlist", ok: false, error: `${what}, but it could not be saved and will be lost on restart: ${error}` }
      : { step: "allowlist", ok: true };
  }

  /** One answer shape for both project routes — the merge route's, step
   *  for step: `results[]` with `ok = every(...)`, so the page's own
   *  `refusalText()` renders an Add refusal exactly as it renders a
   *  merge's. Every refusal reaches `serve.log` too, which is the only
   *  record left once the page has moved on. */
  function answerProjectChange(
    action: string,
    project: string,
    steps: ProjectStep[],
    sent: unknown,
    wantsJson: boolean,
    /** What an Add that SUCCEEDED found out about the project it just
     *  registered (spec 138). It travels beside `results` and never
     *  inside it: `ok` says the registration completed, `canRun` says
     *  whether a run would start, and folding the second into the first
     *  would report a checkout that IS on disk as an add to retry. */
    readiness?: ProjectReadiness,
  ): Response {
    const ok = steps.every((s) => s.ok);
    for (const s of steps) if (s.error) logRefusal(action, project, s.error);
    if (wantsJson) {
      return json({ ok, project, results: steps, ...(readiness ? { readiness } : {}) }, ok ? 200 : 400);
    }
    const summary = steps.map((s) => s.error).filter(Boolean).join("; ");
    // A refusal goes back to the page the FORM is on — the Add page or
    // the row's own Remove page (2026-08-19) — a success to the list.
    const formPage =
      action === "add-project"
        ? ADD_PROJECT_ROUTE
        : action === "project-settings"
          // `?edit=1`: the settings table's edit state is server-rendered
          // (spec 255), so a refused save that dropped it would reopen on
          // the read-only view with the error attached to a form that is
          // no longer there.
          ? `/projects/${encodeURIComponent(project)}?edit=1`
          : `/projects/${encodeURIComponent(project)}/remove`;
    if (summary) return specsRedirect(sent, { error: summary }, formPage);
    // A browser with no script gets the readiness answer the only way a
    // redirect can carry one: in the query string of the page it lands
    // on. Without this the whole of it dies in a response body nobody
    // ever sees — which is how Skjer came to look added and be unable
    // to run.
    return specsRedirect(
      sent,
      undefined,
      action === "project-settings" ? `/projects/${encodeURIComponent(project)}` : PROJECTS_ROUTE,
      readiness && { note: readiness.note, ok: readiness.canRun },
    );
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

export function parseArgs(argv: string[]): ServerOptions {
  const opts: ServerOptions = { siteDir: join(homedir(), "aide-dashboard", "site"), port: 8788 };
  let root: string | undefined;
  let tokenFile: string | undefined;
  let queueConfigFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--site" && v) opts.siteDir = argv[++i]!;
    else if (a === "--port" && v) opts.port = Number(argv[++i]);
    else if (a === "--claude-usage" && v) opts.claudeUsageUrl = argv[++i];
    else if (a === "--mirror" && v) opts.mirrorPath = argv[++i];
    else if (a === "--root" && v) root = argv[++i];
    else if (a === "--bind" && v) opts.bindHost = argv[++i];
    else if (a === "--queue-mirror" && v) opts.queueMirrorPath = argv[++i];
    else if (a === "--queue-projects" && v) opts.queueProjects = argv[++i]!.split(",").map((s) => s.trim());
    else if (a === "--runner-bin" && v) opts.queueRunnerBin = argv[++i];
    else if (a === "--result-dir" && v) opts.queueResultDir = argv[++i];
    // Where the dashboard keeps the clones it works in (spec 205).
    // `~/aide-dashboard-checkouts` unless a host wants them elsewhere.
    else if (a === "--dashboard-checkouts" && v) opts.dashboardCheckoutRoot = argv[++i];
    else if (a === "--queue-config" && v) queueConfigFile = argv[++i];
    // The token is read from a FILE, never an argument: `ps` shows
    // arguments to every user on the machine.
    else if (a === "--token-file" && v) tokenFile = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.mirrorPath) opts.mirrorPath = join(homedir(), "aide-dashboard", "aide-runs.json");
  if (!opts.queueMirrorPath) opts.queueMirrorPath = join(homedir(), "aide-dashboard", "aide-queue.json");
  if (tokenFile) {
    // A missing or unreadable token file must not crash the server:
    // launchd would restart it in a loop and take the whole dashboard
    // down over a feature that is meant to fail closed, not loud.
    try {
      const token = readFileSync(tokenFile, "utf-8").trim();
      if (token) opts.queueToken = token;
      else console.error(`token file ${tokenFile} is empty — the queue stays off`);
    } catch {
      console.error(`cannot read ${tokenFile} — the queue stays off`);
    }
  }
  if (queueConfigFile) {
    // Kept whether or not the file is readable: the Add/Remove routes
    // write the allowlist back here, and a first install has no such
    // file yet (spec 112).
    opts.queueConfigFile = queueConfigFile;
    // A missing or broken config leaves the built-in caps in place —
    // the tight ones. Failing towards "spends less" is the only safe
    // direction here.
    try {
      const raw = parseJsonc(readFileSync(queueConfigFile, "utf-8")) as Record<string, unknown>;
      opts.queueDefaults = mergeQueueDefaults(QUEUE_DEFAULTS, raw);
      // The notify command is an argv ARRAY: it is run with no shell,
      // so a string would have to be split by someone, and that someone
      // would get quoting wrong.
      if (Array.isArray(raw.notifyCommand) && raw.notifyCommand.every((a) => typeof a === "string")) {
        opts.queueNotifyCommand = raw.notifyCommand as string[];
      }
      // Where a landed branch is reported (spec 158). Off unless the
      // file names a URL — the same direction every other key here
      // fails in, and the reason this one has no built-in default.
      if (typeof raw.mergeEventUrl === "string" && raw.mergeEventUrl) opts.mergeEventUrl = raw.mergeEventUrl;
      if (raw.push === "none" || raw.push === "branch" || raw.push === "pr") opts.queuePush = raw.push;
      opts.queueConcurrency = parseQueueConcurrency(raw.concurrency);
      // The allowlist WINS over `--queue-projects` when the file has
      // one: the flag is the seed for a first install, and the file is
      // what every Add and Remove since has written (spec 112). A
      // malformed field is ignored entirely, leaving the flag — the
      // same direction every other key here fails in.
      const projects = parseQueueProjects(raw.projects);
      if (projects) opts.queueProjects = projects;
    } catch {
      console.error(`cannot read ${queueConfigFile} — keeping the built-in caps`);
    }
  }
  if (root) {
    opts.projectRoot = root;
    // The checkouts and the manifests live under the same root here.
    opts.queueProjectRoot = root;
  }
  // The nav is the same three tabs whatever the projects are — a
  // project is reached from the Projects page, not from the bar. The
  // `navFromSite()` fallback below is what a server with no project
  // root uses, and it reads the site directory instead.
  if (root) opts.navEntries = navEntries();
  return opts;
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
