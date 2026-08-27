// The view builders behind the Specs list's archived rows and a
// spec's own page (spec: split serve.ts, step 3) — pulled out of
// `createServer`'s closure the same way `handleQueue` was in step 2:
// an explicit context object stands in for the locals these functions
// used to read directly.

import {
  SPEC_FILES, specArchivedDate, specDurationMs, specFileText, specPhaseFile, stripDependsOnLine,
  type SpecRef,
} from "../project/discover.ts";
import { parseStatus, parseStatusChecks } from "../project/parse-status.ts";
import { specPhaseOutcome, type PhaseOutcome } from "../project/parse-phase-outcome.ts";
import {
  filterShowsArchived, PHASE_LINES, phasesFor, specPagePath, EDITABLE_SPEC_FILE, STATUS_SPEC_FILE,
  type ArchivedSpecView, type JobDetailView, type SpecFileView, type SpecPageView, type QueueRowView,
  type QueueTarget,
} from "../render.ts";
import { QueueStore, currentWorkRoundJobs, type Job } from "../queue/queue.ts";
import { SpecFileCommitChecker, lastCommitOf } from "../git/description-freshness.ts";
import type { GitRunner } from "../git/branch-status.ts";
import { resolveStepModel, tailFile } from "./serve-helpers.ts";
import { summarizeStream } from "../queue/parse-stream.ts";

/** Everything these view builders read off `createServer`'s closure,
 *  bundled the same way `HandleQueueContext` bundles `handleQueue`'s.
 *  `readScan` and `readPrOpen` are getters rather than values for the
 *  same reason `HandleQueueContext.readScan` is: both are `let`s that
 *  `createServer`'s own scan/landing-check machinery reassigns after
 *  this context is built, and a snapshot taken at build time would
 *  never see a later refresh. */
export interface SpecViewsContext {
  projectRoot: string | undefined;
  targets: () => QueueTarget[];
  peekUnlanded: () => string[];
  peekUnlandedCheckedAt: () => number | null;
  readPrOpen: () => string[];
  readScan: () => { archived: string[]; refs: Map<string, SpecRef> } | null;
  queue: QueueStore;
  specDir: (project: string, specFolder: string) => string | undefined;
  specRef: (project: string, specFolder: string) => SpecRef | undefined;
  peekMachinerySpecDir: (project: string, dir: string) => string;
  machinerySpecDir: (project: string, dir: string) => Promise<string>;
  dependencyFolders: (project: string, dir: string) => string[];
  gitRun: GitRunner;
  withFreshness: (list: QueueTarget[]) => QueueTarget[];
  jobRow: (job: Job) => Promise<QueueRowView>;
  queueToken: string | undefined;
  specFileCommits: SpecFileCommitChecker;
}

export function specFileViews(ctx: SpecViewsContext, dir: string): SpecFileView[] {
  return SPEC_FILES.map((name) => {
    const { sha, at, checkedAt } = ctx.specFileCommits.peekCommitFor(dir, name);
    // The one cache in this spec a sweep over the live list cannot
    // fill: an ARCHIVED spec's page is a real render path too, and
    // archived specs are not `targets()`'s business. So the fill is
    // started from the request and never waited on — bounded by how
    // many archived specs anyone actually opens, rather than by how
    // many exist, which is the unbounded cost spec 178's own plan
    // review rejected. The next view of this page has the stamp.
    if (checkedAt === null) void ctx.specFileCommits.commitFor(dir, name);
    return {
      label: name,
      text: specFileText(dir, name),
      sha: sha ?? undefined,
      at: at ?? undefined,
      // Nothing has ever asked. Not "git cannot date this file" —
      // that is a real, timestamped answer and shows no stamp at all,
      // exactly as it did before this cache existed.
      checking: checkedAt === null,
    };
  });
}

/** WHEN a spec was archived. The stamp the archive step writes into
 *  `4-status.md` first; failing that, the commit that last touched the
 *  folder — an archived spec is not edited afterwards, so the newest
 *  commit under `archive/<folder>` IS the one that moved it there.
 *
 *  `dir` is the spec's OWN folder and the pathspec is `"."`, the same
 *  dir/pathspec pairing every other `lastCommitOf` call here uses: git
 *  is run IN the directory being asked about, and a pathspec naming a
 *  path outside it would answer nothing at all.
 *
 *  `null` from both is a real answer and the page prints it in words.
 *  Only a spec with no stamp reaches git, which since spec 147 is a
 *  shrinking minority. */
export function archivedAt(ctx: SpecViewsContext, dir: string): { date: string | null; checking: boolean } {
  const stamped = specArchivedDate(dir);
  if (stamped) return { date: stamped, checking: false };
  // A peek since spec 208, and the same "read, never take" rule as
  // everywhere else: `refreshSpecCaches` warms exactly this question,
  // for exactly the archived specs that have no stamp on disk.
  const { at, checkedAt } = ctx.specFileCommits.peekCommitFor(dir, ".");
  // Nothing is started from here, unlike `specFileViews`: this exact
  // question is on the warmer's own sweep, for exactly the archived
  // specs that have no stamp, so `/archive` spawns nothing at all.
  if (checkedAt === null) return { date: null, checking: true };
  // The DATE, not the instant: every stamp on disk is a date, and one
  // column reading two ways is worse than either.
  return { date: at ? at.slice(0, 10) : null, checking: false };
}

/** Which steps an archived spec's own `4-status.md` CLAIMS it has had
 *  (spec 224) — what its phase lines and its pip strip are drawn from
 *  once its row is opened.
 *
 *  The file's own word, and deliberately: a LIVE row's done-set is
 *  git-verified, through the `workflowHistory` cache `withFreshness`
 *  peeks — and `refreshSpecCaches` never warms that cache for an
 *  archived spec, because doing so is the unbounded cost spec 178's
 *  plan review turned down. Reusing the live path here would read
 *  `{history: null}` for every archived row and draw "checking…" for
 *  ever, which is not a truer answer than this one, only a slower way
 *  of giving none.
 *
 *  A THIRD reader of the same file beside `archivedAt` and
 *  `specDurationMs`, on the same terms as both: its own question, and
 *  an empty list for every way the answer can be missing. */
export function archivedSteps(dir: string): string[] {
  const status = specFileText(dir, "4-status.md");
  return status ? parseStatus(status).workflowSteps : [];
}

/** What each of this archived spec's phases actually ran on, from its
 *  own `4-status.md` (spec 244) — the model reader beside
 *  `archivedSteps`' step reader, on the same terms: the file's own
 *  claim, and an empty map for a spec that predates the line or names
 *  nothing. */
export function archivedModels(dir: string): Record<string, string> {
  const status = specFileText(dir, "4-status.md");
  return status ? parseStatus(status).stepModels : {};
}

/** What each of this archived spec's phases recorded about its OWN
 *  run (spec 245's write side, spec 247's read side) — Model, Time
 *  spent and Cost, each in the phase's own file rather than
 *  `4-status.md` alone. Beside `archivedModels` above, on the same
 *  terms: the file's own claim, an empty entry for a step whose file
 *  names nothing. */
export function archivedPhaseOutcomes(dir: string): Record<string, PhaseOutcome> {
  const result: Record<string, PhaseOutcome> = {};
  for (const step of PHASE_LINES) {
    const outcome = specPhaseOutcome(dir, step);
    if (Object.keys(outcome).length > 0) result[step] = outcome;
  }
  return result;
}

/** Every archived spec the reader's own chip asks for, as a row for
 *  the Specs list (spec 221; this built the `/archive` page until that
 *  page retired).
 *
 *  Off the scan every other lookup on this route already shares:
 *  `refs` holds what each spec IS — title, description, folder,
 *  directory — for archived and live specs alike, and `archived` holds
 *  the keys of the archived ones with the allowlist already applied.
 *  It used to walk `discoverProjects` a second time for the same
 *  answer. One flat list, unordered: the ordering, the filtering and
 *  the search are the render layer's, so there is one copy of each
 *  rule and the route has none. `description` is whole, because the
 *  search reads all of it.
 *
 *  **The state is what decides how much of this gets built, and that
 *  is the whole point.** A row costs three small file reads
 *  (`archivedAt`, the duration stamp and the steps its `4-status.md`
 *  claims — spec 224, when the row grew phase lines), aide alone archives about
 *  150 specs, and this page rebuilds itself on every change event on
 *  every open tab. A view whose chip cannot show an archived row
 *  builds nothing for one — with ONE exception, and it is spec 193's:
 *  an archived spec whose own branch is still on origin has NOT
 *  finished, and taking its row off the reading view would hide the
 *  exact failure spec 193 exists to surface. 1-description.md asks for
 *  the default chip to be today's reading view unchanged in content,
 *  and that is what this keeps. The set is `peekUnlanded()`, it is
 *  normally empty, and it is bounded by how many specs are genuinely
 *  stranded rather than by how big the archive has grown.
 *
 *  Nothing here runs git: `archivedAt` and the not-landed mark are
 *  peeks against caches a background schedule keeps warm (spec 208),
 *  exactly as `/archive` relied on. */
export function archivedSpecRows(ctx: SpecViewsContext, state: string | undefined): ArchivedSpecView[] {
  if (!ctx.projectRoot) return [];
  // Fills `scan`, and — through `peekUnlanded` below — refills
  // `unlanded`, which `resolveProject` reads to decide whether an
  // archived spec may have `archive` asked for it a second time (spec
  // 193's way out, spec 202's other half). Both are peeks and an
  // intersection in memory, never a walk, so neither is what the gate
  // below is holding back.
  ctx.targets();
  const open = new Set(ctx.peekUnlanded());
  // Filled by the same call, and read after it (spec 220): the subset
  // of `open` that is open because the project reviews its code.
  const reviewing = new Set(ctx.readPrOpen());
  const openCheckedAt = ctx.peekUnlandedCheckedAt();
  const everyOne = filterShowsArchived(state);
  const rows: ArchivedSpecView[] = [];
  const scan = ctx.readScan();
  for (const key of scan?.archived ?? []) {
    // The two marks come from one fact and mean opposite things (spec
    // 220), so the deliberate one wins outright rather than both being
    // set and the renderer picking.
    const prWaiting = reviewing.has(key);
    const notLanded = open.has(key) && !prWaiting;
    // The gate, and it is BEFORE the two file reads under it — after
    // them it would be a filter, not a gate, and would cost the
    // default view exactly what it exists to save. A PR waiting on
    // review is not the failure this gate exists to surface, so it
    // does not bypass it the way `notLanded` does.
    if (!everyOne && !notLanded) continue;
    const ref = scan?.refs.get(key);
    if (!ref) continue;
    const project = key.slice(0, key.indexOf("/"));
    const when = archivedAt(ctx, ref.dir);
    rows.push({
      project,
      folder: ref.folder,
      title: ref.title ?? undefined,
      description: ref.description ?? undefined,
      archivedAt: when.date,
      dateChecking: when.checking,
      notLanded,
      notLandedCheckedAt: notLanded ? (openCheckedAt ?? undefined) : undefined,
      prOpen: prWaiting,
      // Off the newest job that reported one. The queue keeps two
      // hundred jobs and the archive grows past that, so an old row
      // simply has no link — the mark still says the branch is open,
      // which is the part that matters.
      prUrl: prWaiting ? ctx.queue.pullRequestFor(project, ref.folder).prUrl : undefined,
      // The stored figure and nothing else (spec 207): the queue's own
      // records are gone for all but the newest rows here, and a
      // column that answered for some of them out of memory would be a
      // column whose blanks move about.
      durationMs: specDurationMs(ref.dir) ?? undefined,
      // The row opens now (spec 224), and this is what it opens on.
      done: archivedSteps(ref.dir),
      models: archivedModels(ref.dir),
      phaseOutcomes: archivedPhaseOutcomes(ref.dir),
    });
  }
  return rows;
}

/** Spec 212: the page's own tab decides how much this has to ask git.
 *  The Description tab's form carries `1-description.md`'s commit as
 *  its guard, and that is a `git log` this page never made before —
 *  so it is made for that tab and no other. The checks' own guard is
 *  bounded the same way, by there being an open check to draw at all;
 *  the Depends-on resolution short-circuits with no git at all for a
 *  spec whose description carries no `Depends on:` line.
 *
 *  The Description tab is also the one that AWAITS the dashboard's own
 *  checkout rather than peeking (spec 205): the text in the box and
 *  the commit Save compares it against have to come out of the same
 *  checkout Save will write through, or the first edit after a restart
 *  refuses as "changed since you opened it". Every other tab keeps the
 *  peek, because a spec page must not wait on the boot-time clone
 *  (spec 208, criterion 9) — including Overview, whose checks form
 *  therefore carries a `4-status.md` sha read through whichever
 *  checkout answered. In the minutes before the clone lands that can
 *  be the person's own, and a tick drawn from it is REFUSED rather
 *  than misapplied: the guard fails safe, and a reload fixes it. */
export async function specPageView(
  ctx: SpecViewsContext,
  project: string,
  specFolder: string,
  tab?: string,
): Promise<SpecPageView | null> {
  const found = ctx.specDir(project, specFolder);
  if (!found) return null;
  // The four files as the dashboard's own checkout has them (spec
  // 205) — which is where Save writes, so it is where a save has to be
  // visible. The person's checkout catches up when the specs cron
  // pulls it, and the Update button is what closes that gap on
  // demand.
  const dir = ctx.peekMachinerySpecDir(project, found);
  const ref = ctx.specRef(project, specFolder);
  // Whatever is in flight, or failing that the most recently active —
  // the rule `jobGroup` uses for the row's own lead, over the same
  // in-flight states (queued and running — there is no stop between
  // steps since spec 149) and the same "started, or failing that
  // created" clock, so the page a name opens speaks for the job the
  // name spoke for.
  const matchingJobs = ctx.queue
    .list()
    .filter((j) => j.project === project && j.specFolder === specFolder);
  const jobs = currentWorkRoundJobs(matchingJobs)
    .sort((a, b) => (Date.parse(b.startedAt ?? b.createdAt) || 0) - (Date.parse(a.startedAt ?? a.createdAt) || 0));
  const inFlight = (j: Job): boolean => j.state === "queued" || j.state === "running" || !!j.landing;
  const leadJob = jobs.find(inFlight) ?? jobs[0];
  const files = specFileViews(ctx, dir);
  // Off the text `specFileViews` has already read, so the page makes
  // no second git or disk read for the same file.
  const status = files.find((f) => f.label === STATUS_SPEC_FILE);
  const statusText = status?.text ?? "";
  const rows = parseStatusChecks(statusText);
  // Which phase's open rows may be TICKED (spec 188, back on Overview
  // since spec 212): the CURRENT phase, which is the first phase
  // section still carrying an open mark — the same phase the spec
  // list's own column shows. `null` for a `4-status.md` with no phase
  // sections at all (a spec never analysed — a LOW-complexity spec's
  // `## Checklist` heading counts as a phase section since spec 266)
  // and `"done"` when every section is clear; both leave nothing
  // tickable, and the page then draws the rows with no form.
  const parsedStatus = parseStatus(statusText);
  const statusPhase = parsedStatus.phase;
  const anyTickable = rows.some((row) => !row.done && row.phase === statusPhase);
  // Read out of the DASHBOARD's own checkout, like the text beside it
  // (spec 205): the commit stamp a form compares against and the text
  // in the box have to be the same instant, or every save would refuse
  // as "changed since you opened it".
  const statusCommit = anyTickable ? await lastCommitOf(ctx.gitRun, dir, STATUS_SPEC_FILE) : null;
  const formDir = tab === "description" ? await ctx.machinerySpecDir(project, found) : null;
  const descriptionCommit = formDir ? await lastCommitOf(ctx.gitRun, formDir, EDITABLE_SPEC_FILE) : null;
  const descriptionText = formDir ? specFileText(formDir, EDITABLE_SPEC_FILE) : null;
  // Spec 239: the same join the front page's row composes
  // (`phasesFor`), over this spec's own jobs and target — never a
  // second count. The per-job git work `jobRow` does is not new load:
  // the front page already pays it over every job of every spec, and
  // this is one spec's own attempts (typically 1-3).
  // `withFreshness` (never a live git spawn — spec 208 — it only peeks
  // the `workflowHistory` cache the schedule already warmed) is what
  // fills a live spec's `done` in from its own commits; the raw
  // `targets()` entry never carries it. Every other caller of
  // `targets()` on this route already goes through it (the front
  // page's row, the job page); this one had not.
  const target = ctx.withFreshness(
    ctx.targets().filter((t) => t.project === project && t.specFolder === specFolder),
  )[0];
  const jobRows = await Promise.all(jobs.map(ctx.jobRow));
  const jobDetails = await Promise.all(jobs.map((job) => jobDetailView(ctx, job)));
  // jobs is newest-first; oldest = attempt 1. Only tagged when there is
  // more than one job — a single-attempt spec draws no marker at all
  // (spec 242's own "nothing to show, show nothing" rule, at row level).
  const multiAttempt = jobs.length > 1;
  const attemptNumber = (j: Job): number | undefined =>
    multiAttempt ? jobs.length - jobs.indexOf(j) : undefined;
  const leadDetail = leadJob ? jobDetails[jobs.indexOf(leadJob)] : undefined;
  const lead = leadDetail && {
    ...leadDetail,
    runningStep: leadDetail.runningStep && { ...leadDetail.runningStep, attempt: attemptNumber(leadJob!) },
  };
  // Spec 242: every step from every job in this work round, oldest job
  // first — `jobs` is newest-first, so this flattens it in reverse.
  const steps = jobs
    .map((j, i) => jobDetails[i]!.results.map((r) => ({ ...r, attempt: attemptNumber(j) })))
    .reverse()
    .flat();
  return {
    project,
    specFolder,
    title: ref?.title ?? undefined,
    archived: ref?.archived ?? false,
    // Spec 166: the dependency line is lifted OUT of the textarea and
    // into a field of its own. Left in both, a save could not tell
    // which of the two the person meant. The Description tab strips
    // it; Overview shows what it resolves to, read-only.
    files: files.map((f) => {
      if (f.label !== EDITABLE_SPEC_FILE) return f;
      const text = formDir ? descriptionText : f.text;
      return text === null ? { ...f, text } : { ...f, text: stripDependsOnLine(text) };
    }),
    checks: { rows, phase: statusPhase ?? undefined, baseSha: statusCommit?.sha },
    // Ticked by what the LINE resolves to, not by what it says:
    // `resolve_dependency_folder` takes a bare number, and a
    // hand-written line usually is one — matching the raw string
    // against a folder would leave a real dependency unticked, and
    // the next Save would then silently drop it.
    dependsOn: ctx.dependencyFolders(project, dir),
    // Spec 174: the New-spec page's picker, fed this project's own
    // active specs. Self excluded — the one box that could only ever
    // earn spec 166's "cannot depend on itself" refusal.
    dependsOnOptions: ctx.targets().filter((t) => t.project === project && t.specFolder !== specFolder),
    phases: phasesFor(jobRows, target),
    // `targets()` deliberately drops an archived spec (serve.ts:792-796),
    // so `target` — and `target?.done` — is always empty for one. The
    // file's own claim is the only answer left, the same one
    // `archivedSteps()` reads for the front page's archived rows (spec
    // 224) — read here from the `statusText` already in hand rather than
    // through that helper, which re-reads the file from disk.
    done: ref?.archived ? parsedStatus.workflowSteps : (target?.done ?? []),
    descriptionBaseSha: descriptionCommit?.sha,
    lead,
    steps,
    // Built from the page's own path, so the two cannot drift into a
    // button that posts where nothing listens.
    updateAction: `/api/queue${specPagePath(project, specFolder)}/update`,
    resetAction: `${specPagePath(project, specFolder)}/reset`,
    resetUnavailableReason: matchingJobs.some((job) => job.state === "queued" || job.state === "running")
      ? "another job for this spec is still running"
      : ctx.queue.list().some((job) => job.landing)
        ? "a landing is in progress"
        : undefined,
    saveAction: `/api/queue${specPagePath(project, specFolder)}/save`,
    tickAction: `/api/queue${specPagePath(project, specFolder)}/tick`,
    // The Reopen control on an archived spec posts to `/api/queue`,
    // which checks the token like every other enqueue (spec 198).
    token: ctx.queueToken,
  };
}

export async function jobDetailView(ctx: SpecViewsContext, job: Job): Promise<JobDetailView> {
  const target = ctx.targets().find((t) => t.project === job.project && t.specFolder === job.specFolder);
  // Which CLI this page is about (spec 125). A running step's tool is
  // not recorded anywhere yet — the result file that would carry it is
  // written when the step ENDS — so it is resolved the same way the
  // argv resolved it: from the config entry the chosen model name
  // points at. A finished job answers from its own last result.
  const step = job.steps[job.stepIndex];
  const running = job.state === "running";
  const named = running
    ? ctx.queue.defaults.modelChoices?.[resolveStepModel(job, step ?? "", ctx.queue.defaults.model) ?? ""]?.tool
    : job.results[job.results.length - 1]?.tool;
  const tool = named ?? "claude";
  // What this job's step WROTE (spec 150). The step running now, or
  // failing that the last one that ran — read off disk, uncached and
  // ungitted: this page says what the phase produced, and which
  // VERSION of it is the spec page's question.
  const shownStep = step ?? job.steps[job.steps.length - 1];
  const dir = ctx.specDir(job.project, job.specFolder);
  const phase = dir && shownStep ? specPhaseFile(dir, shownStep) : null;
  return {
    ...(await ctx.jobRow(job)),
    tool,
    title: target?.title,
    finishedAt: job.finishedAt,
    // Each finished step's OWN transcript (spec 240), read from its
    // own `streamFile` rather than the job's last one — a three-step
    // attempt used to make only its last step's log reachable at all.
    results: job.results.map((r) => ({
      ...r,
      tokens: r.tokens?.total,
      logs: r.streamFile ? summarizeStream(tailFile(r.streamFile), { tool: r.tool ?? named }) : undefined,
    })),
    phase: phase ?? undefined,
    // The step running RIGHT NOW, when one is: it has no `StepResult`
    // yet, so it cannot ride along in `results` above, and its
    // transcript is the job's own live pointer.
    runningStep:
      running && step
        ? {
            step,
            sessionId: job.sessionId,
            logs: job.streamFile ? summarizeStream(tailFile(job.streamFile), { tool: named }) : [],
          }
        : undefined,
    archiveHeldBack: target?.archiveHeldBack?.reason,
  };
}
