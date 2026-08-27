// Landing a step's own branch into the default branch of every repo it
// pushed to (specs 93, 136, 149) — pulled out of `createServer`'s
// closure the same way `handleQueue` and the spec-view builders were
// (spec: split serve.ts, step 4). An explicit context object stands in
// for the locals these functions used to read directly.

import { join } from "node:path";
import {
  mergeBranchRefs, QueueStore, type BranchRef, type Job, type WorkflowStep,
} from "../queue/queue.ts";
import type { StepOutcome } from "../queue/runner.ts";
import { mergeBranchIntoDefault, type RepoMergeResult } from "../git/branch-merge.ts";
import { saveSpecFile } from "../git/specs-pull.ts";
import type { BranchStatusChecker, GitRunner } from "../git/branch-status.ts";
import { stepsFileDisagreesOn, type WorkflowHistoryChecker } from "../git/workflow-history.ts";
import { lastCommitOf, type SpecCreatedAtChecker, type DescriptionFreshnessChecker } from "../git/description-freshness.ts";
import type { MergeEventReporter } from "../integrations/merge-event.ts";
import {
  configValue, specDurationMs, specFileText, stampDuration, type CodeLanding,
} from "../project/discover.ts";
import { parseStatus } from "../project/parse-status.ts";
import {
  computeSpecTotalDurationMs, STATUS_SPEC_FILE, type QueueRowView, type QueueTarget,
} from "../render.ts";
import { INSTALL_TIMEOUT_MS, createRootLock } from "./serve-helpers.ts";

/** Everything `landBranch` and its helpers read off `createServer`'s
 *  closure, bundled the same way `HandleQueueContext` and
 *  `SpecViewsContext` bundle theirs. `invalidateScan` is the same
 *  getter/invalidator shape as `HandleQueueContext.invalidateScan` —
 *  both close over the same `scan` `let`. */
export interface LandContext {
  machineryProjectDir: (project: string) => string;
  codeLanding: (project: string) => CodeLanding;
  queue: QueueStore;
  mergeLock: ReturnType<typeof createRootLock>;
  gitRun: GitRunner;
  branchStatus: BranchStatusChecker;
  mergeEvents: MergeEventReporter;
  warmSpec: (t: { dir?: string; specFolder: string; reopenedAfter?: string }) => Promise<void>;
  machinerySpecsRoot: (project: string) => string | undefined;
  specsRoot: (dir: string) => Promise<string>;
  jobRow: (job: Job) => Promise<QueueRowView>;
  workflowHistory: WorkflowHistoryChecker;
  specCreatedAt: SpecCreatedAtChecker;
  freshness: DescriptionFreshnessChecker;
  rootsStillHolding: (project: string, branch: string, fresh: boolean) => Promise<string[]>;
  invalidateScan: () => void;
  queueInstallTimeoutMs: number | undefined;
}

/** What a landing does that is not the merge itself: what to write on
 *  the job when it worked, and what to say when it did not. Everything
 *  else — which repos, the retries, the per-repo report — is the same
 *  for every step, and is `landBranch`'s. */
interface Landing {
  /** Beyond the standard `branchUrl`/`branchUrls`/`error` reset. A
   *  create step renames the job off its provisional key; an archive
   *  step has nothing to add. */
  landed?: Partial<Job>;
  /** What to say when the run pushed no branch at all. For `create`
   *  that IS the failure — the spec exists only on a branch that was
   *  never reported. For `archive` a HEAD that never moved is an
   *  ordinary outcome, so it says nothing and leaves no error. */
  nothingToLand?: string;
  /** The catch-all message, which has to name the step: "landing it
   *  failed" alone leaves a reader guessing what "it" was. */
  failedNote: (why: string) => string;
  /** Which repos to land. Absent means the step's own outcome, which
   *  is right for every landing but archive's — see
   *  `landArchivedSpec` for why that one has to look further. */
  repos?: BranchRef[];
  /** Which step's landing this is. Only the merge event reads it
   *  (spec 158), and it is taken from the call site rather than
   *  derived: `landStepBranch` already HAS the step as a parameter,
   *  and a second value worked out from the outcome would be a second
   *  thing that could be wrong. */
  step: WorkflowStep;
  /** What to do once the merge has actually landed — after the job
   *  has been updated and the scan invalidated, and only then (spec
   *  207). `archive`'s alone today: it writes what the spec cost in
   *  time into `4-status.md`, and a spec whose branch did not land is
   *  not archived, so there would be nothing to record.
   *
   *  Never fatal and never rethrown, exactly like `installAfterMerge`
   *  in the same function: the merge already happened, and turning a
   *  landed archive into a failed job would hand back a task nobody
   *  can act on. */
  onLanded?: () => Promise<void>;
}

/** A landing that failed is not a spec that is done (spec 193).
 *
 *  The STEP succeeded, so `complete()` has already written `done` and
 *  announced it; this promise settles afterwards, and until now it
 *  wrote only a sentence nothing was drawing. Every page reads the
 *  state through one path, so moving it is all "reads as unfinished
 *  wherever the job is shown" takes.
 *
 *  Only ever DOWNGRADED from `done`: `complete()` may have queued the
 *  job's next step in between (`runner.ts`), and a landing must not
 *  overwrite a job that has moved on. */
export function downgrade(ctx: LandContext, id: string): { state?: "failed" } {
  return ctx.queue.get(id)?.state === "done" ? { state: "failed" } : {};
}

/** Run the project's own install, once its code has landed. Bounded by
 *  a timeout of its own — never trusting the server's idle timeout to
 *  bound it — and never fatal: the merge already happened, and a
 *  failed install is reported beside it rather than retroactively
 *  turning a successful merge into a failure. */
export async function installAfterMerge(ctx: LandContext, result: RepoMergeResult): Promise<void> {
  const cmd = configValue(result.root, "AIDE_INSTALL_CMD");
  if (!cmd) {
    // Said out loud for every project that has not configured one:
    // the alternative is a page that reads as "deployed" when nothing
    // was deployed, which is the whole complaint.
    result.installError = "merged, not installed — no AIDE_INSTALL_CMD configured; deploying is a hand step";
    return;
  }
  const timeoutMs = ctx.queueInstallTimeoutMs ?? INSTALL_TIMEOUT_MS;
  try {
    // argv, no shell — the same shape the notify command already has,
    // so nothing here has to get quoting right on someone's behalf.
    const proc = Bun.spawn({ cmd: cmd.split(/\s+/), cwd: result.root, stdout: "ignore", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    let tail = "";
    try {
      tail = await new Response(proc.stderr).text();
    } finally {
      clearTimeout(timer);
    }
    const code = await proc.exited;
    if (timedOut) {
      result.installError = `merged, but the install timed out after ${timeoutMs}ms and was stopped`;
    } else if (code !== 0) {
      result.installError = `merged, but the install failed (exit ${code}): ${tail.trim().slice(-200)}`;
    }
  } catch (err) {
    result.installError = `merged, but the install could not be run: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Merge a step's own branch into the default branch of every repo it
 *  pushed to, and report per repo — the landing every self-landing
 *  step shares (specs 93, 136 and 149).
 *
 *  The branch and, by default, the repos come from the RESULT, never
 *  from `specBranch(...)` or `queue.branchesFor(...)`. Two reasons,
 *  one per caller: a create step's folder did not exist when its
 *  branch was named, and `onStepDone` runs SYNCHRONOUSLY inside
 *  `complete()`, before the runner has written this step's own
 *  `branchUrls` into the store — so a spec whose first-ever queue job
 *  is the one landing would find that history empty. The outcome in
 *  hand has neither problem. Archive is the one caller that has to
 *  look further, and says so itself (`what.repos`).
 *
 *  Every merge goes through `mergeLock`, one repo at a time. Four
 *  steps land themselves now, and two specs sharing one specs repo can
 *  finish within seconds of each other under queue concurrency — which
 *  is the collision the lock exists to serialize. `create` merged
 *  outside it until spec 149, which was survivable only because it was
 *  one of two rare self-landings.
 *
 *  Plan first, code last, for the same reason the manual route sorted
 *  them: a run records the project before its specs root, so a reader
 *  watching the page saw the code land before the plan describing it,
 *  and the code is the one that matters. */
export async function landBranch(
  ctx: LandContext,
  job: Job,
  outcome: Partial<StepOutcome>,
  what: Landing,
): Promise<void> {
  try {
    const branch = outcome.branch;
    // Code roots last. `sort` is stable, so two repos of the same kind
    // keep the order the run recorded them in.
    const codeRoots = new Set([ctx.machineryProjectDir(job.project)]);
    const repos = [...(what.repos ?? outcome.branchUrls ?? [])].sort(
      (a, b) => Number(codeRoots.has(a.root)) - Number(codeRoots.has(b.root)),
    );
    /** Roots this landing deliberately does not merge (spec 220): a
     *  project whose manifest says `codeLanding: pr` has its CODE
     *  reviewed before it reaches the default branch, and the run has
     *  already opened the pull request.
     *
     *  `archive` alone, by the literal step name, and the code root
     *  alone. `create` and `analyze` never reach a code root in a
     *  gated position, and the specs root is bookkeeping — an archive
     *  commit moving a folder is not a change anyone reviews, and the
     *  description scopes this to the code. */
    const leaveOpen = (root: string): boolean =>
      what.step === "archive" && codeRoots.has(root) && ctx.codeLanding(job.project) === "pr";
    if (!branch || repos.length === 0) {
      if (what.nothingToLand) ctx.queue.update(job.id, { error: what.nothingToLand });
      return;
    }
    const failures: string[] = [];
    // Which refusal it was, when it is one the row can offer a way out
    // of. A conflict is the only one a `resolve` step could finish.
    let reason: Job["errorReason"];
    for (const repo of repos) {
      if (leaveOpen(repo.root)) {
        // Nothing merged, nothing deleted, nothing installed: the code
        // is on its branch, which is where the review happens, and
        // installing it here would deploy exactly the change the
        // review exists to hold back.
        console.error(
          `queue: landing ${job.project}/${job.specFolder} in ${repo.root} — left open for review (codeLanding: pr)`,
        );
        continue;
      }
      const base = await ctx.branchStatus.defaultBranch(repo.root);
      if (!base) {
        // Guessing which branch to merge INTO is the one guess with no
        // safe direction.
        failures.push(`cannot work out the default branch in ${repo.root}`);
        continue;
      }
      // Up to three tries with a pause: this landing races the runs
      // that pull the same checkout (index.lock, a briefly stale
      // main), and both 111 and 112 were left stranded by giving up
      // on the first loss. A real conflict fails all three the same
      // way and is reported as before.
      //
      // The lock goes around the git-mutating call and nothing else:
      // `defaultBranch` above only asks a question, and holding the
      // root while asking it would serialize page loads too.
      const merge = () =>
        ctx.mergeLock.run(repo.root, () => mergeBranchIntoDefault(ctx.gitRun, repo.root, branch, base));
      let result = await merge();
      for (let retry = 0; !result.ok && retry < 2; retry++) {
        await new Promise((r) => setTimeout(r, 700 * (retry + 1)));
        result = await merge();
      }
      if (result.ok) {
        ctx.branchStatus.invalidate(repo.root, branch);
        // Say what just happened, to whoever is listening (spec 158).
        // Once per repo whose merge SUCCEEDED — not once per landing,
        // and not only for code roots: a spec-markdown merge is
        // exactly the kind claude-usage cannot see today, so it is
        // reported the same as any other. `report` never throws and
        // never retries; a sink that is down costs this path one short
        // timeout and nothing else.
        //
        // `specFolder` is read from the landing rather than the job:
        // a create step's job still carries its provisional key here,
        // and is only renamed once every repo is through the loop.
        await ctx.mergeEvents.report({
          project: job.project,
          specFolder: what.landed?.specFolder ?? job.specFolder,
          branch,
          repoRoot: repo.root,
          step: what.step,
          jobId: job.id,
          timestamp: new Date().toISOString(),
        });
        // Merged is not deployed. For a tool that lives in
        // `~/.local/bin`, the code landing on the default branch
        // changes nothing on the machine until it is installed —
        // which is why spec 92's merged code kept running as the old
        // version. The install belongs to the project, so the project
        // says what it is.
        if (codeRoots.has(repo.root)) {
          await installAfterMerge(ctx, result);
          // Never fatal, and never silent either: the merge already
          // happened, so this is reported beside it rather than
          // turning a successful merge into a failure.
          if (result.installError) {
            console.error(`queue: landing ${job.project}/${job.specFolder} in ${repo.root} — ${result.installError}`);
          }
        }
        if (result.branchDeleteError) {
          console.error(`queue: landing ${job.project}/${job.specFolder} in ${repo.root} — ${result.branchDeleteError}`);
        }
      } else if (result.reason === "gone") {
        // Nothing to land in this repo, and not a failure of this
        // landing (spec 153). An archive looks back through every
        // branch the spec's steps pushed, and since spec 149 a
        // `resolve` lands AND DELETES its own — so by the time archive
        // gets here, that branch is provably gone. Job 15932abc
        // (2026-08-21) was the first: archived, `ok: true`, and an
        // error on the row saying there was nothing left to merge.
        //
        // The refusal also disproves the cached answer from the other
        // side: the branch is not on origin at all.
        ctx.branchStatus.invalidate(repo.root, branch);
      } else {
        failures.push(result.error ?? `cannot merge ${branch} in ${repo.root}`);
        if (result.reason === "conflict") reason = "conflict";
      }
    }
    // Origin decides, not the queue's memory of its own pushes (spec
    // 193). Archive's contract is that nothing of the spec stays
    // open, and the loop above can only merge repos it was TOLD
    // about — a step run by hand, a job the LRU cap has evicted, a
    // push that half-succeeded, all leave a branch no `branchUrls`
    // entry ever mentioned. Three specs reached the archive that way
    // with every row saying done.
    //
    // `fresh`, because `mergeBranchIntoDefault` has just deleted the
    // branch on origin and a cached answer would report every
    // successful landing as unlanded.
    //
    // ARCHIVE's alone, by name and never by a denylist of the others:
    // an `analyze` landing runs while implement's code branch is
    // legitimately open, and the same check there would call a
    // healthy landing failed.
    if (what.step === "archive") {
      for (const root of await ctx.rootsStillHolding(job.project, branch, true)) {
        // A root the loop above CHOSE not to merge is not a root that
        // failed to merge (spec 220). Without this, every working
        // PR-mode archive reports itself as an unlanded failure — the
        // check asks origin about the project's roots with no
        // knowledge of which ones the landing skipped, and in `pr`
        // mode the code root always still holds the branch, by design.
        if (leaveOpen(root)) continue;
        failures.push(
          // The sentence carries the move as well as the state: the
          // way out is the step that just ran, and the row's own
          // button already offers it. Phrased as an instruction
          // rather than as a quote of that button's label, so a
          // future rename leaves the sentence less exact but never
          // wrong.
          `${branch} is still on origin in ${root} — the spec was archived, but its work has not landed. Run archive again to land it.`,
        );
        // Only where nothing more specific was found: a conflict is
        // the reason, and "unlanded" is what a conflict LOOKS like
        // from origin.
        reason ??= "unlanded";
      }
    }
    if (failures.length > 0) {
      // Whatever the success path would have written is NOT written: a
      // create job keeps its provisional key, because the job is still
      // the only handle on a branch that has not landed, and renaming
      // it to a folder the page cannot see would hide the work rather
      // than report it. The branch stays on the row either way.
      //
      // `errorReason` is STORED rather than carried in a redirect, and
      // that is the whole difference between this and the Merge button
      // spec 149 removed: nobody's browser is attached to a landing, so
      // the row has to be able to read the reason on any later request
      // (`queue-list.ts`, `resolveForm`).
      ctx.queue.update(job.id, {
        error: failures.join("; "),
        errorReason: reason,
        ...downgrade(ctx, job.id),
      });
      return;
    }
    // Landed. The branch is on the default branch now, so the job stops
    // advertising one: a compare page for a merged branch shows
    // nothing, and the row would otherwise name a branch it can
    // no longer derive (`specBranch` reads the RENAMED folder).
    // ...except what was deliberately left open (spec 220), which
    // still has a branch and still wants naming: the row is where a
    // reader learns the code is waiting on a review rather than
    // already on the default branch.
    const stillOpen = repos.filter((repo) => leaveOpen(repo.root));
    // And the review it is waiting on is named on THIS job, whichever
    // job opened it. `implement` pushed the code and called `gh`;
    // `archive` is the row a reader is looking at when the spec goes
    // quiet, and a link they have to go hunting for on an older row is
    // a link that is not there.
    const review = stillOpen.length ? ctx.queue.pullRequestFor(job.project, job.specFolder) : {};
    ctx.queue.update(job.id, {
      ...what.landed,
      branchUrl: stillOpen.length ? (stillOpen[0]!.url ?? job.branchUrl) : undefined,
      branchUrls: stillOpen,
      prUrl: review.prUrl,
      prError: review.prError,
      error: undefined,
      errorReason: undefined,
    });
    // The page caches its scan for five seconds. Without this the very
    // request that follows a landing would still not show the spec —
    // nor, for an archive, that it has left the list.
    ctx.invalidateScan();
    // After the scan is invalidated, so anything this reads sees the
    // landing rather than the five-second-old picture of the world
    // before it.
    //
    // `specFolder` is read from the landing, not the job, for the same
    // reason the merge-event report two lines above already does: a
    // create step's job still carries its provisional key here, and is
    // only renamed once every repo is through the loop. Without this
    // substitution the warm silently no-ops for every create landing —
    // no directory exists yet under the provisional key.
    const landedFolder = what.landed?.specFolder ?? job.specFolder;
    const landedRoot = ctx.machinerySpecsRoot(job.project);
    const landedDir = landedRoot
      ? [join(landedRoot, "archive", landedFolder), join(landedRoot, landedFolder)].find(
          (candidate) => specFileText(candidate, STATUS_SPEC_FILE) !== null,
        )
      : undefined;
    if (landedDir) await ctx.warmSpec({ dir: landedDir, specFolder: landedFolder });
    if (what.onLanded) {
      try {
        await what.onLanded();
      } catch (err) {
        console.error(
          `queue: landing ${job.project}/${job.specFolder} — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    // Never rethrown: the `landing` flag holds the WHOLE queue, and
    // the runner clears it when this promise settles — which it must
    // do, however this went.
    ctx.queue.update(job.id, {
      error: what.failedNote(err instanceof Error ? err.message : String(err)),
      // A thrown landing is not a conflict — the merge never got far
      // enough to be one, and offering Resolve for it would send a
      // whole run at a problem it cannot fix.
      errorReason: undefined,
      ...downgrade(ctx, job.id),
    });
  }
}

/** Put a newly created spec where the page can see it (spec 93).
 *
 *  This was the first merge on the dashboard that no one pressed a
 *  button for, and it is not a convenience: the spec list shows what is
 *  on disk in the main checkout, which every run is careful never to
 *  leave its default branch, so a created spec that is only pushed to
 *  a branch appears nowhere at all. A spec waiting on the page until
 *  somebody noticed and merged it by hand would not be the feature
 *  with one extra click — it would be the feature not working. */
export async function landNewSpec(ctx: LandContext, job: Job, outcome: Partial<StepOutcome>): Promise<void> {
  return landBranch(ctx, job, outcome, {
    step: "create",
    landed: { specFolder: outcome.specFolder ?? job.specFolder },
    nothingToLand:
      "the spec was created, but the run reported no pushed branch to land it from — " +
      "merge it by hand, or check the queue's push mode",
    failedNote: (why) => `the spec was created, but landing it failed: ${why}`,
  });
}

/** Land the work a middle-of-the-workflow step produced (spec 149).
 *
 *  `analyze` writes markdown in the specs repo and
 *  nothing else — the same argument that made `create` and `archive`
 *  land themselves, word for word; it was simply never given it,
 *  and the row piled up a "ready to merge" button per step for work
 *  nobody had a reason to weigh.
 *
 *  Either one lands what its OWN run reports and nothing else — the
 *  outcome's roots, never `branchesFor` history. Reading the history
 *  instead would let a step that touched only the specs repo drag an
 *  unarchived `implement`'s code onto the default branch as a side
 *  effect, which is exactly what "archive is the one step that sends
 *  code to the default branch" rules out. The residual gap is that a
 *  run whose own catch-up merge happens to move the project's HEAD
 *  lands that code early; it is accepted, and it belonged to `resolve`
 *  until spec 171 retired that step.
 *
 *  The install is neither asked for nor refused here: `landBranch`
 *  runs it for any CODE root that lands, whichever step landed it.
 *  `analyze` never has one. */
export async function landStepBranch(
  ctx: LandContext,
  job: Job,
  step: WorkflowStep,
  outcome: Partial<StepOutcome>,
): Promise<void> {
  return landBranch(ctx, job, outcome, {
    step,
    failedNote: (why) => `the ${step} step finished, but landing it failed: ${why}`,
  });
}

/** Land what a step wrote when it did NOT finish, but ran out of time
 *  having touched no code repo (spec 187).
 *
 *  The merge is `landBranch`, unchanged — the caller has already asked
 *  the only question this case adds (did anything outside the specs
 *  repo move?). What differs is one sentence a person reads: "the
 *  analyze step finished, but landing it failed" would state as fact
 *  the one thing that did not happen, which is exactly what a reader
 *  needs to know. `nothingToLand` stays unset for the same reason `archive`
 *  leaves it unset: a run with no branch is an ordinary outcome here,
 *  and the caller returns before this is reached anyway. */
export async function landStoppedStepBranch(
  ctx: LandContext,
  job: Job,
  step: WorkflowStep,
  outcome: Partial<StepOutcome>,
): Promise<void> {
  return landBranch(ctx, job, outcome, {
    step,
    failedNote: (why) => `the ${step} step stopped at its time limit, and landing what it wrote failed: ${why}`,
  });
}

/** Take an archived spec out of the list it has just left (spec 136).
 *
 *  The same argument as `landNewSpec`, at the other end of a spec's
 *  life: the list reads the main checkout, so a folder moved into
 *  `archive/` on a branch is still in the ACTIVE list here, and the row
 *  asks to be merged. That made the closing step end by handing back a
 *  task — 133 was archived twice on 2026-08-20 because the first run
 *  looked like it had failed.
 *
 *  Safe to do unpressed for a reason `implement` cannot claim: a
 *  headless archive writes two markdown changes in the specs repo and
 *  nothing else (`core/skills/aide-archive/SKILL.md` forbids it to
 *  touch the project's docs or to ask), so there is no diff for a
 *  person to weigh and nothing that reaches the serving host. The
 *  judgment happened before the run — someone pressed Archive, and the
 *  skill refuses to move anything a `4-status.md` does not show as
 *  finished.
 *
 *  A merge that genuinely cannot be made still refuses by name, keeps
 *  the branch on the row and leaves the spec in the list: the old
 *  behaviour is the fallback, not the thing being removed. */
export async function landArchivedSpec(ctx: LandContext, job: Job, outcome: Partial<StepOutcome>): Promise<void> {
  return landBranch(ctx, job, outcome, {
    step: "archive",
    // The ONE landing that reads past its own outcome (spec 149).
    // `implement` deliberately never lands, so the project's code
    // branch sits open for however many steps follow — and whether an
    // archive run's own git touches that checkout is not guaranteed:
    // `update_branch_to_base` runs for every root on every step, but
    // where the code branch is already an ancestor of the default
    // branch the `--ff-only` is a no-op, so HEAD never moves and the
    // project root never appears here. `branchesFor` is the record
    // that still has it — implement's job entry keeps its
    // `branchUrls`, because nothing ever clears them.
    repos: mergeBranchRefs(ctx.queue.branchesFor(job.project, job.specFolder), outcome.branchUrls ?? []),
    // A run that pushed nothing archived nothing new — a re-run of a
    // spec already held back for the same reason writes no commit, and
    // an error there would report a problem that is not one.
    failedNote: (why) => `the spec was archived, but landing it failed: ${why}`,
    // The one landing that records anything (spec 207). It runs only
    // once the branch is genuinely on the default branch: a spec
    // whose archive did not land is not archived, and a figure
    // written for it would outlive the row that says so.
    onLanded: () => stampTotalDuration(ctx, job),
  });
}

/** What the spec cost in TIME, written into its own `4-status.md`
 *  once its archive has landed (spec 207).
 *
 *  The spec list has always shown this — the phases added together —
 *  but it is worked out from the queue's job records, and the queue
 *  keeps two hundred jobs on one machine while the archive holds
 *  ninety specs and grows. So most archived rows would have no figure
 *  and never would, unless it is written down. Written down, it
 *  survives the queue forgetting, the machine changing and the year
 *  turning, which is the whole reason to want it.
 *
 *  Neither half of the runner can do this: `core/skills/aide-archive`
 *  reads markdown and runs git, and `core/scripts/aide-run-spec`
 *  derives what it knows from commit subjects. The per-step timings
 *  live only in this process's `QueueStore`, so the write happens
 *  here.
 *
 *  Four things it will not do:
 *
 *  - It does not compute the sum itself. `computeSpecTotalDurationMs`
 *    is the spec list's own function, and `done` comes from the same
 *    `withFreshness` the list calls — so "the stored figure equals
 *    what the list showed" holds by construction rather than by two
 *    implementations staying in step.
 *  - It does not write twice. 133 was archived three times; a second
 *    landing finds the stamp already there and leaves it alone.
 *  - It does not write in a person's checkout. The merge above landed
 *    in the machinery's own (spec 205), which is also where the
 *    archive step's `git mv` has just moved the folder — so the
 *    archived path is tried first and the active one second, the same
 *    two-candidate shape `aide_resolve_spec` uses in bash.
 *  - It does not fail anything. A refusal is logged and left there;
 *    what it leaves is a blank cell, which the archive page already
 *    draws for every spec finished before this existed. */
export async function stampTotalDuration(ctx: LandContext, job: Job): Promise<void> {
  const root = ctx.machinerySpecsRoot(job.project);
  if (!root) return;
  const dir = [join(root, "archive", job.specFolder), join(root, job.specFolder)].find(
    (candidate) => specFileText(candidate, STATUS_SPEC_FILE) !== null,
  );
  if (!dir) return;
  // Already recorded: a re-run of `archive` must not grow a second
  // bullet, nor overwrite the first with a figure measured over a
  // different set of jobs. Read before anything expensive is done.
  if (specDurationMs(dir) !== null) return;
  const current = specFileText(dir, STATUS_SPEC_FILE);
  if (current === null) return;
  // The list's own done-set, from the list's own function — NOT the
  // job results. A step a job completed is not necessarily a step
  // that counts: `withFreshness` takes `analyze` back out when the
  // description moved on after it, and the list then shows no total.
  const spec = {
    project: job.project,
    specFolder: job.specFolder,
    dir,
    reopenedAfter: parseStatus(current).reopenedAfter,
  };
  // `withFreshness` is a peek since spec 208, and this spec has just
  // been archived — the schedule walks the LIVE list, so nothing has
  // ever asked git about this folder. Warmed first, deliberately:
  // this is a landing, not a render, and a figure worked out from
  // "not yet known" would be written down and outlive the mistake.
  await ctx.warmSpec(spec);
  const [fresh] = withFreshness(ctx, [spec]);
  const rows = await Promise.all(
    ctx.queue
      .list()
      .filter((j) => j.project === job.project && j.specFolder === job.specFolder)
      .map(ctx.jobRow),
  );
  // This job's own `landing` flag is still true here — it is cleared
  // only once the runner's promise for `onLanded` (this very function)
  // settles, on purpose, so a `tick()` interleaved mid-landing cannot
  // reuse its concurrency slot (`runner.ts`). `totalDuration`'s
  // in-flight guard reads that same flag as "not finished yet", which
  // is right for the row a reader sees but wrong here: this landing
  // reaching `onLanded` at all means the step is done, and the total is
  // being asked for BECAUSE of that, not despite it.
  for (const r of rows) if (r.id === job.id) r.landing = undefined;
  const ms = computeSpecTotalDurationMs(rows, fresh?.done ?? []);
  if (ms === undefined) return;
  const text = stampDuration(current, ms);
  // Nowhere to put the line — a `4-status.md` with no Tracking info
  // section — comes back unchanged, and there is nothing to save.
  if (text === current) return;
  const baseSha = (await lastCommitOf(ctx.gitRun, dir, STATUS_SPEC_FILE))?.sha ?? null;
  // The same lock the merge above just used and let go of, for the
  // same hazard: every spec shares the specs root, so this write must
  // not run beside a save, a pull, or a second landing.
  const result = await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
    saveSpecFile(ctx.gitRun, dir, (r) => ctx.branchStatus.defaultBranch(r), {
      file: STATUS_SPEC_FILE,
      text,
      baseSha,
      specLabel: job.specFolder,
      message: `Record what ${job.specFolder} cost in time`,
    }),
  );
  if (!result.ok) {
    console.error(`queue: recording ${job.project}/${job.specFolder}'s time spent — ${result.note}`);
  }
}

/** Everything about a spec that only git can answer, asked once per
 *  spec over the same checkout.
 *
 *  Spec 154: which steps it has HAD. The runner commits every step it
 *  finishes, with the outcome in the subject, and that commit exists
 *  whether or not the model reached the instruction that writes
 *  `4-status.md` — which is what makes it the record and the file the
 *  claim. The file is still read (`fileSteps`), for one purpose: a
 *  row whose file and history disagree says so.
 *
 *  Spec 97: whether the plan is still about the problem the
 *  description states. A description committed after the last
 *  finished analyze means the plan on disk answers an older question,
 *  so the two phases that produced it stop counting as done and the
 *  row pre-ticks `analyze` again.
 *
 *  Applied here rather than inside `targets()` for two reasons: that
 *  scan is cached for five seconds and must stay a pure function of
 *  what is on disk, and it is handed to the queue as a SYNCHRONOUS
 *  resolver — making it async to ask git would thread `await` through
 *  the enqueue path for a signal enqueueing has no use for.
 *
 *  A stale description takes back `analyze` only.
 *  `implement` is deliberately untouched: nothing here blocks running
 *  a spec whose description change turns out to be cosmetic.
 *
 *  A spec with no `dir` — a create job's spec, which is the folder the
 *  job is making — has no history to read and keeps the empty
 *  done-set it arrived with. */
export function withFreshness(ctx: LandContext, list: QueueTarget[]): QueueTarget[] {
  return list.map((t) => {
    if (!t.dir) return t;
    // Peeks, never the async methods (spec 208). A render reads
    // memory and disk and nothing else; `refreshSpecCaches` is what
    // keeps these three fed, on a schedule of its own.
    const { history, checkedAt } = ctx.workflowHistory.peekHistory(t.dir, t.specFolder, t.reopenedAfter);
    // Nothing has ever been asked about this spec. Not "no step has
    // run" — that is a real answer with a real, empty history — and
    // the row draws "checking…" rather than a false negative,
    // which is the class of bug spec 178's own plan review flagged.
    if (history === null || checkedAt === null) return { ...t, freshnessUnknown: true };
    const fileSteps = t.fileSteps ?? [];
    // `create` is settled by the folder being on disk, which is
    // what `t.dir` being set already proves — a stronger source
    // than the commit log, since a spec written by hand has no
    // `Run /aide-create` commit at all. Whenever the row is drawn
    // the spec exists, so "create not run yet" cannot be true
    // (spec 176). The pip has read it this way since spec 167; the
    // phase LINE reads the same set now, one layer down.
    const done = history.done.includes("create") ? history.done : ["create", ...history.done];
    const withHistory: QueueTarget = {
      ...t,
      done,
      stopped: history.stopped,
      fileDisagrees: stepsFileDisagreesOn(fileSteps, history),
      // What the "Started" column holds (spec 199). Null when git
      // could not answer — a shallow clone, a folder moved without
      // `git mv` — and then the cell shows a dash rather than a
      // job's own time, which is the field this replaces.
      createdAt: ctx.specCreatedAt.peekCreatedAt(t.dir, t.specFolder).createdAt ?? undefined,
    };
    if (!ctx.freshness.peekStale(t.dir, t.specFolder, t.reopenedAfter).stale) return withHistory;
    return {
      ...withHistory,
      analyzeStale: true,
      done: done.filter((s) => s !== "analyze"),
    };
  });
}
