// The landing every self-landing step shares: merge a step's own
// branch into the default branch of every repo it pushed to, and
// report per repo (specs 93, 136, 149).

import { join } from "node:path";
import type { Job } from "../../queue/queue.ts";
import type { StepOutcome } from "../../queue/runner.ts";
import { mergeBranchIntoDefault } from "../../git/branch-merge.ts";
import { specFileText } from "../../project/discover.ts";
import { STATUS_SPEC_FILE } from "../../render.ts";
import { installAfterMerge } from "./install.ts";
import { downgrade, type LandContext, type Landing } from "./types.ts";

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
    //
    // `archive` reverses this (spec 280): its specs root is the one
    // carrying the `Result: completed` / `Workflow steps completed`
    // stamp, and that stamp must never reach `main` before the code
    // root's own landing is confirmed — so for `archive` specifically,
    // code is attempted FIRST, and the loop below stops on a failed
    // code root before the specs root is ever attempted.
    const codeRoots = new Set([ctx.machineryProjectDir(job.project)]);
    const codeFirst = what.step === "archive";
    const repos = [...(what.repos ?? outcome.branchUrls ?? [])].sort((a, b) => {
      const av = Number(codeRoots.has(a.root));
      const bv = Number(codeRoots.has(b.root));
      return codeFirst ? bv - av : av - bv;
    });
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
        // spec 280: a code root that fails to land during an archive
        // landing stops the loop here — the specs root's own merge,
        // which stamps 4-status.md as archived, has not run yet
        // (code-first order, above) and must never run now that the
        // code side failed.
        if (codeFirst && codeRoots.has(repo.root)) break;
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
