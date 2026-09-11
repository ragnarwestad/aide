// The landing every self-landing step shares: merge a step's own
// branch into the default branch of every repo it pushed to, and
// report per repo (specs 93, 136, 149).

import { realpathSync } from "node:fs";
import { join } from "node:path";

/** Whether two paths name the same directory, whatever each side spells
 *  it. `aide-run-spec` reports the root git gave it, and git resolves
 *  symlinks; the dashboard holds the path it was configured with. On
 *  macOS a checkout under `$TMPDIR` is `/var/folders/...` to one and
 *  `/private/var/folders/...` to the other, so a plain string comparison
 *  said they were different repositories — and the code root nobody
 *  recognised got no test gate, no code-first ordering and no PR-mode
 *  exception. A suite that was red on the merge landed on main that way.
 *
 *  A path that cannot be resolved — a checkout removed under us —
 *  answers as itself rather than throwing, so the comparison is then
 *  exactly the string one it replaces. */
export function sameRoot(a: string, b: string): boolean {
  if (a === b) return true;
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return real(a) === real(b);
}
import type { Job } from "../../queue/queue.ts";
import type { StepOutcome } from "../../queue/runner.ts";
import { renderSentence, type Sentence } from "../../i18n/message.ts";
import { deleteBranchOnly, mergeBranchIntoDefault, type RepoMergeResult } from "../../git/branch-merge.ts";
import { specFileText } from "../../project/discover.ts";
import { STATUS_SPEC_FILE } from "../../render.ts";
import { installAfterMerge } from "./install.ts";
import { isDashboardRoot } from "./restart.ts";
import type { LandContext, Landing } from "./types.ts";

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
/** Which refusal a row gets when the retries failed too: the FIRST one,
 *  which says what actually happened, unless a retry reached a verdict
 *  of its own (a conflict, a red suite). A retry that merely refused
 *  again used to overwrite "main moved on origin under this landing
 *  twice" with "cannot fast-forward main" (364, 2026-09-03). */
export function pickRefusal(first: RepoMergeResult, last: RepoMergeResult): RepoMergeResult {
  if (first.ok) return last;
  if (last.reason && last.reason !== first.reason) return last;
  return { ...last, error: first.error, detail: first.detail ?? last.detail, reason: first.reason };
}

export async function landBranch(
  ctx: LandContext,
  job: Job,
  outcome: Partial<StepOutcome>,
  what: Landing,
): Promise<void> {
  // Set once: the FIRST landing failure a job hits is the one worth
  // keeping (spec 327) — a later step's own failure is a symptom as
  // often as a second, unrelated problem (the incident this spec is
  // named for was exactly that: an `analyze` push failure, followed
  // minutes later by an `archive` "cannot fast-forward main" that was
  // really the same unpushed commit, not a second bug). Shared by the
  // failure branch and the catch block below, the two places a landing
  // can fail.
  //
  // "stopped", never "failed", when the project's own suite is what
  // refused the merge: the row says stopped and draws it amber, and a
  // sentence that says failed beside it is the row disagreeing with
  // itself.
  // The step-name/stopped-or-failed prefix this used to compose is
  // redundant with the badge label the one display site
  // (`row-marks.ts`'s `liveMarks()`) already shows beside it — and a
  // landing runs with nobody's browser attached, so there is no `lang`
  // here to render `msg` with anyway (REQ-1/REQ-3).
  const firstLandingError = (msg: Sentence | Sentence[], held = false): Sentence | Sentence[] =>
    ctx.queue.get(job.id)?.landingError ?? {
      key: held ? ("landing.stepStopped" as const) : ("landing.stepFailed" as const),
      values: { step: what.step },
      inner: msg,
    };
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
    const codeRoot = ctx.machineryProjectDir(job.project);
    const codeRoots = { has: (root: string) => sameRoot(root, codeRoot) };
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
    /** The code root's branch on a `close` landing (spec 406): deleted,
     *  never merged, since Close records that the work will not be used
     *  — the specs root still merges normally through the ordinary
     *  path below, carrying the folder move and the `**Closed:**`
     *  stamp into the specs repo's own history. `close` alone, by the
     *  literal step name, and the code root alone — mirrors `leaveOpen`
     *  above exactly in shape. */
    const discard = (root: string): boolean => what.step === "close" && codeRoots.has(root);
    if (!branch || repos.length === 0) {
      if (what.nothingToLand) ctx.queue.update(job.id, { error: what.nothingToLand });
      return;
    }
    const failures: Sentence[] = [];
    // Raw git output behind each failure above, if any (spec 352,
    // REQ-5) — joined the same way, so a title carrying several repos'
    // detail lines up with the sentence it belongs to.
    const failureDetails: string[] = [];
    // Which refusal it was, when it is one the row can offer a way out
    // of. A conflict is the only one a `resolve` step could finish.
    let reason: Job["errorReason"];
    // Spec 319: a merge that succeeded but whose delete failed, per
    // repo. `leftBehindRoots` is what stops the post-loop check below
    // from re-flagging a root THIS loop already knows the story of;
    // `deleteErrors` is what the row reads afterwards instead of the
    // generic "not landed".
    const deleteErrors: Sentence[] = [];
    const leftBehindRoots = new Set<string>();
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
        failures.push({ key: "landing.cannotWorkOutDefaultBranch", values: { root: repo.root } });
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
      const gate = codeRoots.has(repo.root) && ctx.landingGate
        ? (root: string) => ctx.landingGate!(root, job, branch)
        : undefined;
      const merge = () =>
        ctx.mergeLock.run(
          repo.root,
          () => discard(repo.root)
            ? deleteBranchOnly(ctx.gitRun, repo.root, branch)
            : mergeBranchIntoDefault(ctx.gitRun, repo.root, branch, base, undefined, gate),
        );
      let result = await merge();
      // A red suite is an answer, not a hiccup: never re-run it here.
      const first = result;
      for (let retry = 0; !result.ok && result.reason !== "tests-red" && retry < 2; retry++) {
        await new Promise((r) => setTimeout(r, 700 * (retry + 1)));
        result = await merge();
      }
      if (!result.ok) result = pickRefusal(first, result);
      if (result.ok) {
        ctx.branchStatus.invalidate(repo.root, branch);
        // The open-branch cache is the other half of the same
        // correction, and it is what the archived row reads. Only when
        // the delete actually succeeded: a branch still on origin
        // because its delete failed IS open, and spec 319's own
        // sentence for that case is written from `deleteErrors` below.
        if (!result.branchDeleteError) ctx.branchStatus.forgetOpenSpecBranch(repo.root, branch);
        // spec 406: a discarded root never merged anything — nothing to
        // install. The block below is `mergeBranchIntoDefault`'s own
        // success handling, which `deleteBranchOnly` never earns.
        if (!result.discarded) {
          // Merged is not deployed. For a tool that lives in
          // `~/.local/bin`, the code landing on the default branch
          // changes nothing on the machine until it is installed —
          // which is why spec 92's merged code kept running as the old
          // version. The install belongs to the project, so the project
          // says what it is.
          if (codeRoots.has(repo.root)) {
            // The install is the project's own business, whatever it does.
            // A landing never restarts the dashboard: a restart mid-run
            // kills every job's process, and no rule for "when it is safe"
            // held up (2026-09-03). The person restarts it — Deploy on the
            // board, or launchctl — when it suits; until then the served
            // page runs the older code, and the log says so.
            if ((await installAfterMerge(ctx, result)) && isDashboardRoot(ctx, repo.root)) {
              console.error(
                `queue: a code change landed in the dashboard's own checkout (${repo.root}) — the served page still runs the older code; restart it with Deploy when it suits`,
              );
            }
            // Never fatal, and never silent either: the merge already
            // happened, so this is reported beside it rather than
            // turning a successful merge into a failure. A server log has
            // no reader whose `lang` could apply; English is the source
            // language throughout this catalog (Recommended solution,
            // Storage, point 3).
            if (result.installError) {
              console.error(
                `queue: landing ${job.project}/${job.specFolder} in ${repo.root} — ${renderSentence("en", result.installError)}`,
              );
            }
          }
        }
        if (result.branchDeleteError) {
          console.error(
            `queue: landing ${job.project}/${job.specFolder} in ${repo.root} — ${renderSentence("en", result.branchDeleteError)}`,
          );
          leftBehindRoots.add(repo.root);
          // The ROOT is folded into the message's own template here —
          // this is the one place that knows whether several repos are
          // being reported at once (spec 319). `branch-merge.ts` always
          // composes this as a `BoardMessage`, never a plain string.
          const del = result.branchDeleteError;
          deleteErrors.push(
            typeof del === "object"
              ? {
                  key: result.detail ? ("landing.branchDeleteFailedWhy" as const) : del.key,
                  values: { ...del.values, root: repo.root, ...(result.detail ? { detail: result.detail } : {}) },
                }
              : del,
          );
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
        failures.push(result.error ?? { key: "landing.cannotMergeFallback", values: { branch, root: repo.root } });
        if (result.detail) failureDetails.push(result.detail);
        if (result.reason === "conflict") reason = "conflict";
        if (result.reason === "tests-red") reason = "tests-red";
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
    // The gate stopping the landing is its own case: nothing was merged
    // and nothing was pushed, so of course the branch is still on
    // origin. The gate's own verdict says so, and names the branch the
    // work is on — one sentence, and nothing added beside it.
    // One reason per row. A landing that has already said why it failed
    // (a conflict, a rejected push) is not joined by this check: it
    // exists for the landing that reported ok while a branch stayed on
    // origin, and beside a conflict its "run archive again" — once per
    // root — contradicted the sentence the reader had just been given.
    if (what.step === "archive" && reason !== "tests-red" && failures.length === 0) {
      for (const root of await ctx.rootsStillHolding(job.project, branch, true)) {
        // A root the loop above CHOSE not to merge is not a root that
        // failed to merge (spec 220). Without this, every working
        // PR-mode archive reports itself as an unlanded failure — the
        // check asks origin about the project's roots with no
        // knowledge of which ones the landing skipped, and in `pr`
        // mode the code root always still holds the branch, by design.
        if (leaveOpen(root)) continue;
        // This loop already knows WHY this root still holds the branch:
        // its own merge just succeeded and only the delete failed (spec
        // 319). Not a second, contradicting "not landed" — `deleteErrors`
        // above already carries the sentence that says what actually
        // happened, and the row reads it from there.
        if (leftBehindRoots.has(root)) continue;
        failures.push(
          // The sentence carries the move as well as the state: the
          // way out is the step that just ran, and the row's own
          // button already offers it. Phrased as an instruction
          // rather than as a quote of that button's label, so a
          // future rename leaves the sentence less exact but never
          // wrong.
          { key: "landing.stillOnOriginRunArchiveAgain", values: { branch, root } },
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
      // A red suite is the one failure here that is not a fault: the
      // step ran, the merge was built, and the project's own tests said
      // the result is not green. That stops the job rather than failing
      // it, the same way a cap-stop does — nothing was pushed, and the
      // answer is to run implement again.
      const held = reason === "tests-red";
      const patch = {
        error: failures,
        errorDetail: failureDetails.length ? failureDetails.join("; ") : undefined,
        errorReason: reason,
        landingError: firstLandingError(failures, held),
        ...(held ? { stopReason: "tests-red" as const } : {}),
      };
      const result = ctx.queue.transition(job.id, held ? "landing-held" : "landing-failed", patch);
      // The runner may already have queued this job's next step, or
      // held it for a reason of its own, in the gap between this
      // step's own completion and this landing settling
      // (job-states.md, "Done to failed"). `error`/`errorReason`/
      // `stopReason` say what the row is waiting for RIGHT NOW, and a
      // job that has moved on is waiting for something else — only
      // `landingError`, the permanent record of this attempt,
      // survives onto it (spec 393).
      if (!result.ok) ctx.queue.update(job.id, { landingError: patch.landingError });
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
      branchDeleteError: deleteErrors.length ? deleteErrors : undefined,
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
    // `specFolder` is read from the landing, not the job: a create
    // step's job still carries its provisional key here, and is only
    // renamed once every repo is through the loop. Without this
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
    const rawMsg = err instanceof Error ? err.message : String(err);
    const note = what.failedNote(rawMsg);
    const patch = {
      error: note,
      // Raw exception text (spec 352, REQ-5) — `note` itself carries
      // none, so a reader who needs the exact words has it on hover.
      errorDetail: rawMsg,
      // A thrown landing is not a conflict — the merge never got far
      // enough to be one, and offering Resolve for it would send a
      // whole run at a problem it cannot fix.
      errorReason: undefined,
      landingError: firstLandingError(note),
    };
    const result = ctx.queue.transition(job.id, "landing-failed", patch);
    // Same reasoning as the ordinary failure branch above (spec 393):
    // a job that has moved on keeps only the permanent record.
    if (!result.ok) ctx.queue.update(job.id, { landingError: patch.landingError });
  } finally {
    // After every repo, after the report, and after `onLanded` — on
    // the throwing path too. The process does not survive this call.
  }
}
