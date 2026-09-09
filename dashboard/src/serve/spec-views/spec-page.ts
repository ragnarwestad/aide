// the spec page's own view: its files, its phases, and everything one spec's page needs.
//
// Split out of spec-views.ts 2026-09-04, where it had grown to 562
// lines; every function is unchanged and keeps its name.
import {
  specAcceptanceNotRequired, specCloseReason, specClosedDate, specFileText, stripDependsOnLine,
} from "../../project/discover.ts";
import { acceptanceSectionUnreadable, parseStatus } from "../../project/parse-status.ts";
import { phasesFor, specPagePath, resolveSpecTab, EDITABLE_SPEC_FILE, STATUS_SPEC_FILE, TAB_FILES, type SpecPageView } from "../../render.ts";
import type { BoardStatusView } from "../../render/pages/spec-page/types.ts";
import { currentWorkRoundJobs, type Job } from "../../queue/queue.ts";
import { lastCommitOf } from "../../git/description-freshness.ts";
import { readStatusFromBranch, resolveOpenBranchTarget } from "../../git/branch-file.ts";
import { refreshBoardStatus } from "../boards/lifecycle.ts";
import { type SpecViewsContext, specFileViews } from "../spec-views.ts";

import { jobDetailView } from "./job-detail.ts";

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
  // no second git or disk read for the same file. This is the Status
  // TAB's own text (out of REQ-1's scope, per 1-description.md) — the
  // Checks section below may draw from a DIFFERENT source.
  const status = files.find((f) => f.label === STATUS_SPEC_FILE);
  const diskStatusText = status?.text ?? "";
  // REQ-1/REQ-2: an active spec with its own OPEN `aide/<folder>`
  // branch has its real, already-committed progress sitting there —
  // `implement` never merges its own work, only `archive` does — so
  // the Checks section reads THAT content instead of `main`'s, which
  // is what makes archive's own human-approval gate reachable at all
  // (see 1-description.md). An archived spec never has one; every
  // other spec falls back to the disk read exactly as before REQ-1.
  let checksText = diskStatusText;
  let branchBaseSha: string | undefined;
  if (!ref?.archived) {
    // The ordinary CACHED call (never `fresh`): the same tolerance for
    // a few seconds of staleness the Checks section already has for
    // git answers generally (spec 212's own reasoning, above).
    const target = await resolveOpenBranchTarget(ctx, dir, specFolder, STATUS_SPEC_FILE, false);
    // Wherever the folder is ON the branch — `archive` moves it to
    // `archive/<folder>` there, and a branch that has not landed yet
    // still answers for that path while the default branch holds the
    // folder in its active one.
    const branchRead = target
      ? ((await readStatusFromBranch(ctx.gitRun, target.root, target.branch, target.relPath)) ??
        (await readStatusFromBranch(ctx.gitRun, target.root, target.branch, target.archivedRelPath)))
      : null;
    if (branchRead) {
      checksText = branchRead.text;
      branchBaseSha = branchRead.sha;
    }
  }
  // Which phase's open rows may be TICKED (spec 188, back on Overview
  // since spec 212): the CURRENT phase, which is the first phase
  // section still carrying an open mark — the same phase the spec
  // list's own column shows. `null` for a `4-status.md` with no phase
  // sections at all (a spec never analysed — a LOW-complexity spec's
  // `## Checklist` heading counts as a phase section since spec 266)
  // and `"done"` when every section is clear; both leave nothing
  // tickable, and the page then draws the rows with no form. REQ-3:
  // this rule is untouched, and reads the same whether `checksText`
  // came off the branch or off disk.
  //
  // Spec 302: `rows`/`phase`/`acceptancePhase` all come off this ONE
  // `parseStatus` call — it already walks the file's phase sections to
  // compute `checks` internally, and this used to walk them a second
  // time with a separate row-parsing call for `rows` alone.
  const parsedStatus = parseStatus(checksText);
  // Spec 239/302: the same join the front page's row composes
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
  //
  // Built here, right after `parsedStatus` and before anything reads
  // `phase`/`acceptancePhase` (`anyTickable` included), so every later
  // read in this function goes through `target` uniformly — one
  // canonical place per request, per REQ-2.
  const target = {
    ...ctx.withFreshness(
      ctx.targets().filter((t) => t.project === project && t.specFolder === specFolder),
    )[0],
    phase: parsedStatus.phase ?? undefined,
    acceptancePhase: parsedStatus.acceptancePhase ?? undefined,
  };
  const rows = parsedStatus.checks;
  // The Acceptance section alone: the Phase tables are the implement
  // run's own record and the Checks tab no longer offers them (see
  // `checklist`'s own comment), so a spec whose only open rows are
  // Phase rows has nothing to save and needs no form or commit stamp.
  const anyTickable = rows.some((row) => !row.done && row.phase === target.acceptancePhase);
  // `branchBaseSha` is already the exact commit that last touched the
  // file ON THE BRANCH (`readStatusFromBranch`'s own answer) — no
  // second git call needed. Off disk, read out of the DASHBOARD's own
  // checkout, like the text beside it (spec 205): the commit stamp a
  // form compares against and the text in the box have to be the same
  // instant, or every save would refuse as "changed since you opened it".
  const statusCommit = !anyTickable
    ? null
    : branchBaseSha !== undefined
      ? { sha: branchBaseSha }
      : await lastCommitOf(ctx.gitRun, dir, STATUS_SPEC_FILE);
  // REQ-1/REQ-3: generalized from "Description awaits, every other tab
  // peeks" (spec 205's own rule, above) to "whichever document tab is
  // open awaits, and only for an ACTIVE spec" — an archived one has no
  // Save to guard (REQ-5), so it stays on the peeked, cached text every
  // tab already had. Exactly one file per request still pays this cost:
  // the tab actually being viewed.
  const formFile = TAB_FILES[resolveSpecTab(tab)];
  const fetchForm = Boolean(formFile) && !ref?.archived;
  let formBaseSha: string | undefined;
  let formText: string | null = null;
  if (fetchForm) {
    const formDir = await ctx.machinerySpecDir(project, found);
    // REQ-4: the same "ask the open branch first" question the Checks
    // section already asks (above) — but fresh (`true`), because a Save
    // has to compare against the version IT will write onto, never a
    // cached answer.
    const target = await resolveOpenBranchTarget(ctx, formDir, specFolder, formFile!, true);
    const branchRead = target ? await readStatusFromBranch(ctx.gitRun, target.root, target.branch, target.relPath) : null;
    if (branchRead) {
      formBaseSha = branchRead.sha;
      formText = branchRead.text;
    } else {
      formBaseSha = (await lastCommitOf(ctx.gitRun, formDir, formFile!))?.sha;
      formText = specFileText(formDir, formFile!);
    }
  }
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
  // Spec 388, REQ-1: "a branch that carries code" is read off the same
  // source `landArchivedSpec` already reads (`branchesFor`) — a spec
  // with no implement step yet, or one already archived, has nothing
  // there. `roundAvailable` is a capability check on the checkout the
  // round would actually run FROM, never a hardcoded project name.
  const boardCapable =
    !ref?.archived &&
    ctx.boards.roundAvailable(project) &&
    ctx.queue.branchesFor(project, specFolder).some((r) => r.root === ctx.boards.aideCheckout(project));
  const boardEntry = boardCapable ? refreshBoardStatus(ctx.boards, project, specFolder) : undefined;
  const board: BoardStatusView | undefined = boardEntry && {
    status: boardEntry.status,
    branch: boardEntry.branch,
    commit: boardEntry.commit,
    url: boardEntry.url,
    error: boardEntry.error,
  };
  // The same busy reasons `resetUnavailableReason` already reads below —
  // a board is another lifecycle action against this spec's own branch,
  // and neither should run while a job for it is in flight or a landing
  // is under way.
  const busyReason = matchingJobs.some((job) => job.state === "queued" || job.state === "running")
    ? "another job for this spec is still running"
    : ctx.queue.list().some((job) => job.landing)
      ? "a merge is in progress"
      : undefined;
  return {
    project,
    specFolder,
    title: ref?.title ?? undefined,
    archived: ref?.archived ?? false,
    closed: ref?.closed ?? false,
    closedDate: ref?.closed ? (specClosedDate(dir) ?? undefined) : undefined,
    closeReason: ref?.closed ? (specCloseReason(dir) ?? undefined) : undefined,
    // Spec 166: the dependency line is lifted OUT of the textarea and
    // into a field of its own. Left in both, a save could not tell
    // which of the two the person meant. The Description tab strips
    // it; Overview shows what it resolves to, read-only.
    files: files.map((f) => {
      if (!fetchForm || f.label !== formFile) return f;
      if (f.label === EDITABLE_SPEC_FILE) {
        return formText === null ? { ...f, text: formText } : { ...f, text: stripDependsOnLine(formText) };
      }
      return { ...f, text: formText };
    }),
    checks: {
      rows,
      phase: target.phase,
      baseSha: statusCommit?.sha,
      unreadable: acceptanceSectionUnreadable(checksText),
    },
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
    // Spec 394: read off the same on-disk directory `dependsOn` above
    // comes from — a fresh read, since the banner is drawn once per page
    // load and this fact only changes via the banner's own Save.
    acceptanceNotRequired: specAcceptanceNotRequired(dir),
    phases: phasesFor(jobRows, target),
    // `targets()` deliberately drops an archived spec (serve.ts:792-796),
    // so `target` — and `target?.done` — is always empty for one. The
    // file's own claim is the only answer left, the same one
    // `archivedSteps()` reads for the front page's archived rows (spec
    // 224) — read here from the `statusText` already in hand rather than
    // through that helper, which re-reads the file from disk.
    done: ref?.archived ? parsedStatus.workflowSteps : (target?.done ?? []),
    formBaseSha,
    lead,
    steps,
    // Built from the page's own path, so the two cannot drift into a
    // button that posts where nothing listens.
    updateAction: `/api/queue${specPagePath(project, specFolder)}/update`,
    resetAction: `${specPagePath(project, specFolder)}/reset`,
    // spec 406: same "always present, disabled with a reason while
    // busy" shape as resetAction — closeControl (overview.ts) is what
    // hides it once the spec is archived.
    closeAction: `${specPagePath(project, specFolder)}/close`,
    pdfAction: `${specPagePath(project, specFolder)}/pdf`,
    pdfUnavailableReason: ctx.pdfToolAvailable ? undefined : "md-to-pdf is not installed on this host",
    resetUnavailableReason: busyReason,
    closeUnavailableReason: busyReason,
    boardAction: boardCapable ? `/api/queue${specPagePath(project, specFolder)}/board` : undefined,
    boardStopAction: boardCapable ? `/api/queue${specPagePath(project, specFolder)}/board/stop` : undefined,
    // The way IN to a running test server is this dashboard's own start
    // link, not the address the round printed: that one is loopback,
    // and a reader on another device reaches nothing at 127.0.0.1. The
    // link's own route already builds the address the reader can reach
    // — from the host THEY used — so the banner sends them through it.
    boardOpenHref: boardCapable ? `${specPagePath(project, specFolder)}?tab=steps&startBoard=1` : undefined,
    boardUnavailableReason: boardCapable ? busyReason : undefined,
    board,
    saveAction: `/api/queue${specPagePath(project, specFolder)}/save`,
    tickAction: `/api/queue${specPagePath(project, specFolder)}/tick`,
    trackingAction: `/api/queue${specPagePath(project, specFolder)}/tracking`,
    // The Reopen control on an archived spec posts to `/api/queue`,
    // which checks the token like every other enqueue (spec 198).
    token: ctx.queueToken,
  };
}
