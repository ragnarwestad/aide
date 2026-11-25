// the spec page's own view: its files, its phases, and everything one spec's page needs.
//
// Split out of spec-views.ts 2026-09-04, where it had grown to 562
// lines; every function is unchanged and keeps its name.
import { dirname, join } from "node:path";
import { parseAcCoverage, readAcCoverage, withAcCoverage } from "../../project/ac-coverage.ts";
import {
  acceptanceNotRequiredIn, createChoicesIn, specAcceptanceNotRequired, specCloseReason, specClosedDate, specFileText,
  stripDependsOnLine, type SpecRef,
} from "../../project/discover";
import { acceptanceSectionUnreadable, parseStatus } from "../../project/parse-status";
import {
  phasesFor, specPagePath, resolveSpecTab, EDITABLE_SPEC_FILE, STATUS_SPEC_FILE, TAB_FILES, type SpecFileView, type SpecPageView,
} from "../../render";
import type { TestServerStatusView } from "../../render/pages/spec-page/types.ts";
import { PDF_UNAVAILABLE } from "../../render/pages/spec-page/overview.ts";
import { jobActivity, landingInProject, type Job } from "../../queue/queue.ts";
import { groupReservesSpec } from "../../queue/execution-groups";
import { lastCommitOf } from "../../git/description-freshness.ts";
import { readStatusFromFetchedBranch, resolveOpenBranchTarget, type OpenBranchTarget } from "../../git/branch-file.ts";
import { refreshTestServerStatus } from "../test-servers/lifecycle.ts";
import { type SpecViewsContext, specFileViews } from "./";
import { type BranchCopy, readBranchCopy } from "./branch-copy.ts";

import { jobDetailView } from "./job-detail.ts";
import { stepsOfRound } from "./work-round.ts";
import { AC_COVERAGE_FILE } from "../../project/spec-names.ts";

/** The text the Checks section is drawn from, the commit it came from on
 *  the branch, and the branch's record of which test covers which criterion. */
interface ChecksSource {
  text: string;
  baseSha?: string;
  coverage: ReturnType<typeof parseAcCoverage>;
}

/** The open tab's own file, read for its form: which file, whether it was
 *  read at all, and the text and commit stamp the form carries. */
interface FormRead {
  file: string | undefined;
  fetch: boolean;
  baseSha?: string;
  text: string | null;
  copy: BranchCopy | null;
}

/** Whether a test server may be started, the registry's entry for one
 *  already there, and that entry as the banner draws it. */
interface TestServerFacts {
  capable: boolean;
  entry: ReturnType<typeof refreshTestServerStatus> | undefined;
  view: TestServerStatusView | undefined;
}

/** Why the page's lifecycle actions are not offered right now. */
interface BusyFacts {
  groupReserved: boolean;
  busyReason: string | undefined;
  closeUnavailableReason: string | undefined;
}

/** Which test covers which criterion: implement writes the record on the
 *  branch, beside the status file the rows come from. */
async function readBranchCoverage(ctx: SpecViewsContext, target: OpenBranchTarget): Promise<ChecksSource["coverage"]> {
  for (const relPath of [target.relPath, target.archivedRelPath]) {
    const coverage = await readStatusFromFetchedBranch(
      ctx.gitRun, target.root, target.branch, join(dirname(relPath), AC_COVERAGE_FILE),
    );
    if (coverage) return parseAcCoverage(coverage.text);
  }
  return null;
}

/** An active spec with its own OPEN `aide/<folder>`
 *  branch has its real, already-committed progress sitting there —
 *  `implement` never merges its own work, only `archive` does — so
 *  the Checks section reads THAT content instead of `main`'s, which
 *  is what makes archive's own human-approval gate reachable at all
 *  (see 1-description.md). An archived spec never has one; every
 *  other spec falls back to the disk read as before. */
async function readChecksSource(
  ctx: SpecViewsContext,
  dir: string,
  specFolder: string,
  archived: boolean | undefined,
  diskText: string,
): Promise<ChecksSource> {
  if (archived) return { text: diskText, coverage: null };
  // The ordinary CACHED call (never `fresh`): the same tolerance for
  // a few seconds of staleness the Checks section already has for
  // git answers generally (the reasoning above).
  const target = await resolveOpenBranchTarget(ctx, dir, specFolder, STATUS_SPEC_FILE, false);
  // Wherever the folder is ON the branch — `archive` moves it to
  // `archive/<folder>` there, and a branch that has not landed yet
  // still answers for that path while the default branch holds the
  // folder in its active one.
  const branchRead = target
    ? ((await readStatusFromFetchedBranch(ctx.gitRun, target.root, target.branch, target.relPath)) ??
      (await readStatusFromFetchedBranch(ctx.gitRun, target.root, target.branch, target.archivedRelPath)))
    : null;
  if (!branchRead) return { text: diskText, coverage: null };
  return { text: branchRead.text, baseSha: branchRead.sha, coverage: await readBranchCoverage(ctx, target!) };
}

/** Generalized from "Description awaits, every other tab
 *  peeks" (the rule above) to "whichever document tab is
 *  open awaits, and only for an ACTIVE spec" — an archived one has no
 *  Save to guard, so it stays on the peeked, cached text every
 *  tab already had. Exactly one file per request still pays this cost:
 *  the tab actually being viewed. */
async function readFormFile(
  ctx: SpecViewsContext,
  project: string,
  found: string,
  specFolder: string,
  tab: string | undefined,
  archived: boolean | undefined,
): Promise<FormRead> {
  const file = TAB_FILES[resolveSpecTab(tab)];
  const fetch = Boolean(file) && !archived;
  if (!fetch) return { file, fetch, text: null, copy: null };
  const formDir = await ctx.machinerySpecDir(project, found);
  // The same "ask the open branch first" question the Checks
  // section already asks (above), and as cached: the page is not kept
  // waiting on origin. A Save compares against the version IT will
  // write onto by asking afresh itself, and refuses when this was older.
  const copy = await readBranchCopy(ctx, formDir, specFolder, file!);
  if (copy) return { file, fetch, baseSha: copy.sha, text: copy.text, copy };
  return { file, fetch, baseSha: (await lastCommitOf(ctx.gitRun, formDir, file!))?.sha, text: specFileText(formDir, file!), copy: null };
}

/** The dependency line is lifted OUT of the textarea and
 *  into a field of its own. Left in both, a save could not tell
 *  which of the two the person meant. The Description tab strips
 *  it; Overview shows what it resolves to, read-only. */
function filesWithForm(files: SpecFileView[], form: FormRead): SpecFileView[] {
  return files.map((f) => {
    if (!form.fetch || f.label !== form.file) return f;
    // The stamp names the version the text is: the branch's commit when
    // the text came off the branch.
    const stamp = form.copy ? { sha: form.copy.sha, at: form.copy.at } : {};
    if (f.label === EDITABLE_SPEC_FILE) {
      return form.text === null ? { ...f, ...stamp, text: form.text } : { ...f, ...stamp, text: stripDependsOnLine(form.text) };
    }
    return { ...f, ...stamp, text: form.text };
  });
}

/** "a branch that carries code" is read off the same
 *  source `landArchivedSpec` already reads (`branchesFor`) — a spec
 *  with no implement step yet, or one already archived, has nothing
 *  there. `previewAvailable` is a capability check on the checkout the
 *  round would actually run FROM, never a hardcoded project name.
 *
 *  This answers "may a NEW board be started" only:
 *  it used to also gate whether an EXISTING board's own link and Stop
 *  button were shown, which hid them the moment a spec was archived
 *  even though its board kept running (the automatic stop only fires
 *  once an archive actually MERGES, and a held-back archive never
 *  does). "Does one already exist" is answered separately, right
 *  below, by asking the registry directly rather than folding that
 *  question into this one. */
function testServerFacts(ctx: SpecViewsContext, project: string, specFolder: string, archived: boolean | undefined): TestServerFacts {
  const capable =
    !archived &&
    ctx.testServers.previewAvailable(project) &&
    ctx.queue.branchesFor(project, specFolder).some((r) => r.root === ctx.testServers.aideCheckout(project));
  const entry = ctx.testServers.store.get(project, specFolder)
    ? refreshTestServerStatus(ctx.testServers, project, specFolder)
    : undefined;
  const view: TestServerStatusView | undefined = entry && {
    status: entry.status,
    branch: entry.branch,
    commit: entry.commit,
    url: entry.url,
    error: entry.error,
    detail: entry.detail,
  };
  return { capable, entry, view };
}

/** The test server's busy reason: another lifecycle action against this
 *  spec's own branch, not run while a job for it is in flight or a
 *  landing is under way anywhere in the project. */
function busyFacts(ctx: SpecViewsContext, project: string, specFolder: string, matchingJobs: Job[]): BusyFacts {
  const groupReserved = groupReservesSpec(ctx.queue, project, specFolder);
  const specBusy = groupReserved || matchingJobs.some((job) => ["queued", "running"].includes(jobActivity(job)));
  const busyReason = specBusy
    ? "another job for this spec is still running"
    : landingInProject(ctx.queue.list(), project)
      ? "a merge is in progress"
      : undefined;
  // Close waits only for this spec's own merge: another spec's merge in
  // the project leaves it offered, and its merge waits for the lock.
  const closeUnavailableReason = specBusy
    ? "another job for this spec is still running"
    : matchingJobs.some((job) => job.landing)
      ? "a merge is in progress"
      : undefined;
  return { groupReserved, busyReason, closeUnavailableReason };
}

/** What the spec IS: its title, and whether and why it was archived or closed. */
function specStateFacts(ref: SpecRef | undefined, dir: string) {
  return {
    title: ref?.title ?? undefined,
    archived: ref?.archived ?? false,
    closed: ref?.closed ?? false,
    closedDate: ref?.closed ? (specClosedDate(dir) ?? undefined) : undefined,
    closeReason: ref?.closed ? (specCloseReason(dir) ?? undefined) : undefined,
  };
}

/** The page's buttons: where each posts, and why one is not offered. */
function specPageActions(ctx: SpecViewsContext, project: string, specFolder: string, server: TestServerFacts, busy: BusyFacts) {
  return {
    // Built from the page's own path, so the two cannot drift into a
    // button that posts where nothing listens.
    pdfUnavailableReason: ctx.pdfToolAvailable ? undefined : PDF_UNAVAILABLE,
    // Always available, disabled with a reason while busy —
    // closeControl (overview.ts) is what hides it once the spec is
    // archived. No fallback page behind it, so this is a flag.
    closeAvailable: true,
    closeUnavailableReason: busy.closeUnavailableReason,
    testServerAction: server.capable ? `/api/queue${specPagePath(project, specFolder)}/test-server` : undefined,
    testServerStopAction: server.entry ? `/api/queue${specPagePath(project, specFolder)}/test-server/stop` : undefined,
    // The way IN to a running test server is this dashboard's own start
    // link, not the address the round printed: that one is loopback,
    // and a reader on another device reaches nothing at 127.0.0.1. The
    // link's own route already builds the address the reader can reach
    // — from the host THEY used — so the banner sends them through it.
    testServerOpenHref: server.entry ? `${specPagePath(project, specFolder)}?tab=steps&startTestServer=1` : undefined,
    testServerUnavailableReason: server.capable ? busy.busyReason : undefined,
    testServer: server.view,
    saveAction: `/api/queue${specPagePath(project, specFolder)}/save`,
    tickAction: `/api/queue${specPagePath(project, specFolder)}/tick`,
    trackingAction: `/api/queue${specPagePath(project, specFolder)}/tracking`,
  };
}

/** The Checks section's rows and the commit stamp its form carries. */
async function specChecks(
  ctx: SpecViewsContext,
  project: string,
  dir: string,
  checks: ChecksSource & { rows: ReturnType<typeof parseStatus>["checks"] },
  target: { acceptancePhase?: string; phase?: string },
) {
  const rows = withAcCoverage(checks.rows, checks.coverage ?? readAcCoverage(dir), ctx.machineryProjectDir?.(project));
  // The Acceptance section alone: the Phase tables are the implement
  // run's own record and the Checks tab no longer offers them (see
  // `checklist`'s own comment), so a spec whose only open rows are
  // Phase rows has nothing to save and needs no form or commit stamp.
  // A Not verified row counts: it is done for the gates (so `acceptancePhase`
  // no longer names its section), and still the row a reader ticks or
  // un-marks, so the form has to carry the file's commit.
  const anyTickable = rows.some((row) => row.notVerified || (!row.done && row.phase === target.acceptancePhase));
  // `checks.baseSha` is already the exact commit that last touched the
  // file ON THE BRANCH (`readStatusFromFetchedBranch`'s own answer) — no
  // second git call needed. Off disk, read out of the DASHBOARD's own
  // checkout, like the text beside it: the commit stamp a
  // form compares against and the text in the box have to be the same
  // instant, or every save would refuse as "changed since you opened it".
  const statusCommit = !anyTickable
    ? null
    : checks.baseSha !== undefined
      ? { sha: checks.baseSha }
      : await lastCommitOf(ctx.gitRun, dir, STATUS_SPEC_FILE);
  return {
    rows,
    phase: target.phase,
    baseSha: statusCommit?.sha,
    unreadable: acceptanceSectionUnreadable(checks.text),
  };
}

/** Which phase's open rows may be TICKED: the CURRENT phase, which is the first phase
 *  section still carrying an open mark — the same phase the spec
 *  list's own column shows. `null` for a `4-status.md` with no phase
 *  sections at all (a spec never analysed — a LOW-complexity spec's
 *  `## Checklist` heading counts as a phase section)
 *  and `"done"` when every section is clear; both leave nothing
 *  tickable, and the page then draws the rows with no form. This rule
 *  reads the same whether the checks text
 *  came off the branch or off disk.
 *
 *  The same join the front page's row composes
 *  (`phasesFor`), over this spec's own jobs and target — never a
 *  second count. The per-job git work `jobRow` does is not new load:
 *  the front page already pays it over every job of every spec, and
 *  this is one spec's own attempts (typically 1-3). `withFreshness` (never a live git spawn — it only peeks
 *  the `workflowHistory` cache the schedule already warmed) is what
 *  fills a live spec's `done` in from its own commits; the raw
 *  `targets()` entry never carries it. Built once, right after the
 *  status is parsed, so every later read of `phase`/`acceptancePhase`
 *  goes through it. */
function specPageTarget(ctx: SpecViewsContext, project: string, specFolder: string, parsedStatus: ReturnType<typeof parseStatus>) {
  return {
    ...ctx.withFreshness(
      ctx.targets().filter((t) => t.project === project && t.specFolder === specFolder),
    )[0],
    phase: parsedStatus.phase ?? undefined,
    acceptancePhase: parsedStatus.acceptancePhase ?? undefined,
  };
}

/** The description the banner speaks for, from where a Save writes it:
 *  the open tab's own read when that is the description, else the same
 *  read through the peeked `dir` (as the Checks read above), so a tab
 *  with no form never waits on a clone. None for an archived spec, whose
 *  description is on disk. */
async function bannerDescription(
  ctx: SpecViewsContext,
  dir: string,
  specFolder: string,
  archived: boolean | undefined,
  form: FormRead,
): Promise<BranchCopy | null> {
  if (archived) return null;
  if (form.fetch && form.file === EDITABLE_SPEC_FILE) return form.copy;
  return await readBranchCopy(ctx, dir, specFolder, EDITABLE_SPEC_FILE);
}

/** What the banner reads off the description. */
function descriptionFacts(descriptionCopy: BranchCopy | null, dir: string) {
  return {
    // Read off the description — a fresh read, since the
    // banner is drawn once per page load and this fact only changes via
    // the banner's own Save.
    acceptanceNotRequired: descriptionCopy ? acceptanceNotRequiredIn(descriptionCopy.text) : specAcceptanceNotRequired(dir),
    // The choices the spec was created with, off the same description.
    createChoices: createChoicesIn(descriptionCopy?.text ?? specFileText(dir, EDITABLE_SPEC_FILE) ?? ""),
  };
}

export async function specPageView(
  ctx: SpecViewsContext,
  project: string,
  specFolder: string,
  tab?: string,
): Promise<SpecPageView | null> {
  const found = ctx.specDir(project, specFolder);
  if (!found) return null;
  // The four files as the dashboard's own checkout has them —
  // which is where Save writes, so it is where a save has to be
  // visible. The person's checkout catches up when the specs cron
  // pulls it, and the Update button is what closes that gap on
  // demand.
  const dir = ctx.peekMachinerySpecDir(project, found);
  const ref = ctx.specRef(project, specFolder);
  const matchingJobs = ctx.queue
    .list()
    .filter((j) => j.project === project && j.specFolder === specFolder);
  const files = await specFileViews(ctx, dir);
  // Off the text `specFileViews` has already read, so the page makes
  // no second git or disk read for the same file. This is the Status
  // TAB's own text (out of scope here) — the
  // Checks section below may draw from a DIFFERENT source.
  const status = files.find((f) => f.label === STATUS_SPEC_FILE);
  const checks = await readChecksSource(ctx, dir, specFolder, ref?.archived, status?.text ?? "");
  // `rows`/`phase`/`acceptancePhase` all come off this ONE
  // `parseStatus` call — it already walks the file's phase sections to
  // compute `checks` internally.
  const parsedStatus = parseStatus(checks.text);
  const target = specPageTarget(ctx, project, specFolder, parsedStatus);
  const form = await readFormFile(ctx, project, found, specFolder, tab, ref?.archived);
  const descriptionCopy = await bannerDescription(ctx, dir, specFolder, ref?.archived, form);
  // The Steps tab's jobs, lead and steps: one function, which the follow
  // answer calls too.
  const { jobs, lead, steps } = await stepsOfRound(ctx.queue, (job) => jobDetailView(ctx, job), project, specFolder);
  const jobRows = await Promise.all(jobs.map(ctx.jobRow));
  const server = testServerFacts(ctx, project, specFolder, ref?.archived);
  const busy = busyFacts(ctx, project, specFolder, matchingJobs);
  return {
    groupReserved: busy.groupReserved,
    project,
    specFolder,
    ...specStateFacts(ref, dir),
    files: filesWithForm(files, form),
    checks: await specChecks(ctx, project, dir, { ...checks, rows: parsedStatus.checks }, target),
    ...descriptionFacts(descriptionCopy, dir),
    phases: phasesFor(jobRows, target),
    // `targets()` deliberately drops an archived spec, so `target?.done`
    // is always empty for one: the file's own claim is the only answer
    // left, the same one `archivedSteps()` reads for the archived rows.
    done: ref?.archived ? parsedStatus.workflowSteps : (target?.done ?? []),
    formBaseSha: form.baseSha,
    lead,
    steps,
    ...specPageActions(ctx, project, specFolder, server, busy),
  };
}
