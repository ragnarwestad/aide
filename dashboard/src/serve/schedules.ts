// The background schedules that keep every peek fed and the runner
// ticking (specs 203, 208, 259, 122) — pulled out of `createServer`'s
// closure the same way the earlier clusters were (spec: split serve.ts,
// step 5). An explicit context object stands in for the locals these
// functions used to read directly. The timers themselves (`setInterval`,
// `.unref()`, clearing in `stop()`) stay in `createServer`: only the
// work each tick does moves here.

import type { BranchStatusChecker } from "../git/branch-status.ts";
import { specBranch } from "../git/branch-status.ts";
import type {
  DescriptionFreshnessChecker, SpecCreatedAtChecker, SpecFileCommitChecker,
} from "../git/description-freshness.ts";
import type { WorkflowHistoryChecker } from "../git/workflow-history.ts";
import type { CheckoutEnsurer, DashboardCheckout } from "../git/dashboard-checkout.ts";
import {
  SPEC_FILES, buildProjectViews, configValue, discoverProjects, resolveSchedule, specArchivedDate,
} from "../project/discover.ts";
import { isDue, scheduleTrackingKey, type ScheduleJobRef } from "../queue/schedule.ts";
import { QueueStore } from "../queue/queue.ts";
import type { Runner } from "../queue/runner.ts";
import type { QueueTarget } from "../render.ts";
import { GATED, resolveDependencyFolder } from "./serve-helpers.ts";

/** Everything the schedules read off `createServer`'s closure, bundled
 *  the same way the earlier extractions' contexts are. `readScan` is
 *  the narrow slice of `scan` this file actually reads — never the
 *  whole shape — and `getWarming`/`setWarming` stand in for the
 *  `warming` `let`: a module-level flag here would be shared across
 *  every `createServer()` instance in one process, which `bun test`
 *  runs many of.
 *
 *  `readWorkflowHistory`/`readFreshness`/`readSpecCreatedAt`/
 *  `readSpecFileCommits`/`readRunner` are getters rather than values
 *  for a reason none of the OTHER fields have: this context is built
 *  once, at the top of `createServer`, so `refreshDrift`'s wrapper can
 *  be called immediately (the same instant the original inline
 *  function was) — before the checkers they read and the `runner`
 *  itself are constructed a little further down. A plain value field
 *  would capture `undefined` forever; a getter reads the `const` at
 *  CALL time, by which point every one of them is assigned. */
export interface ScheduleContext {
  projectRoot: string | undefined;
  machineryProjectDir: (project: string) => string;
  branchStatus: BranchStatusChecker;
  readWorkflowHistory: () => WorkflowHistoryChecker;
  readFreshness: () => DescriptionFreshnessChecker;
  readSpecCreatedAt: () => SpecCreatedAtChecker;
  readSpecFileCommits: () => SpecFileCommitChecker;
  targets: () => QueueTarget[];
  readScan: () => { archived: string[]; dirs: Map<string, string> } | null;
  allowed: Set<string>;
  ensureCheckout: (project: string) => Promise<DashboardCheckout | undefined>;
  getWarming: () => boolean;
  setWarming: (v: boolean) => void;
  queue: QueueStore;
  specRoots: (project: string) => string[];
  readRunner: () => Runner | null;
  checkoutEnsurer: CheckoutEnsurer;
  /** Told once per tick, and only when a watched root's `openSpecBranches`
   *  answer actually moved (spec 275) — the same "invalidate before you
   *  notify" shape `scheduleNotify` (`sse-watchers.ts`) already carries
   *  for a `git pull` landing new files. Without it, a background tick
   *  that quietly CORRECTS a stale "not landed" mark left an already-open
   *  tab showing the wrong answer until an unrelated queue event or a
   *  reload asked again — the branch was gone, `peekUnlanded()` would
   *  have answered right on the very next request, but nothing told the
   *  page already open to make one. */
  notifyQueueChanged: () => void;
}

export async function refreshDrift(ctx: ScheduleContext): Promise<void> {
  if (!ctx.projectRoot) return;
  await Promise.all(
    buildProjectViews(ctx.projectRoot).map(async (p) => {
      const root = ctx.machineryProjectDir(p.name);
      if (!configValue(root, "AIDE_INSTALL_CMD")) return;
      // Each call try/catches internally and degrades to null, so one
      // project's unreachable origin never takes the others with it.
      await ctx.branchStatus.commitsBehindOrigin(root);
    }),
  );
}

/** Everything git can say about ONE spec, asked and cached. Written
 *  once because two callers need it: the schedule below walks every
 *  live spec through it, and `landBranch` (`land-branch/merge.ts`)
 *  warms the spec it just landed unconditionally, on every landing
 *  (spec 208 — that path is a landing, not a render, and it needs a
 *  real answer rather than "not yet known"). */
export async function warmSpec(
  ctx: ScheduleContext,
  t: { dir?: string; specFolder: string; reopenedAfter?: string },
): Promise<void> {
  if (!t.dir) return;
  const dir = t.dir;
  await Promise.all([
    ctx.readWorkflowHistory().read(dir, t.specFolder, t.reopenedAfter),
    ctx.readFreshness().isStale(dir, t.specFolder, t.reopenedAfter),
    ctx.readSpecCreatedAt().createdAt(dir, t.specFolder),
    ...SPEC_FILES.map((file) => ctx.readSpecFileCommits().commitFor(dir, file)),
  ]);
}

/** Spec 208: the ONE schedule that feeds every peek on every page.
 *
 *  This is `refreshDrift`'s shape (spec 203) applied to the rest of
 *  the app. The same fix had been made three times, one page each —
 *  178 wrote it for the whole app and was never merged, 203 shipped
 *  it for `/projects`, and 193 put a network `ls-remote` back on the
 *  spec list's render path the next day. What each of those loops
 *  did inside a request, this does on a schedule; nothing about the
 *  questions changed, only when they are asked.
 *
 *  Two sweeps, and the difference between them is deliberate:
 *
 *  - Every LIVE spec, in full. That set is bounded by what is on the
 *    board, and it is the set every row of `/` draws from.
 *  - Every root that holds an archived spec, for the one network
 *    question (`openSpecBranches`), plus the archive DATE of an
 *    archived spec whose `4-status.md` carries no stamp — a small and
 *    shrinking set, since the archive step has written the stamp
 *    since spec 147. Warming an archived spec the way a live one is
 *    warmed is the unbounded cost spec 178's own plan review
 *    rejected, and is not done.
 *
 *  The roots go out CONCURRENTLY, unlike the `for`-loop this
 *  replaces: that loop paid one TCP/TLS round trip to GitHub per
 *  root, one after another, inside `GET /`. Nothing is holding its
 *  breath for the answer any more, so there is no reason to.
 *
 *  A spec that leaves `targets()` — archived, or removed — simply
 *  stops being walked; its last cached answer is left where it is
 *  and nothing asks about it again. */
export async function refreshSpecCaches(ctx: ScheduleContext): Promise<void> {
  // The tick does strictly more work than `refreshDrift`, so the
  // single-flight guard is explicit rather than implied: two ticks
  // running at once would double the in-flight subprocess and network
  // count on a machine that also runs the jobs.
  if (ctx.getWarming()) return;
  ctx.setWarming(true);
  try {
    const live = ctx.targets();
    const scan = ctx.readScan();
    const archivedKeys = scan?.archived ?? [];
    const roots = new Set<string>();
    const archivedDirs: string[] = [];
    for (const key of archivedKeys) {
      const cut = key.indexOf("/");
      for (const root of ctx.specRoots(key.slice(0, cut))) roots.add(root);
      const dir = scan?.dirs.get(key);
      // Only the ones git would be asked about anyway: a spec whose
      // status file already stamps the date never reaches git at all.
      if (dir && !specArchivedDate(dir)) archivedDirs.push(dir);
    }
    // Before the sweep, so a change made DURING it is compared against
    // what a reader's last page load actually saw — the same reason
    // `scheduleNotify` (`sse-watchers.ts`) invalidates before it
    // notifies.
    const before = new Map([...roots].map((root) => [root, ctx.branchStatus.peekOpenSpecBranches(root).open]));
    await Promise.all([
      // Each call try/catches internally and degrades to null or to
      // nothing-known, so one unreachable origin never takes the
      // others with it.
      ...[...roots].map((root) => ctx.branchStatus.openSpecBranches(root)),
      ...archivedDirs.map((dir) => ctx.readSpecFileCommits().commitFor(dir, ".")),
      ...live.map((t) => warmSpec(ctx, t)),
      // And the checkout the LIST is read from (spec 218). Every other
      // caller of `ensureCheckout` is a project that has something
      // going on — a job queued (spec 216's `tickRunner`), a spec page
      // open, a Save. A project with none of that had its checkout
      // fetched once at boot and never again, so a spec pushed from
      // another machine would have sat unlisted for as long as the
      // server ran rather than until the next poll.
      //
      // Here rather than in the routes, for the same reason as
      // everything else in this function: a render reads what the
      // schedule last found, and never waits on git itself.
      // `ensureCheckout` deduplicates per project and fails open, so a
      // project whose origin is unreachable costs one complaint, once.
      ...[...ctx.allowed].map((project) => ctx.ensureCheckout(project)),
    ]);
    // Spec 275: only a root whose answer MOVED tells anyone, and only
    // once per tick, however many roots moved — a tick that finds
    // nothing new stays silent, exactly as spec 189 already promises
    // for every other reason a page might redraw.
    const moved = [...roots].some(
      (root) => !sameOpenSet(before.get(root) ?? null, ctx.branchStatus.peekOpenSpecBranches(root).open),
    );
    if (moved) ctx.notifyQueueChanged();
  } finally {
    ctx.setWarming(false);
  }
}

function sameOpenSet(a: Set<string> | null, b: Set<string> | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

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
export async function refreshSchedules(ctx: ScheduleContext): Promise<void> {
  if (!ctx.projectRoot) return;
  const now = new Date();
  for (const project of ctx.allowed) {
    const entries = resolveSchedule(ctx.machineryProjectDir(project));
    for (const entry of entries) {
      const key = scheduleTrackingKey(entry.name);
      const jobs: ScheduleJobRef[] = ctx.queue
        .list()
        .filter((j) => j.project === project && j.specFolder === key)
        .map((j) => ({ specFolder: j.specFolder, createdAt: j.createdAt, startedAt: j.startedAt }));
      if (!isDue(entry, now, jobs)) continue;
      // The entry's own model, when it names one: a whole-job pick, which
      // is what `parseJobRequest` copies onto every step of the job — and
      // a scheduled job has exactly one. An entry that names none is
      // enqueued byte for byte as before, and the config's own `schedule`
      // default decides.
      ctx.queue.enqueue({
        project, specFolder: key, steps: ["schedule"],
        ...(entry.model ? { model: entry.model } : {}),
      });
    }
  }
}

/** Which queued jobs are waiting on a dependency that has not merged
 *  yet (spec 122) — job id → the folder it is waiting for.
 *
 *  The same question `aide-run-spec`'s guard asks, asked HERE so the
 *  answer arrives before a job is spawned rather than after: a job
 *  that reached the script was refused, marked `failed`, and had to be
 *  pressed again by hand (97 three times, 102 twice, against
 *  dependencies that merged minutes later).
 *
 *  Computed fresh immediately before every `tick()`, never cached
 *  across calls: a job enqueued a line of code ago must be judged
 *  against data that existed after it did. And since spec 213 the
 *  merge answer under it is asked fresh too (`isMerged(..., true)`),
 *  which is what makes that sentence true: a 30 s cached answer
 *  released two jobs against a dependency that had not landed, and
 *  the script — which asks origin every time — refused them. Only
 *  `targets()` is still cached here, for 5 s, and it decides nothing
 *  on its own: a spec that names no dependency is the cheap half. */
export async function blockedDependencies(ctx: ScheduleContext): Promise<Map<string, string>> {
  const blocked = new Map<string, string>();
  if (!ctx.projectRoot) return blocked;
  const waiting = ctx.queue.list().filter((job) => {
    if (job.state !== "queued") return false;
    const step = job.steps[job.stepIndex];
    return step !== undefined && GATED.has(step);
  });
  if (waiting.length === 0) return blocked;
  // The cheap half first, off the scan the page already keeps: a spec
  // that names nothing costs neither a walk of the specs root nor a
  // git call, the same way a spec without the field asks origin
  // nothing in the script.
  const named = new Map(ctx.targets().map((t) => [`${t.project}/${t.specFolder}`, t.dependsOn ?? []]));
  if (!waiting.some((j) => (named.get(`${j.project}/${j.specFolder}`) ?? []).length > 0)) return blocked;

  // Not `targets()`: that drops archived specs, and an archived
  // dependency is precisely the case that must resolve — to
  // "satisfied", without asking origin anything.
  const projects = new Map(discoverProjects(ctx.projectRoot).map((p) => [p.name, p]));
  for (const job of waiting) {
    const project = projects.get(job.project);
    const spec = project?.specs.find((s) => s.folder === job.specFolder && !s.archived);
    if (!project || !spec) continue;
    for (const id of spec.dependsOn) {
      const dep = resolveDependencyFolder(project, id);
      // An unknown identifier, or the spec itself: both are refusals
      // the script makes on its own, and neither is something waiting
      // could ever fix. Parking on one would hide a typo forever.
      if (!dep || dep.folder === spec.folder) continue;
      // Archiving only ever happens to finished work, so an archived
      // dependency is merged by definition — the script's own
      // shortcut, and it costs no network.
      if (dep.archived) continue;
      const branch = specBranch(dep.folder);
      // Every root a run of this spec touches, as the script asks
      // across `roots`: a dependency merged in the code repo but not
      // in the specs repo is not merged. Both are asked either way —
      // `&&` short-circuiting would leave the second answer uncached
      // and the next tick asking again.
      let merged = true;
      for (const root of ctx.specRoots(job.project)) {
        merged = (await ctx.branchStatus.isMerged(root, branch, true)) && merged;
      }
      if (!merged) {
        blocked.set(job.id, dep.folder);
        break;
      }
    }
  }
  return blocked;
}

/** Every `tick()` goes through here: the map has to be computed with
 *  the queue as it is at that instant, so there is no version of this
 *  that a caller may skip. */
export async function tickRunner(ctx: ScheduleContext): Promise<void> {
  const runner = ctx.readRunner();
  if (!runner) return;
  // Spec 205: nothing may be STARTED in a checkout that is not there.
  // Every project with a job waiting, and only those — a clone is
  // made once and the call is a map lookup ever after, so this costs
  // one `existsSync` per waiting project per tick.
  //
  // Spec 216: `fresh`, not `get`. This is the one caller that may not
  // be handed a bring-up-to-date that was already running when it
  // asked — such a fetch took its picture of origin before this job
  // was queued, and a spec pushed in between is one the step will
  // refuse as unknown. `CheckoutEnsurer` explains what that costs.
  await Promise.all([...new Set(ctx.queue.list().filter((j) => j.state === "queued").map((j) => j.project))]
    .map((project) => ctx.checkoutEnsurer.fresh(project)));
  runner.tick(await blockedDependencies(ctx));
}
